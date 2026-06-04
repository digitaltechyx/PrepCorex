import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { encodeCartonBarcode } from "@/lib/warehouse-carton-barcode";
import { resolveReceiveLot } from "@/lib/warehouse-receive-lot";
import {
  assertCartonStatusTransition,
  canTransitionCartonStatus,
} from "@/lib/warehouse-carton-states";
import {
  palletHasChildCartons,
  warehouseCartonDocRef,
  warehousePalletDocRef,
} from "@/lib/warehouse-carton-firestore";
import type { WarehouseCartonDoc, WarehouseCartonLine, WarehousePalletDoc } from "@/types";

const WAREHOUSES = "warehouses";

export type ReceiveLineInput = {
  sku: string;
  productTitle?: string | null;
  quantity: number;
  lot?: string | null;
  expiry?: string | null;
  damaged?: boolean;
};

/** True when any line or root bin is assigned (putaway started or completed). */
export function cartonHasPutaway(carton: WarehouseCartonDoc): boolean {
  if (carton.status === "stowed" || carton.status === "stowed_partial" || carton.status === "split") {
    return true;
  }
  if (carton.binId) return true;
  const lines = carton.lines ?? [];
  return lines.some((l) => !!l.binId);
}

export function batchHasPutaway(cartons: WarehouseCartonDoc[]): boolean {
  return cartons.some(cartonHasPutaway);
}

export function canVoidCarton(carton: WarehouseCartonDoc, supervisor: boolean): boolean {
  if (carton.status === "voided" || carton.status === "closed") return false;
  if (supervisor) return true;
  return !cartonHasPutaway(carton) && (carton.status === "received" || carton.status === "receiving");
}

export function canEditReceivedCarton(carton: WarehouseCartonDoc, supervisor: boolean): boolean {
  if (carton.status === "voided" || carton.status === "closed") return false;
  if (supervisor) return true;
  return !cartonHasPutaway(carton) && carton.status === "received";
}

export function buildLinesFromReceiveInput(validLines: ReceiveLineInput[]): WarehouseCartonLine[] {
  return validLines.map((l, i) => {
    const sku = l.sku.trim();
    const expiry = l.expiry?.trim().slice(0, 10) || null;
    const lot = resolveReceiveLot({ sku, expiry, lot: l.lot });
    return {
    lineId: `L${i + 1}`,
    sku,
    productTitle: l.productTitle?.trim() || null,
    quantity: Math.max(1, Math.floor(l.quantity)),
    lot,
    expiry,
    condition: l.damaged ? "damaged" : "good",
    binId: null,
    allocationStatus: "unallocated" as const,
    clientId: null,
    inventoryRequestId: null,
    };
  });
}

function lineToFirestore(line: WarehouseCartonLine): Record<string, unknown> {
  return {
    lineId: line.lineId,
    sku: line.sku,
    productTitle: line.productTitle ?? null,
    quantity: Math.max(0, Math.floor(line.quantity)),
    lot: line.lot ?? null,
    expiry: line.expiry ? line.expiry.slice(0, 10) : null,
    condition: line.condition,
    binId: line.binId ?? null,
    allocationStatus: line.allocationStatus ?? "unallocated",
    clientId: line.clientId ?? null,
    inventoryRequestId: line.inventoryRequestId ?? null,
  };
}

