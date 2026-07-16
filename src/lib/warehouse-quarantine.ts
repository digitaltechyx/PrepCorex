import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  listWarehouseCartons,
  parseWarehouseCartonDoc,
  warehouseCartonDocRef,
} from "@/lib/warehouse-carton-firestore";
import {
  isLinePutawayPlaced,
  linesToFirestorePayload,
  nextCartonLineId,
  rollCartonBinStateFromLines,
  rollupCartonStagingArea,
} from "@/lib/warehouse-carton-line-utils";
import { findBinByPath, validateLineToBin, inspectBinContents } from "@/lib/warehouse-putaway";
import { listWarehouseAreas, areasForPacking } from "@/lib/warehouse-putaway-disposition";
import { getAreaPurposes, purposeKey } from "@/lib/warehouse-area-purposes";
import { assertCartonStatusTransition } from "@/lib/warehouse-carton-states";
import type {
  WarehouseCartonDoc,
  WarehouseCartonLine,
  WarehouseCartonStatus,
  WarehouseDoc,
} from "@/types";

export type QuarantineHoldRow = {
  warehouseId: string;
  cartonId: string;
  cartonCode: string;
  line: WarehouseCartonLine;
  clientId: string | null;
  clientLabel: string | null;
  binId: string | null;
  stagingArea: string | null;
  quarantineAt: Date;
  /** Calendar days since the line entered quarantine (informational only). */
  daysInQuarantine: number;
};

/** @deprecated Hold window removed — operators dispose manually. Kept for API compat. */
export const QUARANTINE_HOLD_DAYS = 0;

const WAREHOUSES = "warehouses";

function toDate(value: unknown, fallback?: Date | null): Date | null {
  if (!value) return fallback ?? null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? fallback ?? null : value;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? fallback ?? null : d;
  }
  if (typeof value === "object" && value !== null && "seconds" in value) {
    const sec = Number((value as { seconds: unknown }).seconds);
    if (!Number.isFinite(sec)) return fallback ?? null;
    return new Date(sec * 1000);
  }
  return fallback ?? null;
}

function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

export function resolveQuarantineStart(
  line: WarehouseCartonLine,
  carton: WarehouseCartonDoc
): Date | null {
  return (
    toDate(line.quarantineAt) ||
    toDate(carton.updatedAt) ||
    toDate(carton.receivedAt) ||
    toDate(carton.createdAt)
  );
}

export function isActiveQuarantineLine(line: WarehouseCartonLine): boolean {
  if (line.condition !== "damaged") return false;
  if (line.quarantineDisposedAt) return false;
  if (line.quantity <= 0) return false;
  return Boolean(line.binId?.trim() || line.stagingArea?.trim());
}

export async function listQuarantineHolds(warehouseId: string): Promise<QuarantineHoldRow[]> {
  const cartons = await listWarehouseCartons(warehouseId);
  const now = new Date();
  const rows: QuarantineHoldRow[] = [];

  for (const carton of cartons) {
    if (carton.status === "voided" || carton.status === "closed") continue;
    for (const line of carton.lines ?? []) {
      if (!isActiveQuarantineLine(line)) continue;
      const start = resolveQuarantineStart(line, carton);
      if (!start) continue;
      const daysIn = Math.max(0, daysBetween(start, now));
      rows.push({
        warehouseId,
        cartonId: carton.id,
        cartonCode: carton.cartonCode,
        line,
        clientId: line.clientId?.trim() || carton.clientId?.trim() || null,
        clientLabel: carton.receivedForClient?.trim() || null,
        binId: line.binId ?? null,
        stagingArea: line.stagingArea ?? null,
        quarantineAt: start,
        daysInQuarantine: daysIn,
      });
    }
  }

  rows.sort(
    (a, b) =>
      (b.quarantineAt?.getTime() ?? 0) - (a.quarantineAt?.getTime() ?? 0) ||
      a.cartonCode.localeCompare(b.cartonCode)
  );
  return rows;
}

