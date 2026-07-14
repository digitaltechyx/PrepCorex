import {
  collection,
  doc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  createWarehouseCarton,
  warehousePalletDocRef,
} from "@/lib/warehouse-carton-firestore";
import { resolveReceiveLot } from "@/lib/warehouse-receive-lot";
import type { OpenCrossdockLineInput } from "@/lib/warehouse-putaway-disposition";
import type {
  WarehouseCartonLine,
  WarehousePalletDoc,
  WarehousePalletStatus,
} from "@/types";

const WAREHOUSES = "warehouses";

export function isClosedCrossdockPallet(pallet: WarehousePalletDoc): boolean {
  return pallet.isClosedCrossdock === true;
}

export function needsPalletPutawayChoice(pallet: WarehousePalletDoc): boolean {
  if (!isClosedCrossdockPallet(pallet)) return false;
  if (pallet.putawayDisposition) return false;
  return true;
}

export function isPalletAreaPlaced(pallet: WarehousePalletDoc): boolean {
  const d = pallet.putawayDisposition;
  return d === "forward" || d === "keep_closed";
}

export async function applyPalletCrossdockAreaPutaway(input: {
  warehouseId: string;
  palletId: string;
  pallet: WarehousePalletDoc;
  disposition: "forward" | "keep_closed";
  stagingArea: string;
  operatorId?: string | null;
}): Promise<void> {
  const stagingArea = input.stagingArea.trim();
  if (!stagingArea) throw new Error("Select a staging area.");

  const nextStatus: WarehousePalletStatus =
    input.disposition === "forward" ? "on_hold" : "receiving";

  // Forward: Pack first, then Dispatch (not ready until pack complete).
  const crossdockPatch =
    input.disposition === "forward"
      ? {
          crossdockDispatchStatus: "awaiting_pack" as const,
        }
      : {};

  const batch = writeBatch(db);
  batch.update(warehousePalletDocRef(input.warehouseId, input.palletId), {
    putawayDisposition: input.disposition,
    stagingArea,
    status: nextStatus,
    ...crossdockPatch,
    updatedAt: serverTimestamp(),
  });

  const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");
  batch.set(doc(eventsRef), {
    type: "putaway",
    palletId: input.palletId,
    palletCode: input.pallet.palletCode,
    cartonId: null,
    cartonCode: null,
    lineId: null,
    sku: null,
    quantity: null,
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

/** Open a closed cross-dock pallet — capture SKU manifest and create a carton on the pallet. */
export async function openCrossdockPalletForStorage(input: {
  warehouseId: string;
  palletId: string;
  pallet: WarehousePalletDoc;
  lines: OpenCrossdockLineInput[];
  operatorId?: string | null;
}): Promise<{ cartonId: string }> {
  if (!isClosedCrossdockPallet(input.pallet)) {
    throw new Error("This pallet is not a closed cross-dock unit.");
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
      clientId: input.pallet.clientId ?? null,
      inventoryRequestId: null,
    };
  });

  const isMixed = new Set(lines.map((l) => l.sku)).size > 1;
  const rootSku = isMixed ? "MIXED" : lines[0].sku;
  const rootLot = isMixed ? input.pallet.receiveLot ?? null : lines[0].lot ?? null;
  const rootExpiry = isMixed ? null : lines[0].expiry ?? null;
  const rootTitle = isMixed
    ? `Mixed — ${new Set(lines.map((l) => l.sku)).size} SKUs`
    : lines[0].productTitle ?? null;
  const totalQty = lines.reduce((s, l) => s + l.quantity, 0);

  const cartonId = await createWarehouseCarton({
    warehouseId: input.warehouseId,
    sku: rootSku,
    quantity: totalQty,
    lot: rootLot,
    expiry: rootExpiry,
    productTitle: rootTitle,
    status: "received",
    palletId: input.palletId,
    clientId: input.pallet.clientId ?? null,
    receivedForClient: input.pallet.receivedForClient ?? null,
    lines,
    isMixed,
    receiveMode: "crossdock",
    isClosedCrossdock: false,
    putawayDisposition: "open_for_storage",
    trackingNumber: input.pallet.trackingNumber ?? null,
    carrier: input.pallet.carrier ?? null,
    notes: input.pallet.notes ?? null,
    receivedBy: input.pallet.receivedBy ?? null,
    stagingArea: input.pallet.stagingArea ?? null,
  });

  const batch = writeBatch(db);
  batch.update(warehousePalletDocRef(input.warehouseId, input.palletId), {
    isClosedCrossdock: false,
    putawayDisposition: "open_for_storage",
    updatedAt: serverTimestamp(),
  });

  const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");
  batch.set(doc(eventsRef), {
    type: "putaway",
    palletId: input.palletId,
    palletCode: input.pallet.palletCode,
    cartonId,
    lineId: null,
    sku: rootSku,
    quantity: totalQty,
    condition: null,
    toBinId: null,
    toBinPath: null,
    putawayDisposition: "open_for_storage",
    note: `Opened pallet for storage — ${lines.length} SKU line(s)`,
    operatorId: input.operatorId ?? null,
    at: serverTimestamp(),
  });

  await batch.commit();
  return { cartonId };
}

/** Mark pallet fully stowed when every child carton line has a bin. */
export async function markPalletStowedIfComplete(input: {
  warehouseId: string;
  palletId: string;
  pallet: WarehousePalletDoc;
}): Promise<boolean> {
  if (input.pallet.status === "available" || input.pallet.status === "dispatched") {
    return false;
  }
  const batch = writeBatch(db);
  batch.update(warehousePalletDocRef(input.warehouseId, input.palletId), {
    status: "available",
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  return true;
}