function docToCarton(id: string, data: Record<string, unknown>): WarehouseCartonDoc {
  const linesRaw = data.lines;
  let lines: WarehouseCartonLine[] | undefined;
  if (Array.isArray(linesRaw)) {
    lines = [];
    for (const item of linesRaw) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      const sku = typeof obj.sku === "string" ? obj.sku : "";
      if (!sku) continue;
      lines.push({
        lineId: typeof obj.lineId === "string" && obj.lineId ? obj.lineId : `L${lines.length + 1}`,
        sku,
        productTitle: obj.productTitle != null ? String(obj.productTitle) : null,
        quantity: typeof obj.quantity === "number" ? obj.quantity : 0,
        lot: obj.lot != null ? String(obj.lot) : null,
        expiry: obj.expiry != null ? String(obj.expiry) : null,
        condition: obj.condition === "damaged" ? "damaged" : "good",
        binId: obj.binId != null ? String(obj.binId) : null,
        allocationStatus:
          obj.allocationStatus === "allocated" || obj.allocationStatus === "picked"
            ? (obj.allocationStatus as "allocated" | "picked")
            : "unallocated",
        clientId: obj.clientId != null ? String(obj.clientId) : null,
        inventoryRequestId:
          obj.inventoryRequestId != null ? String(obj.inventoryRequestId) : null,
      });
    }
    if (lines.length === 0) lines = undefined;
  }

  return {
    id,
    cartonCode: String(data.cartonCode ?? ""),
    sku: String(data.sku ?? ""),
    lot: data.lot != null ? String(data.lot) : null,
    expiry: data.expiry != null ? String(data.expiry) : null,
    quantity: typeof data.quantity === "number" ? data.quantity : 0,
    status: (data.status as WarehouseCartonDoc["status"]) ?? "receiving",
    clientId: data.clientId != null ? String(data.clientId) : null,
    receivedForClient:
      data.receivedForClient != null ? String(data.receivedForClient) : null,
    binId: data.binId != null ? String(data.binId) : null,
    palletId: data.palletId != null ? String(data.palletId) : null,
    productTitle: data.productTitle != null ? String(data.productTitle) : null,
    inventoryRequestId:
      data.inventoryRequestId != null ? String(data.inventoryRequestId) : null,
    barcode: String(data.barcode ?? ""),
    lines,
    isMixed: data.isMixed === true,
    isLoose: data.isLoose === true,
    trackingNumber: data.trackingNumber != null ? String(data.trackingNumber) : null,
    carrier: data.carrier != null ? String(data.carrier) : null,
    notes: data.notes != null ? String(data.notes) : null,
    photoUrl: data.photoUrl != null ? String(data.photoUrl) : null,
    receivedBy: data.receivedBy != null ? String(data.receivedBy) : null,
    stagingArea: data.stagingArea != null ? String(data.stagingArea) : null,
    receivedAt: data.receivedAt as WarehouseCartonDoc["receivedAt"],
    voidedAt: data.voidedAt as WarehouseCartonDoc["voidedAt"],
    voidedBy: data.voidedBy != null ? String(data.voidedBy) : null,
    voidReason: data.voidReason != null ? String(data.voidReason) : null,
    correctedAt: data.correctedAt as WarehouseCartonDoc["correctedAt"],
    correctedBy: data.correctedBy != null ? String(data.correctedBy) : null,
    createdAt: data.createdAt as WarehouseCartonDoc["createdAt"],
    updatedAt: data.updatedAt as WarehouseCartonDoc["updatedAt"],
  };
}

export async function getWarehouseCarton(
  warehouseId: string,
  cartonId: string
): Promise<WarehouseCartonDoc | null> {
  const snap = await getDoc(warehouseCartonDocRef(warehouseId, cartonId));
  if (!snap.exists()) return null;
  return docToCarton(snap.id, snap.data() as Record<string, unknown>);
}

export type VoidCartonsResult = {
  voidedIds: string[];
  blocked: Array<{ cartonId: string; cartonCode: string; reason: string }>;
};

/**
 * Void one or more received cartons. Operators may only void before putaway.
 * Supervisors may void at any stage (clears bin assignments on the record).
 */
