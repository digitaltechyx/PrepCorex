import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  warehouseCartonDocRef,
  warehousePalletDocRef,
} from "@/lib/warehouse-carton-firestore";
import {
  closedCrossdockProductTitle,
  isCrossdockClosedCarton,
} from "@/lib/warehouse-crossdock";
import { parseShipmentLabelUrls } from "@/lib/warehouse-outbound-ops";
import type { LiveFirestoreDoc } from "@/lib/warehouse-ops-live-compute";
import type {
  UserProfile,
  WarehouseCartonDoc,
  WarehousePalletDoc,
} from "@/types";

const WAREHOUSES = "warehouses";

export type CrossdockPackUnit = {
  kind: "carton" | "pallet";
  id: string;
  code: string;
  barcode: string;
  clientUserId: string;
  clientDisplayName: string;
  productLabel: string;
  stagingArea: string | null;
  disposition: "forward" | "keep_closed";
  linkedShipmentRequestId: string | null;
  labelUrls: string[];
  isClosed: boolean;
};

function clientIdFromCarton(carton: WarehouseCartonDoc): string | null {
  return carton.clientId?.trim() || carton.lines?.find((l) => l.clientId?.trim())?.clientId?.trim() || null;
}

function clientDisplayFor(clients: UserProfile[], clientUserId: string, fallback?: string | null): string {
  const c = clients.find((row) => row.uid === clientUserId);
  if (c) {
    const name = c.name?.trim() || c.email?.trim() || c.clientId?.trim() || clientUserId;
    return c.clientId ? `${name} (${c.clientId})` : name;
  }
  return fallback?.trim() || clientUserId;
}

function labelMapFromShipments(shipmentDocs: LiveFirestoreDoc[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of shipmentDocs) {
    map.set(row.id, parseShipmentLabelUrls(row.data.labelUrl));
  }
  return map;
}

export function isCrossdockAwaitingPackCarton(carton: WarehouseCartonDoc): boolean {
  if (carton.receiveMode !== "crossdock") return false;
  if (carton.crossdockDispatchStatus !== "awaiting_pack") return false;
  if (carton.status === "closed" || carton.status === "voided") return false;
  if (!clientIdFromCarton(carton)) return false;

  if (carton.putawayDisposition === "forward") return true;
  if (carton.putawayDisposition === "keep_closed") {
    return !!carton.crossdockLinkedShipmentRequestId?.trim();
  }
  return false;
}

export function isCrossdockAwaitingPackPallet(pallet: WarehousePalletDoc): boolean {
  if (pallet.receiveMode !== "crossdock") return false;
  if (pallet.crossdockDispatchStatus !== "awaiting_pack") return false;
  if (pallet.status === "dispatched") return false;
  if (!pallet.clientId?.trim()) return false;

  if (pallet.putawayDisposition === "forward") return true;
  if (pallet.putawayDisposition === "keep_closed") {
    return !!pallet.crossdockLinkedShipmentRequestId?.trim();
  }
  return false;
}

/**
 * Cross-dock carton/pallet forwarding after putaway forward (or after hold link).
 * Pack → then Dispatch ready.
 */
