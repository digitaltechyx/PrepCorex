import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { warehouseCartonDocRef } from "@/lib/warehouse-carton-firestore";
import { assertCartonStatusTransition } from "@/lib/warehouse-carton-states";
import { getAreaPurposes, purposeKey } from "@/lib/warehouse-area-purposes";
import {
  CROSSDOCK_CLOSED_SKU,
  isCrossdockClosedCarton,
} from "@/lib/warehouse-crossdock";
import { resolveReceiveLot } from "@/lib/warehouse-receive-lot";
import type {
  WarehouseAreaDoc,
  WarehouseCartonDoc,
  WarehouseCartonLine,
  WarehousePutawayDisposition,
} from "@/types";

const WAREHOUSES = "warehouses";

export function needsCrossdockPutawayChoice(carton: WarehouseCartonDoc): boolean {
  if (carton.receiveMode !== "crossdock") return false;
  if (carton.putawayDisposition) return false;
  return true;
}

export function isCrossdockAreaPlaced(carton: WarehouseCartonDoc): boolean {
  const d = carton.putawayDisposition;
  return d === "forward" || d === "keep_closed";
}

export function areasForDisposition(
  areas: WarehouseAreaDoc[],
  disposition: "forward" | "keep_closed"
): WarehouseAreaDoc[] {
  const active = areas.filter((a) => a.active !== false);
  if (disposition === "forward") {
    return active.filter((a) => {
      const keys = getAreaPurposes(a).map(purposeKey);
      return keys.some((k) => k === "dispatch" || k === "packing");
    });
  }
  return active.filter((a) => {
    const keys = getAreaPurposes(a).map(purposeKey);
    return keys.some((k) => k === "receiving" || k === "storage");
  });
}

/** Fallback when no purpose-tagged areas exist — any active area. */
export function fallbackAreas(areas: WarehouseAreaDoc[]): WarehouseAreaDoc[] {
  return areas.filter((a) => a.active !== false);
}

export async function applyCrossdockAreaPutaway(input: {
  warehouseId: string;
  cartonId: string;
  carton: WarehouseCartonDoc;
  disposition: "forward" | "keep_closed";
  stagingArea: string;
  operatorId?: string | null;
}): Promise<void> {
  const stagingArea = input.stagingArea.trim();
  if (!stagingArea) throw new Error("Select a staging area.");

  const nextStatus = input.disposition === "forward" ? "on_hold" : "received";
  assertCartonStatusTransition(input.carton.status, nextStatus);

  const batch = writeBatch(db);
  batch.update(warehouseCartonDocRef(input.warehouseId, input.cartonId), {
    putawayDisposition: input.disposition,
    stagingArea,
    status: nextStatus,
    updatedAt: serverTimestamp(),
  });

  const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");
  batch.set(doc(eventsRef), {
    type: "putaway",
    cartonId: input.cartonId,
    cartonCode: input.carton.cartonCode,
    lineId: null,
    sku: input.carton.sku,
    quantity: input.carton.quantity,
    condition: null,
    toBinId: null,
    toBinPath: null,
    stagingArea,
    putawayDisposition: input.disposition,
    operatorId: input.operatorId ?? null,
    at: serverTimestamp(),
  });

  await batch.commit();
}

export type OpenCrossdockLineInput = {
  sku: string;
  quantity: number;
  lot?: string | null;
  expiry?: string | null;
  productTitle?: string | null;
};