export async function voidWarehouseCartons(input: {
  warehouseId: string;
  cartonIds: string[];
  reason?: string | null;
  operatorId?: string | null;
  supervisorOverride: boolean;
}): Promise<VoidCartonsResult> {
  const voidedIds: string[] = [];
  const blocked: VoidCartonsResult["blocked"] = [];
  const batch = writeBatch(db);
  const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");

  for (const cartonId of input.cartonIds) {
    const ref = warehouseCartonDocRef(input.warehouseId, cartonId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      blocked.push({ cartonId, cartonCode: cartonId, reason: "Carton not found." });
      continue;
    }
    const carton = docToCarton(snap.id, snap.data() as Record<string, unknown>);
    if (!canVoidCarton(carton, input.supervisorOverride)) {
      blocked.push({
        cartonId,
        cartonCode: carton.cartonCode,
        reason: cartonHasPutaway(carton)
          ? "Already put away — supervisor override required."
          : `Cannot void carton in status "${carton.status}".`,
      });
      continue;
    }
    if (!canTransitionCartonStatus(carton.status, "voided")) {
      assertCartonStatusTransition(carton.status, "voided");
    }

    const clearedLines = (carton.lines ?? []).map((l) => ({ ...l, binId: null }));

    batch.update(ref, {
      status: "voided",
      lines: clearedLines.map(lineToFirestore),
      binId: null,
      voidedAt: serverTimestamp(),
      voidedBy: input.operatorId ?? null,
      voidReason: input.reason?.trim() || null,
      updatedAt: serverTimestamp(),
    });

    const eventRef = doc(eventsRef);
    batch.set(eventRef, {
      type: "void_receive",
      cartonId,
      cartonCode: carton.cartonCode,
      reason: input.reason?.trim() || null,
      supervisorOverride: input.supervisorOverride,
      operatorId: input.operatorId ?? null,
      at: serverTimestamp(),
    });

    voidedIds.push(cartonId);
  }

  if (voidedIds.length > 0) await batch.commit();
  return { voidedIds, blocked };
}

/**
 * Replace lines on a received carton (same CTN code). After putaway, only supervisors
 * may save; saving resets status to `received` and clears bin assignments.
 */
