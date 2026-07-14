import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getAreaPurposes, purposeKey } from "@/lib/warehouse-area-purposes";
import {
  parseWarehouseCartonDoc,
  warehouseCartonDocRef,
} from "@/lib/warehouse-carton-firestore";
import {
  linesToFirestorePayload,
  rollCartonBinStateFromLines,
  rollupCartonStagingArea,
} from "@/lib/warehouse-carton-line-utils";
import { assertCartonStatusTransition } from "@/lib/warehouse-carton-states";
import { isCrossdockClosedSku } from "@/lib/warehouse-crossdock";
import { areasForPacking, listWarehouseAreas } from "@/lib/warehouse-putaway-disposition";
import type {
  UserProfile,
  WarehouseCartonDoc,
  WarehouseCartonLine,
  WarehouseCartonStatus,
} from "@/types";

const WAREHOUSES = "warehouses";

export type ReturnPackUnit = {
  id: string;
  cartonCode: string;
  barcode: string;
  clientUserId: string;
  clientDisplayName: string;
  productLabel: string;
  stagingArea: string | null;
  isClosed: boolean;
  skuSummary: string;
  quantity: number;
};

function clientDisplayFor(
  clients: UserProfile[],
  clientUserId: string,
  fallback?: string | null
): string {
  const c = clients.find((row) => row.uid === clientUserId);
  if (c) {
    const name = c.name?.trim() || c.email?.trim() || c.clientId?.trim() || clientUserId;
    return c.clientId ? `${name} (${c.clientId})` : name;
  }
  return fallback?.trim() || clientUserId;
}

function ensureLines(carton: WarehouseCartonDoc): WarehouseCartonLine[] {
  if (carton.lines && carton.lines.length > 0) return carton.lines.map((l) => ({ ...l }));
  return [
    {
      lineId: "L1",
      sku: carton.sku,
      productTitle: carton.productTitle ?? null,
      quantity: carton.quantity,
      lot: carton.lot ?? null,
      expiry: carton.expiry ?? null,
      condition: carton.status === "damaged" ? "damaged" : "good",
      binId: carton.binId ?? null,
      stagingArea: carton.stagingArea ?? null,
      allocationStatus: carton.clientId ? "allocated" : "unallocated",
      clientId: carton.clientId ?? null,
      inventoryRequestId: carton.inventoryRequestId ?? null,
    },
  ];
}

function isPackingArea(area: { purposes?: string[]; areaType?: string | null }): boolean {
  return getAreaPurposes(area).map(purposeKey).some((k) => k === "packing");
}

export function isReturnAwaitingPack(carton: WarehouseCartonDoc): boolean {
  if (carton.putawayDisposition !== "return") return false;
  if (carton.crossdockDispatchStatus !== "awaiting_pack") return false;
  if (carton.status === "closed" || carton.status === "voided") return false;
  return true;
}

export function buildReturnPackQueue(input: {
  cartons: WarehouseCartonDoc[];
  clients: UserProfile[];
}): ReturnPackUnit[] {
  const units: ReturnPackUnit[] = [];
  for (const carton of input.cartons) {
    if (!isReturnAwaitingPack(carton)) continue;
    const clientUserId =
      carton.clientId?.trim() ||
      carton.lines?.find((l) => l.clientId?.trim())?.clientId?.trim() ||
      "";
    if (!clientUserId) continue;

    const lines = ensureLines(carton).filter((l) => l.quantity > 0);
    const qty = lines.reduce((s, l) => s + l.quantity, 0);
    const closed = lines.some((l) => isCrossdockClosedSku(l.sku));
    const skuSummary = closed
      ? "Closed unit"
      : lines
          .slice(0, 3)
          .map((l) => `${l.sku}×${l.quantity}`)
          .join(", ") + (lines.length > 3 ? "…" : "");

    units.push({
      id: carton.id,
      cartonCode: carton.cartonCode,
      barcode: carton.barcode,
      clientUserId,
      clientDisplayName: clientDisplayFor(
        input.clients,
        clientUserId,
        carton.receivedForClient
      ),
      productLabel:
        carton.productTitle?.trim() ||
        (closed ? `Closed · ${carton.cartonCode}` : carton.sku),
      stagingArea: carton.stagingArea ?? null,
      isClosed: closed,
      skuSummary,
      quantity: qty,
    });
  }
  return units.sort((a, b) => a.cartonCode.localeCompare(b.cartonCode));
}

/**
 * Putaway an unallocated line (or whole closed carton) into a packing area.
 * After warehouse pack confirms, it moves to the cross-dock dispatch queue.
 */