/** Replace CLOSED placeholder lines with real SKU manifest before bin putaway. */
/** Cross-dock carton already has SKU lines — skip capture, go to bins. */
export async function markCrossdockOpenForStorage(input: {
  warehouseId: string;
  cartonId: string;
}): Promise<void> {
  const batch = writeBatch(db);
  batch.update(warehouseCartonDocRef(input.warehouseId, input.cartonId), {
    putawayDisposition: "open_for_storage",
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function openCrossdockCartonForStorage(input: {
  warehouseId: string;
  cartonId: string;
  carton: WarehouseCartonDoc;
  lines: OpenCrossdockLineInput[];
  operatorId?: string | null;
}): Promise<void> {
  if (!isCrossdockClosedCarton(input.carton)) {
    throw new Error("This carton is not a closed cross-dock unit.");
  }

  const valid = input.lines
    .map((l) => ({
      sku: l.sku.trim(),
      quantity: Math.max(0, Math.floor(l.quantity)),
      lot: l.lot?.trim() || null,
      expiry: l.expiry?.trim().slice(0, 10) || null,
      productTitle: l.productTitle?.trim() || null,
    }))
    .filter((l) => l.sku && l.quantity >= 1);

  if (valid.length === 0) {
    throw new Error("Add at least one SKU with quantity ≥ 1.");
  }

  const lines: WarehouseCartonLine[] = valid.map((l, i) => {
    const lot = resolveReceiveLot({ sku: l.sku, expiry: l.expiry, lot: l.lot });
    return {
      lineId: `L${i + 1}`,
      sku: l.sku,
      productTitle: l.productTitle,
      quantity: l.quantity,
      lot,
      expiry: l.expiry,
      condition: "good" as const,
      binId: null,
      allocationStatus: "unallocated" as const,
      clientId: input.carton.clientId ?? null,
      inventoryRequestId: input.carton.inventoryRequestId ?? null,
    };
  });

  const isMixed = new Set(lines.map((l) => l.sku)).size > 1;
  const rootSku = isMixed ? "MIXED" : lines[0].sku;
  const rootLot = isMixed ? null : lines[0].lot ?? null;
  const rootExpiry = isMixed ? null : lines[0].expiry ?? null;
  const rootTitle = isMixed
    ? `Mixed — ${new Set(lines.map((l) => l.sku)).size} SKUs`
    : lines[0].productTitle ?? null;
  const totalQty = lines.reduce((s, l) => s + l.quantity, 0);

  const batch = writeBatch(db);
  batch.update(warehouseCartonDocRef(input.warehouseId, input.cartonId), {
    lines: lines.map((l) => ({
      lineId: l.lineId,
      sku: l.sku,
      productTitle: l.productTitle ?? null,
      quantity: l.quantity,
      lot: l.lot ?? null,
      expiry: l.expiry ? l.expiry.slice(0, 10) : null,
      condition: l.condition,
      binId: null,
      allocationStatus: l.allocationStatus ?? "unallocated",
      clientId: l.clientId ?? null,
      inventoryRequestId: l.inventoryRequestId ?? null,
    })),
    sku: rootSku,
    lot: rootLot,
    expiry: rootExpiry,
    productTitle: rootTitle,
    quantity: totalQty,
    isMixed,
    isClosedCrossdock: false,
    putawayDisposition: "open_for_storage",
    updatedAt: serverTimestamp(),
  });

  const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");
  batch.set(doc(eventsRef), {
    type: "putaway",
    cartonId: input.cartonId,
    cartonCode: input.carton.cartonCode,
    lineId: null,
    sku: CROSSDOCK_CLOSED_SKU,
    quantity: null,
    condition: null,
    toBinId: null,
    toBinPath: null,
    putawayDisposition: "open_for_storage",
    note: `Opened for storage — ${lines.length} SKU line(s)`,
    operatorId: input.operatorId ?? null,
    at: serverTimestamp(),
  });

  await batch.commit();
}

export async function listWarehouseAreas(warehouseId: string): Promise<WarehouseAreaDoc[]> {
  const snap = await getDocs(collection(db, WAREHOUSES, warehouseId, "areas"));
  return snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    return {
      id: d.id,
      code: String(data.code ?? ""),
      name: data.name != null ? String(data.name) : undefined,
      purposes: Array.isArray(data.purposes) ? (data.purposes as string[]) : undefined,
      areaType: data.areaType != null ? String(data.areaType) : undefined,
      active: data.active !== false,
      createdAt: data.createdAt as WarehouseAreaDoc["createdAt"],
      updatedAt: data.updatedAt as WarehouseAreaDoc["updatedAt"],
    };
  });
}

export const DISPOSITION_LABELS: Record<WarehousePutawayDisposition, string> = {
  forward: "Forward (prep / dispatch)",
  keep_closed: "Keep closed (staging)",
  open_for_storage: "Open for storage (bins)",
};