export async function correctReceivedCarton(input: {
  warehouseId: string;
  cartonId: string;
  lines: ReceiveLineInput[];
  trackingNumber?: string | null;
  carrier?: string | null;
  notes?: string | null;
  operatorId?: string | null;
  supervisorOverride: boolean;
  correctionReason?: string | null;
}): Promise<WarehouseCartonDoc> {
  const ref = warehouseCartonDocRef(input.warehouseId, input.cartonId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Carton not found.");
  const carton = docToCarton(snap.id, snap.data() as Record<string, unknown>);

  if (!canEditReceivedCarton(carton, input.supervisorOverride)) {
    if (cartonHasPutaway(carton)) {
      throw new Error("Carton was put away. Supervisor override is required to edit lines.");
    }
    throw new Error(`Cannot edit carton in status "${carton.status}".`);
  }

  const validLines = input.lines.filter(
    (l) => l.sku.trim() && Math.max(0, Math.floor(l.quantity)) >= 1
  );
  if (validLines.length === 0) {
    throw new Error("At least one line with SKU and quantity ≥ 1 is required.");
  }

  const hadPutaway = cartonHasPutaway(carton);
  const lines = buildLinesFromReceiveInput(validLines);
  const totalQty = lines.reduce((s, l) => s + l.quantity, 0);
  const isMixed = new Set(lines.map((l) => l.sku)).size > 1;
  const rootSku = isMixed ? "MIXED" : lines[0].sku;
  const rootLot = isMixed ? null : lines[0].lot ?? null;
  const rootExpiry = isMixed ? null : lines[0].expiry ?? null;
  const rootTitle = isMixed
    ? `Mixed — ${new Set(lines.map((l) => l.sku)).size} SKUs`
    : lines[0].productTitle ?? null;

  const barcode = encodeCartonBarcode({
    cartonCode: carton.cartonCode,
    sku: rootSku,
    lot: rootLot,
    expiry: rootExpiry,
    quantity: totalQty,
  });

  const nextStatus: WarehouseCartonDoc["status"] =
    hadPutaway && input.supervisorOverride ? "received" : carton.status;

  if (nextStatus !== carton.status) {
    assertCartonStatusTransition(carton.status, nextStatus);
  }

  const batch = writeBatch(db);
  batch.update(ref, {
    sku: rootSku,
    lot: rootLot,
    expiry: rootExpiry,
    quantity: totalQty,
    productTitle: rootTitle,
    lines: lines.map(lineToFirestore),
    isMixed,
    barcode,
    status: nextStatus,
    binId: null,
    ...(input.trackingNumber !== undefined
      ? { trackingNumber: input.trackingNumber?.trim() || null }
      : {}),
    ...(input.carrier !== undefined ? { carrier: input.carrier?.trim() || null } : {}),
    ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
    correctedAt: serverTimestamp(),
    correctedBy: input.operatorId ?? null,
    updatedAt: serverTimestamp(),
  });

  const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");
  const eventRef = doc(eventsRef);
  batch.set(eventRef, {
    type: "receive_correct",
    cartonId: input.cartonId,
    cartonCode: carton.cartonCode,
    reason: input.correctionReason?.trim() || null,
    supervisorOverride: input.supervisorOverride,
    resetPutaway: hadPutaway && input.supervisorOverride,
    operatorId: input.operatorId ?? null,
    at: serverTimestamp(),
  });

  await batch.commit();

  const updated = await getWarehouseCarton(input.warehouseId, input.cartonId);
  if (!updated) throw new Error("Carton not found after update.");
  return updated;
}

export function palletHasPutaway(pallet: WarehousePalletDoc): boolean {
  return !!pallet.binId || !!pallet.putawayDisposition;
}

export function canVoidPallet(pallet: WarehousePalletDoc, supervisor: boolean): boolean {
  if (pallet.status === "dispatched") return false;
  if (supervisor) return true;
  return pallet.status === "receiving" && !palletHasPutaway(pallet);
}

export function canEditReceivedPallet(pallet: WarehousePalletDoc, supervisor: boolean): boolean {
  if (pallet.status === "dispatched") return false;
  if (supervisor) return true;
  return pallet.status === "receiving" && !palletHasPutaway(pallet);
}

export async function getWarehousePallet(
  warehouseId: string,
  palletId: string
): Promise<WarehousePalletDoc | null> {
  const snap = await getDoc(warehousePalletDocRef(warehouseId, palletId));
  if (!snap.exists()) return null;
  const data = snap.data() as Record<string, unknown>;
  return {
    id: snap.id,
    palletCode: String(data.palletCode ?? ""),
    status: (data.status as WarehousePalletDoc["status"]) ?? "receiving",
    binId: data.binId != null ? String(data.binId) : null,
    barcode: String(data.barcode ?? ""),
    trackingNumber: data.trackingNumber != null ? String(data.trackingNumber) : null,
    carrier: data.carrier != null ? String(data.carrier) : null,
    notes: data.notes != null ? String(data.notes) : null,
    photoUrl: data.photoUrl != null ? String(data.photoUrl) : null,
    receivedBy: data.receivedBy != null ? String(data.receivedBy) : null,
    stagingArea: data.stagingArea != null ? String(data.stagingArea) : null,
    receiveMode:
      data.receiveMode === "crossdock" || data.receiveMode === "unpackaged"
        ? data.receiveMode
        : null,
    putawayDisposition:
      data.putawayDisposition === "forward" ||
      data.putawayDisposition === "keep_closed" ||
      data.putawayDisposition === "open_for_storage"
        ? data.putawayDisposition
        : null,
    isClosedCrossdock: data.isClosedCrossdock === true,
    clientId: data.clientId != null ? String(data.clientId) : null,
    receivedForClient:
      data.receivedForClient != null ? String(data.receivedForClient) : null,
    receiveLot: data.receiveLot != null ? String(data.receiveLot) : null,
    receivedAt: data.receivedAt as WarehousePalletDoc["receivedAt"],
    createdAt: data.createdAt as WarehousePalletDoc["createdAt"],
    updatedAt: data.updatedAt as WarehousePalletDoc["updatedAt"],
  };
}

export async function correctReceivedPallet(input: {
  warehouseId: string;
  palletId: string;
  trackingNumber?: string | null;
  carrier?: string | null;
  notes?: string | null;
  clientId?: string | null;
  receivedForClient?: string | null;
  receiveLot?: string | null;
  operatorId?: string | null;
  supervisorOverride: boolean;
  correctionReason?: string | null;
}): Promise<WarehousePalletDoc> {
  const ref = warehousePalletDocRef(input.warehouseId, input.palletId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Pallet not found.");
  const pallet = await getWarehousePallet(input.warehouseId, input.palletId);
  if (!pallet) throw new Error("Pallet not found.");

  if (!canEditReceivedPallet(pallet, input.supervisorOverride)) {
    if (palletHasPutaway(pallet)) {
      throw new Error("Pallet was put away. Supervisor override is required to edit.");
    }
    throw new Error(`Cannot edit pallet in status "${pallet.status}".`);
  }

  const hadPutaway = palletHasPutaway(pallet);
  if (hadPutaway && input.supervisorOverride && !input.correctionReason?.trim()) {
    throw new Error("Correction reason is required after putaway.");
  }

  const batch = writeBatch(db);
  batch.update(ref, {
    ...(input.trackingNumber !== undefined
      ? { trackingNumber: input.trackingNumber?.trim() || null }
      : {}),
    ...(input.carrier !== undefined ? { carrier: input.carrier?.trim() || null } : {}),
    ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
    ...(input.clientId !== undefined ? { clientId: input.clientId?.trim() || null } : {}),
    ...(input.receivedForClient !== undefined
      ? { receivedForClient: input.receivedForClient?.trim() || null }
      : {}),
    ...(input.receiveLot !== undefined
      ? { receiveLot: input.receiveLot?.trim() || null }
      : {}),
    ...(hadPutaway && input.supervisorOverride
      ? { binId: null, putawayDisposition: null }
      : {}),
    updatedAt: serverTimestamp(),
  });

  const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");
  batch.set(doc(eventsRef), {
    type: "receive_correct",
    palletId: input.palletId,
    palletCode: pallet.palletCode,
    reason: input.correctionReason?.trim() || null,
    supervisorOverride: input.supervisorOverride,
    resetPutaway: hadPutaway && input.supervisorOverride,
    operatorId: input.operatorId ?? null,
    at: serverTimestamp(),
  });

  await batch.commit();
  const updated = await getWarehousePallet(input.warehouseId, input.palletId);
  if (!updated) throw new Error("Pallet not found after update.");
  return updated;
}

export type VoidPalletResult = {
  voided: boolean;
  reason?: string;
};

/** Remove a mistaken pallet receive (PLT-only). Blocked when cartons still reference the pallet. */
export async function voidWarehousePallet(input: {
  warehouseId: string;
  palletId: string;
  reason?: string | null;
  operatorId?: string | null;
  supervisorOverride: boolean;
}): Promise<VoidPalletResult> {
  const pallet = await getWarehousePallet(input.warehouseId, input.palletId);
  if (!pallet) return { voided: false, reason: "Pallet not found." };

  if (await palletHasChildCartons(input.warehouseId, input.palletId)) {
    return {
      voided: false,
      reason: "Cartons are still linked to this pallet — void those cartons first.",
    };
  }

  if (!canVoidPallet(pallet, input.supervisorOverride)) {
    return {
      voided: false,
      reason: palletHasPutaway(pallet)
        ? "Already put away — supervisor override required."
        : `Cannot void pallet in status "${pallet.status}".`,
    };
  }

  const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");
  const batch = writeBatch(db);
  batch.set(doc(eventsRef), {
    type: "void_receive",
    palletId: input.palletId,
    palletCode: pallet.palletCode,
    reason: input.reason?.trim() || null,
    supervisorOverride: input.supervisorOverride,
    operatorId: input.operatorId ?? null,
    at: serverTimestamp(),
  });
  await batch.commit();
  await deleteDoc(warehousePalletDocRef(input.warehouseId, input.palletId));
  return { voided: true };
}

/** Session storage key for undo-last-batch + form restore. */
export function lastReceiveBatchStorageKey(warehouseId: string): string {
  return `psf_last_receive_batch_${warehouseId}`;
}

export type StoredReceiveFormSnapshot = {
  type: "carton" | "pallet" | "loose";
  trackingNumber: string;
  carrier: string;
  carrierAutoDetected: boolean;
  notes: string;
  cartons: Array<{
    id: string;
    copies: string;
    clientId?: string;
    clientLabel?: string;
    crossdockLot?: string;
    lines: Array<{
      id: string;
      sku: string;
      productTitle: string;
      goodQty: string;
      damagedQty: string;
      lot: string;
      expiry: string;
    }>;
  }>;
  palletClientId?: string;
  palletClientLabel?: string;
  palletCrossdockLot?: string;
  /** Loose inventory — default client for all cartons in the batch */
  shipmentClientId?: string;
  shipmentClientLabel?: string;
};

export type StoredLastReceiveBatch = {
  cartonIds: string[];
  palletId: string | null;
  palletCode: string | null;
  formSnapshot: StoredReceiveFormSnapshot;
  savedAt: number;
};

export function readStoredLastBatch(warehouseId: string): StoredLastReceiveBatch | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(lastReceiveBatchStorageKey(warehouseId));
    if (!raw) return null;
    return JSON.parse(raw) as StoredLastReceiveBatch;
  } catch {
    return null;
  }
}