export async function returnUnallocatedLineToPack(input: {
  warehouseId: string;
  cartonId: string;
  lineId: string;
  packAreaId: string;
  clientUserId: string;
  operatorId?: string | null;
}): Promise<{ cartonCode: string; packAreaCode: string }> {
  const clientUserId = input.clientUserId.trim();
  if (!clientUserId) throw new Error("Select a client for this return.");

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
  if (!isPackingArea(packArea)) {
    throw new Error("Destination must be a packing area.");
  }

  const snap = await getDoc(warehouseCartonDocRef(input.warehouseId, input.cartonId));
  if (!snap.exists()) throw new Error("Carton not found.");
  const carton = parseWarehouseCartonDoc(snap.id, snap.data() as Record<string, unknown>);
  if (carton.status === "voided" || carton.status === "closed") {
    throw new Error("This carton cannot be returned.");
  }
  if (carton.putawayDisposition === "return" || carton.putawayDisposition === "forward") {
    throw new Error("This carton is already on an outbound / return path.");
  }
  if (
    carton.crossdockDispatchStatus === "awaiting_pack" ||
    carton.crossdockDispatchStatus === "ready" ||
    carton.crossdockDispatchStatus === "dispatched"
  ) {
    throw new Error("This carton is already queued for pack or dispatch.");
  }

  const lines = ensureLines(carton);
  const closedAll = lines.every((l) => isCrossdockClosedSku(l.sku));
  const targetLineIds = new Set(
    closedAll ? lines.map((l) => l.lineId) : [input.lineId]
  );

  let movedQty = 0;
  const nextLines = lines.map((line) => {
    if (!targetLineIds.has(line.lineId)) return line;
    if (line.allocationStatus === "picked") {
      throw new Error(`Line ${line.sku} is picked — undo pick before returning.`);
    }
    if (line.quantity <= 0) return line;
    movedQty += line.quantity;
    return {
      ...line,
      binId: null,
      stagingArea: packArea.code,
      allocationStatus: "allocated" as const,
      clientId: clientUserId,
    };
  });

  if (movedQty <= 0) {
    throw new Error("No quantity to return for this line.");
  }

  const rolled = rollCartonBinStateFromLines(carton, nextLines);
  const stowed = nextLines.filter((l) => l.binId);
  const unstowed = nextLines.filter((l) => !l.binId && l.quantity > 0);
  let status: WarehouseCartonStatus = "on_hold";
  if (stowed.length > 0 && unstowed.length > 0) {
    status = "stowed_partial";
  }
  assertCartonStatusTransition(carton.status, status);

  const stagingArea = rollupCartonStagingArea(nextLines, carton) ?? packArea.code;

  const batch = writeBatch(db);
  batch.update(warehouseCartonDocRef(input.warehouseId, input.cartonId), {
    lines: linesToFirestorePayload(nextLines),
    status,
    binId: rolled.binId,
    stagingArea,
    clientId: clientUserId,
    putawayDisposition: "return",
    crossdockDispatchStatus: "awaiting_pack",
    updatedAt: serverTimestamp(),
  });

  const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");
  batch.set(doc(eventsRef), {
    type: "unallocated_return_to_pack",
    cartonId: input.cartonId,
    cartonCode: carton.cartonCode,
    lineId: closedAll ? null : input.lineId,
    quantity: movedQty,
    clientUserId,
    toStagingArea: packArea.code,
    packAreaId: packArea.id,
    operatorId: input.operatorId ?? null,
    at: serverTimestamp(),
  });

  await batch.commit();
  return { cartonCode: carton.cartonCode, packAreaCode: packArea.code };
}

/** Pack complete for an unallocated return — unit moves to dispatch queue. */
export async function completeReturnPack(input: {
  warehouseId: string;
  cartonId: string;
  operatorId?: string | null;
}): Promise<{ cartonCode: string }> {
  const snap = await getDoc(warehouseCartonDocRef(input.warehouseId, input.cartonId));
  if (!snap.exists()) throw new Error("Carton not found.");
  const carton = parseWarehouseCartonDoc(snap.id, snap.data() as Record<string, unknown>);

  if (!isReturnAwaitingPack(carton)) {
    throw new Error("This unit is not awaiting pack for return.");
  }

  const batch = writeBatch(db);
  batch.update(warehouseCartonDocRef(input.warehouseId, input.cartonId), {
    crossdockDispatchStatus: "ready",
    crossdockReadyToDispatchAt: serverTimestamp(),
    status: "on_hold",
    updatedAt: serverTimestamp(),
  });

  const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");
  batch.set(doc(eventsRef), {
    type: "return_pack_complete",
    cartonId: input.cartonId,
    cartonCode: carton.cartonCode,
    operatorId: input.operatorId ?? null,
    at: serverTimestamp(),
  });

  await batch.commit();
  return { cartonCode: carton.cartonCode };
}