async function findClientInventoryRef(input: {
  clientUserId: string;
  sku: string;
  productTitle?: string | null;
  inventoryRequestId?: string | null;
}) {
  const inventoryCol = collection(db, "users", input.clientUserId, "inventory");
  const reqId = input.inventoryRequestId?.trim();
  if (reqId) {
    const byReq = await getDocs(
      query(inventoryCol, where("sourceRequestId", "==", reqId), limit(5))
    );
    const skuMatch = byReq.docs.find(
      (d) => String(d.data().sku ?? "").trim().toLowerCase() === input.sku.trim().toLowerCase()
    );
    if (skuMatch) return skuMatch.ref;
    if (!byReq.empty && byReq.size === 1) return byReq.docs[0].ref;
  }
  if (input.sku.trim()) {
    const bySku = await getDocs(query(inventoryCol, where("sku", "==", input.sku.trim()), limit(5)));
    if (!bySku.empty) return bySku.docs[0].ref;
  }
  return null;
}

function buildDisposeRemarks(input: {
  cartonCode: string;
  sku: string;
  quantity: number;
  daysInQuarantine: number;
  quarantineAt: Date;
  auto: boolean;
  lot?: string | null;
  operatorName?: string | null;
}): string {
  const when = input.quarantineAt.toISOString().slice(0, 10);
  const mode = input.auto
    ? "Automatic dispose from quarantine (legacy cron)."
    : `Manual dispose from quarantine by warehouse operator${
        input.operatorName ? ` (${input.operatorName})` : ""
      }.`;
  return [
    mode,
    `Carton/PKG: ${input.cartonCode}`,
    `SKU: ${input.sku}`,
    `Quantity disposed: ${input.quantity}`,
    input.lot ? `Lot: ${input.lot}` : null,
    `Entered quarantine: ${when}`,
    `Days in quarantine: ${input.daysInQuarantine}`,
    "Damaged receive stock was held in quarantine and removed from client on-hand damaged qty.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Operator releases damaged quarantine stock into normal storage as good.
 * Client inventory: damagedQuantity ↓, sellable quantity ↑.
 */
export async function releaseQuarantineLineToStorage(input: {
  warehouseId: string;
  cartonId: string;
  lineId: string;
  destBinPath: string;
  quantity?: number;
  operatorId?: string | null;
}): Promise<{ releasedQty: number }> {
  const cartonRef = warehouseCartonDocRef(input.warehouseId, input.cartonId);
  const snap = await getDoc(cartonRef);
  if (!snap.exists()) throw new Error("Carton not found.");
  const carton = parseWarehouseCartonDoc(snap.id, snap.data() as Record<string, unknown>);
  const lines = [...(carton.lines ?? [])];
  const idx = lines.findIndex((l) => l.lineId === input.lineId);
  if (idx < 0) throw new Error("Line not found.");
  const line = lines[idx];
  if (!isActiveQuarantineLine(line)) throw new Error("Line is not active quarantine stock.");

  const qty = Math.min(
    line.quantity,
    Math.max(1, Math.floor(input.quantity ?? line.quantity))
  );
  const bin = await findBinByPath(input.warehouseId, input.destBinPath);
  if (!bin) throw new Error("Destination bin not found.");
  const areas = await listWarehouseAreas(input.warehouseId);
  const contents = await inspectBinContents(input.warehouseId, bin.id);
  const probe: WarehouseCartonLine = { ...line, condition: "good", quantity: qty };
  const validation = validateLineToBin(probe, bin, contents, areas);
  if (!validation.ok) throw new Error(validation.reason);

  const now = new Date();
  let nextLines = [...lines];
  if (qty === line.quantity) {
    nextLines[idx] = {
      ...line,
      condition: "good",
      binId: bin.id,
      stagingArea: null,
      quarantineAt: null,
      quarantineReleasedAt: now,
    };
  } else {
    nextLines[idx] = { ...line, quantity: line.quantity - qty };
    nextLines.push({
      ...line,
      lineId: `L${nextLines.length + 1}_${Date.now().toString(36)}`,
      quantity: qty,
      condition: "good",
      binId: bin.id,
      stagingArea: null,
      quarantineAt: null,
      quarantineReleasedAt: now,
    });
  }

  const rolled = rollCartonBinStateFromLines(carton, nextLines);
  const batch = writeBatch(db);
  batch.update(cartonRef, {
    lines: linesToFirestorePayload(nextLines),
    status: rolled.status,
    binId: rolled.binId,
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(collection(db, WAREHOUSES, input.warehouseId, "movementEvents")), {
    type: "quarantine_release",
    cartonId: input.cartonId,
    cartonCode: carton.cartonCode,
    lineId: input.lineId,
    sku: line.sku,
    quantity: qty,
    fromBinId: line.binId ?? null,
    toBinId: bin.id,
    toBinPath: bin.path,
    operatorId: input.operatorId ?? null,
    at: serverTimestamp(),
  });
  await batch.commit();

  const clientId = line.clientId?.trim() || carton.clientId?.trim() || "";
  if (clientId) {
    const invRef = await findClientInventoryRef({
      clientUserId: clientId,
      sku: line.sku,
      productTitle: line.productTitle,
      inventoryRequestId: line.inventoryRequestId,
    });
    if (invRef) {
      const invSnap = await getDoc(invRef);
      if (invSnap.exists()) {
        const data = invSnap.data() as {
          quantity?: number;
          damagedQuantity?: number;
        };
        const prevGood = Math.max(0, Number(data.quantity ?? 0));
        const prevDmg = Math.max(0, Number(data.damagedQuantity ?? 0));
        const nextDmg = Math.max(0, prevDmg - qty);
        const nextGood = prevGood + qty;
        await updateDoc(invRef, {
          quantity: nextGood,
          damagedQuantity: nextDmg,
          status: nextGood > 0 ? "In Stock" : "Out of Stock",
          updatedAt: serverTimestamp(),
        });
      }
    }
  }

  return { releasedQty: qty };
}

async function decreaseClientDamagedQty(input: {
  clientId: string;
  sku: string;
  productTitle?: string | null;
  inventoryRequestId?: string | null;
  quantity: number;
}): Promise<void> {
  if (!input.clientId || input.quantity <= 0) return;
  const invRef = await findClientInventoryRef({
    clientUserId: input.clientId,
    sku: input.sku,
    productTitle: input.productTitle,
    inventoryRequestId: input.inventoryRequestId,
  });
  if (!invRef) return;
  const invSnap = await getDoc(invRef);
  if (!invSnap.exists()) return;
  const data = invSnap.data() as { quantity?: number; damagedQuantity?: number };
  const prevGood = Math.max(0, Number(data.quantity ?? 0));
  const prevDmg = Math.max(0, Number(data.damagedQuantity ?? 0));
  const nextDmg = Math.max(0, prevDmg - input.quantity);
  await updateDoc(invRef, {
    damagedQuantity: nextDmg,
    status: prevGood > 0 ? "In Stock" : "Out of Stock",
    updatedAt: serverTimestamp(),
  });
}

function resolveStatusAfterQuarantineReturn(
  carton: WarehouseCartonDoc,
  nextLines: WarehouseCartonLine[]
): WarehouseCartonStatus {
  const active = nextLines.filter((l) => l.quantity > 0);
  const placed = active.filter(isLinePutawayPlaced);
  const awaiting = active.filter((l) => !isLinePutawayPlaced(l));
  if (awaiting.length > 0 && placed.length === 0) return "received";
  if (awaiting.length > 0 && placed.length > 0) return "stowed_partial";
  const rolled = rollCartonBinStateFromLines(carton, nextLines);
  return rolled.status as WarehouseCartonStatus;
}

/**
 * Return quarantine stock to the Putaway queue (bin or area as usual).
 * Damaged client qty is reduced now; putaway will credit good stock when stowed.
 */
export async function returnQuarantineLineToPutaway(input: {
  warehouseId: string;
  cartonId: string;
  lineId: string;
  quantity?: number;
  operatorId?: string | null;
}): Promise<{ returnedQty: number; cartonCode: string }> {
  const cartonRef = warehouseCartonDocRef(input.warehouseId, input.cartonId);
  const snap = await getDoc(cartonRef);
  if (!snap.exists()) throw new Error("Carton not found.");
  const carton = parseWarehouseCartonDoc(snap.id, snap.data() as Record<string, unknown>);
  const lines = [...(carton.lines ?? [])];
  const idx = lines.findIndex((l) => l.lineId === input.lineId);
  if (idx < 0) throw new Error("Line not found.");
  const line = lines[idx];
  if (!isActiveQuarantineLine(line)) throw new Error("Line is not active quarantine stock.");

  const qty = Math.min(line.quantity, Math.max(1, Math.floor(input.quantity ?? line.quantity)));
  const now = new Date();
  let nextLines = [...lines];

  if (qty === line.quantity) {
    nextLines[idx] = {
      ...line,
      condition: "good",
      binId: null,
      stagingArea: null,
      quarantineAt: null,
      quarantineReleasedAt: now,
    };
  } else {
    nextLines[idx] = { ...line, quantity: line.quantity - qty };
    nextLines.push({
      ...line,
      lineId: nextCartonLineId(nextLines),
      quantity: qty,
      condition: "good",
      binId: null,
      stagingArea: null,
      quarantineAt: null,
      quarantineReleasedAt: now,
    });
  }

  const nextStatus = resolveStatusAfterQuarantineReturn(carton, nextLines);
  assertCartonStatusTransition(carton.status, nextStatus);
  const rolled = rollCartonBinStateFromLines(carton, nextLines);

  const batch = writeBatch(db);
  batch.update(cartonRef, {
    lines: linesToFirestorePayload(nextLines),
    status: nextStatus,
    binId: rolled.binId,
    stagingArea: rollupCartonStagingArea(nextLines, carton),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(collection(db, WAREHOUSES, input.warehouseId, "movementEvents")), {
    type: "quarantine_return_putaway",
    cartonId: input.cartonId,
    cartonCode: carton.cartonCode,
    lineId: input.lineId,
    sku: line.sku,
    quantity: qty,
    operatorId: input.operatorId ?? null,
    at: serverTimestamp(),
  });
  await batch.commit();

  const clientId = line.clientId?.trim() || carton.clientId?.trim() || "";
  await decreaseClientDamagedQty({
    clientId,
    sku: line.sku,
    productTitle: line.productTitle,
    inventoryRequestId: line.inventoryRequestId,
    quantity: qty,
  });

  return { returnedQty: qty, cartonCode: carton.cartonCode };
}

/**
 * Send quarantine stock to Pack → Dispatch (creates shipped entry on dispatch).
 * Damaged client qty is reduced now; good sellable stock is not increased.
 */
export async function returnQuarantineLineToPack(input: {
  warehouseId: string;
  cartonId: string;
  lineId: string;
  packAreaId: string;
  quantity?: number;
  operatorId?: string | null;
}): Promise<{ returnedQty: number; cartonCode: string; packAreaCode: string }> {
  const areas = await listWarehouseAreas(input.warehouseId);
  const packing = areasForPacking(areas);
  const packArea = packing.find((a) => a.id === input.packAreaId);
  if (!packArea) {
    throw new Error(
      packing.length === 0
        ? "No packing area configured. Add an area with Packing purpose in warehouse setup."
        : "Select a packing area."
    );
  }
  if (!getAreaPurposes(packArea).map(purposeKey).some((k) => k === "packing")) {
    throw new Error("Destination must be a packing area.");
  }

  const cartonRef = warehouseCartonDocRef(input.warehouseId, input.cartonId);
  const snap = await getDoc(cartonRef);
  if (!snap.exists()) throw new Error("Carton not found.");
  const carton = parseWarehouseCartonDoc(snap.id, snap.data() as Record<string, unknown>);
  if (carton.status === "voided" || carton.status === "closed") {
    throw new Error("This carton cannot be returned.");
  }
  if (
    carton.crossdockDispatchStatus === "awaiting_pack" ||
    carton.crossdockDispatchStatus === "ready" ||
    carton.crossdockDispatchStatus === "dispatched"
  ) {
    throw new Error("This carton is already queued for pack or dispatch.");
  }

  const lines = [...(carton.lines ?? [])];
  const idx = lines.findIndex((l) => l.lineId === input.lineId);
  if (idx < 0) throw new Error("Line not found.");
  const line = lines[idx];
  if (!isActiveQuarantineLine(line)) throw new Error("Line is not active quarantine stock.");

  const clientId = line.clientId?.trim() || carton.clientId?.trim() || "";
  if (!clientId) {
    throw new Error("This quarantine line has no client — assign a client before pack/dispatch.");
  }

  const qty = Math.min(line.quantity, Math.max(1, Math.floor(input.quantity ?? line.quantity)));
  if (qty < line.quantity) {
    throw new Error(
      "Send to Pack needs the full line quantity. Return leftover qty to Putaway first, then Send remaining to Pack (that creates a partial ship later)."
    );
  }
  const otherQuarantine = lines.some(
    (l) => l.lineId !== line.lineId && isActiveQuarantineLine(l)
  );
  if (otherQuarantine) {
    throw new Error(
      "This carton still has other quarantine lines. Return or dispose those first, then Send to Pack."
    );
  }

  const now = new Date();
  let nextLines = [...lines];

  nextLines[idx] = {
    ...line,
    condition: "good",
    binId: null,
    stagingArea: packArea.code,
    allocationStatus: "allocated",
    clientId,
    quarantineAt: null,
    quarantineReleasedAt: now,
  };

  const nextStatus: WarehouseCartonStatus = "on_hold";
  assertCartonStatusTransition(carton.status, nextStatus);
  const rolled = rollCartonBinStateFromLines(carton, nextLines);
  const stagingArea = rollupCartonStagingArea(nextLines, carton) ?? packArea.code;

  const batch = writeBatch(db);
  batch.update(cartonRef, {
    lines: linesToFirestorePayload(nextLines),
    status: nextStatus,
    binId: rolled.binId,
    stagingArea,
    clientId,
    putawayDisposition: "return",
    crossdockDispatchStatus: "awaiting_pack",
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(collection(db, WAREHOUSES, input.warehouseId, "movementEvents")), {
    type: "quarantine_return_pack",
    cartonId: input.cartonId,
    cartonCode: carton.cartonCode,
    lineId: input.lineId,
    sku: line.sku,
    quantity: qty,
    packAreaId: packArea.id,
    packAreaCode: packArea.code,
    operatorId: input.operatorId ?? null,
    at: serverTimestamp(),
  });
  await batch.commit();

  await decreaseClientDamagedQty({
    clientId,
    sku: line.sku,
    productTitle: line.productTitle,
    inventoryRequestId: line.inventoryRequestId,
    quantity: qty,
  });

  return { returnedQty: qty, cartonCode: carton.cartonCode, packAreaCode: packArea.code };
}

/**
 * Dispose quarantine stock (manual or auto). Writes client recycledInventory with remarks.
 */
export async function disposeQuarantineLine(input: {
  warehouseId: string;
  cartonId: string;
  lineId: string;
  quantity?: number;
  auto?: boolean;
  operatorId?: string | null;
  operatorName?: string | null;
}): Promise<{ disposedQty: number; recycledId: string | null }> {
  const cartonRef = warehouseCartonDocRef(input.warehouseId, input.cartonId);
  const snap = await getDoc(cartonRef);
  if (!snap.exists()) throw new Error("Carton not found.");
  const carton = parseWarehouseCartonDoc(snap.id, snap.data() as Record<string, unknown>);
  const lines = [...(carton.lines ?? [])];
  const idx = lines.findIndex((l) => l.lineId === input.lineId);
  if (idx < 0) throw new Error("Line not found.");
  const line = lines[idx];
  if (!isActiveQuarantineLine(line)) throw new Error("Line is not active quarantine stock.");

  const qty = Math.min(
    line.quantity,
    Math.max(1, Math.floor(input.quantity ?? line.quantity))
  );
  const start = resolveQuarantineStart(line, carton) ?? new Date();
  const daysIn = Math.max(0, daysBetween(start, new Date()));
  const remarks = buildDisposeRemarks({
    cartonCode: carton.cartonCode,
    sku: line.sku,
    quantity: qty,
    daysInQuarantine: daysIn,
    quarantineAt: start,
    auto: !!input.auto,
    lot: line.lot,
    operatorName: input.operatorName,
  });

  const now = Timestamp.now();
  let recycledId: string | null = null;
  const clientId = line.clientId?.trim() || carton.clientId?.trim() || "";

  if (clientId) {
    const invRef = await findClientInventoryRef({
      clientUserId: clientId,
      sku: line.sku,
      productTitle: line.productTitle,
      inventoryRequestId: line.inventoryRequestId,
    });
    const recycledRef = doc(collection(db, "users", clientId, "recycledInventory"));
    recycledId = recycledRef.id;

    const batch = writeBatch(db);
    batch.set(recycledRef, {
      productName: line.productTitle?.trim() || line.sku,
      sku: line.sku,
      quantity: qty,
      dateAdded: now,
      status: "Out of Stock",
      recycledAt: now,
      recycledBy: input.auto
        ? "System (quarantine auto-dispose)"
        : input.operatorName?.trim() || "Warehouse operator",
      remarks,
      source: input.auto ? "quarantine_auto_dispose" : "quarantine_manual_dispose",
      cartonCode: carton.cartonCode,
      warehouseId: input.warehouseId,
    });

    if (invRef) {
      const invSnap = await getDoc(invRef);
      if (invSnap.exists()) {
        const data = invSnap.data() as {
          quantity?: number;
          damagedQuantity?: number;
          productName?: string;
          dateAdded?: unknown;
          status?: string;
        };
        const prevDmg = Math.max(0, Number(data.damagedQuantity ?? 0));
        const nextDmg = Math.max(0, prevDmg - qty);
        const good = Math.max(0, Number(data.quantity ?? 0));
        batch.update(invRef, {
          damagedQuantity: nextDmg,
          status: good > 0 ? "In Stock" : "Out of Stock",
          updatedAt: serverTimestamp(),
        });
      }
    }
    await batch.commit();
  }

  let nextLines = [...lines];
  if (qty >= line.quantity) {
    nextLines[idx] = {
      ...line,
      quantity: 0,
      binId: null,
      stagingArea: null,
      quarantineDisposedAt: now,
    };
  } else {
    nextLines[idx] = { ...line, quantity: line.quantity - qty };
  }

  const remainingActive = nextLines.some(
    (l) => l.quantity > 0 && !l.quarantineDisposedAt && (l.binId || l.stagingArea || l.condition === "good")
  );
  const remainingQty = nextLines.reduce((s, l) => s + Math.max(0, l.quantity), 0);
  const rolled = rollCartonBinStateFromLines(carton, nextLines.filter((l) => l.quantity > 0));

  await updateDoc(cartonRef, {
    lines: linesToFirestorePayload(nextLines),
    quantity: remainingQty,
    status: remainingActive && remainingQty > 0 ? rolled.status : "closed",
    binId: remainingQty > 0 ? rolled.binId : null,
    updatedAt: serverTimestamp(),
  });

  await writeBatch(db)
    .set(doc(collection(db, WAREHOUSES, input.warehouseId, "movementEvents")), {
      type: input.auto ? "quarantine_auto_dispose" : "quarantine_dispose",
      cartonId: input.cartonId,
      cartonCode: carton.cartonCode,
      lineId: input.lineId,
      sku: line.sku,
      quantity: qty,
      clientId: clientId || null,
      recycledId,
      operatorId: input.operatorId ?? null,
      at: serverTimestamp(),
    })
    .commit();

  return { disposedQty: qty, recycledId };
}

/**
 * Legacy cron helper — auto-dispose by age is disabled.
 * Operators dispose manually from the Quarantine page.
 */
export async function autoDisposeExpiredQuarantine(_warehouseId: string): Promise<{
  disposed: number;
  errors: string[];
}> {
  return { disposed: 0, errors: [] };
}

export async function autoDisposeExpiredQuarantineAllWarehouses(
  warehouses: WarehouseDoc[]
): Promise<{ warehouses: number; disposed: number; errors: string[] }> {
  return { warehouses: warehouses.length, disposed: 0, errors: [] };
}