export function writeStoredLastBatch(warehouseId: string, data: StoredLastReceiveBatch): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(lastReceiveBatchStorageKey(warehouseId), JSON.stringify(data));
}

export function clearStoredLastBatch(warehouseId: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(lastReceiveBatchStorageKey(warehouseId));
}

/** Convert stored / live carton lines into editable good/damaged draft rows. */
export function cartonToLineDrafts(carton: WarehouseCartonDoc): Array<{
  id: string;
  sku: string;
  productTitle: string;
  goodQty: string;
  damagedQty: string;
  lot: string;
  expiry: string;
}> {
  const lines = carton.lines ?? [];
  if (lines.length === 0) {
    return [
      {
        id: `ln_${Math.random().toString(36).slice(2, 9)}`,
        sku: carton.sku === "MIXED" ? "" : carton.sku,
        productTitle: carton.productTitle ?? "",
        goodQty: String(carton.quantity || 1),
        damagedQty: "0",
        lot: carton.lot ?? "",
        expiry: carton.expiry ?? "",
      },
    ];
  }

  const bySku = new Map<
    string,
    {
      sku: string;
      productTitle: string;
      goodQty: number;
      damagedQty: number;
      lot: string;
      expiry: string;
    }
  >();

  for (const l of lines) {
    const key = `${l.sku}|${l.lot ?? ""}|${l.expiry ?? ""}`;
    const row = bySku.get(key) ?? {
      sku: l.sku,
      productTitle: l.productTitle ?? "",
      goodQty: 0,
      damagedQty: 0,
      lot: l.lot ?? "",
      expiry: l.expiry ?? "",
    };
    if (l.condition === "damaged") row.damagedQty += l.quantity;
    else row.goodQty += l.quantity;
    bySku.set(key, row);
  }

  return Array.from(bySku.values()).map((r) => ({
    id: `ln_${Math.random().toString(36).slice(2, 9)}`,
    sku: r.sku,
    productTitle: r.productTitle,
    goodQty: String(r.goodQty || 0),
    damagedQty: String(r.damagedQty || 0),
    lot: r.lot,
    expiry: r.expiry,
  }));
}

export function lineDraftsToReceiveInput(
  drafts: Array<{
    sku: string;
    productTitle: string;
    goodQty: string;
    damagedQty: string;
    lot: string;
    expiry: string;
  }>
): ReceiveLineInput[] {
  const out: ReceiveLineInput[] = [];
  for (const l of drafts) {
    const good = Math.max(0, parseInt(l.goodQty, 10) || 0);
    const dmg = Math.max(0, parseInt(l.damagedQty, 10) || 0);
    const sku = l.sku.trim();
    const expiry = l.expiry.trim() || null;
    const lot = resolveReceiveLot({ sku, expiry, lot: l.lot });
    if (good > 0) {
      out.push({
        sku,
        productTitle: l.productTitle.trim() || null,
        quantity: good,
        lot,
        expiry,
        damaged: false,
      });
    }
    if (dmg > 0) {
      out.push({
        sku,
        productTitle: l.productTitle.trim() || null,
        quantity: dmg,
        lot,
        expiry,
        damaged: true,
      });
    }
  }
  return out;
}