export function buildCrossdockPackQueue(input: {
  cartons: WarehouseCartonDoc[];
  pallets: WarehousePalletDoc[];
  clients: UserProfile[];
  shipmentDocs?: LiveFirestoreDoc[];
}): CrossdockPackUnit[] {
  const labelsByRequest = labelMapFromShipments(input.shipmentDocs ?? []);
  const units: CrossdockPackUnit[] = [];

  for (const carton of input.cartons) {
    if (!isCrossdockAwaitingPackCarton(carton)) continue;
    const clientUserId = clientIdFromCarton(carton)!;
    const linkedId = carton.crossdockLinkedShipmentRequestId?.trim() || null;
    units.push({
      kind: "carton",
      id: carton.id,
      code: carton.cartonCode,
      barcode: carton.barcode,
      clientUserId,
      clientDisplayName: clientDisplayFor(input.clients, clientUserId, carton.receivedForClient),
      productLabel:
        carton.productTitle?.trim() ||
        (isCrossdockClosedCarton(carton)
          ? closedCrossdockProductTitle(carton.receivedForClient)
          : carton.sku),
      stagingArea: carton.stagingArea ?? null,
      disposition: carton.putawayDisposition as "forward" | "keep_closed",
      linkedShipmentRequestId: linkedId,
      labelUrls: linkedId ? labelsByRequest.get(linkedId) ?? [] : [],
      isClosed: isCrossdockClosedCarton(carton),
    });
  }

  for (const pallet of input.pallets) {
    if (!isCrossdockAwaitingPackPallet(pallet)) continue;
    const clientUserId = pallet.clientId!.trim();
    const linkedId = pallet.crossdockLinkedShipmentRequestId?.trim() || null;
    units.push({
      kind: "pallet",
      id: pallet.id,
      code: pallet.palletCode,
      barcode: pallet.barcode,
      clientUserId,
      clientDisplayName: clientDisplayFor(input.clients, clientUserId, pallet.receivedForClient),
      productLabel: pallet.isClosedCrossdock
        ? closedCrossdockProductTitle(pallet.receivedForClient)
        : `Pallet ${pallet.palletCode}`,
      stagingArea: pallet.stagingArea ?? null,
      disposition: pallet.putawayDisposition as "forward" | "keep_closed",
      linkedShipmentRequestId: linkedId,
      labelUrls: linkedId ? labelsByRequest.get(linkedId) ?? [] : [],
      isClosed: !!pallet.isClosedCrossdock,
    });
  }

  units.sort((a, b) => a.code.localeCompare(b.code));
  return units;
}

/** Mark cross-dock unit packed → ready for Dispatch queue. */
export async function completeCrossdockPack(input: {
  warehouseId: string;
  kind: "carton" | "pallet";
  unitId: string;
  operatorId?: string | null;
}): Promise<{ code: string }> {
  const unitRef =
    input.kind === "carton"
      ? warehouseCartonDocRef(input.warehouseId, input.unitId)
      : warehousePalletDocRef(input.warehouseId, input.unitId);

  const snap = await getDoc(unitRef);
  if (!snap.exists()) throw new Error(`${input.kind === "carton" ? "Carton" : "Pallet"} not found.`);

  const data = snap.data() as Record<string, unknown>;
  if (String(data.crossdockDispatchStatus ?? "") !== "awaiting_pack") {
    throw new Error("This unit is not awaiting pack.");
  }

  const code =
    input.kind === "carton"
      ? String(data.cartonCode ?? input.unitId)
      : String(data.palletCode ?? input.unitId);

  const linkedShipmentRequestId = String(data.crossdockLinkedShipmentRequestId ?? "").trim();
  const clientUserId =
    input.kind === "carton"
      ? String(data.clientId ?? "").trim() ||
        (() => {
          const lines = Array.isArray(data.lines) ? data.lines : [];
          for (const line of lines) {
            const id = String((line as { clientId?: string }).clientId ?? "").trim();
            if (id) return id;
          }
          return "";
        })()
      : String(data.clientId ?? "").trim();

  const batch = writeBatch(db);
  batch.update(unitRef, {
    crossdockDispatchStatus: "ready",
    crossdockReadyToDispatchAt: serverTimestamp(),
    status: "on_hold",
    updatedAt: serverTimestamp(),
  });

  if (linkedShipmentRequestId && clientUserId) {
    const shipmentRef = doc(
      db,
      `users/${clientUserId}/shipmentRequests`,
      linkedShipmentRequestId
    );
    batch.update(shipmentRef, {
      warehousePackStatus: "ready_to_dispatch",
      warehouseReadyToDispatchAt: serverTimestamp(),
      warehousePackStockSnapshot: [],
      updatedAt: serverTimestamp(),
    });
  }

  const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");
  batch.set(doc(eventsRef), {
    type: "crossdock_pack_complete",
    cartonId: input.kind === "carton" ? input.unitId : null,
    palletId: input.kind === "pallet" ? input.unitId : null,
    unitCode: code,
    shipmentRequestId: linkedShipmentRequestId || null,
    clientUserId: clientUserId || null,
    operatorId: input.operatorId ?? null,
    at: serverTimestamp(),
  });

  await batch.commit();
  return { code };
}
