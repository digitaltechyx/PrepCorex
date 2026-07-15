import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  Timestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { courierScansMatch } from "@/lib/warehouse-courier-label";
import {
  warehouseCartonDocRef,
  warehousePalletDocRef,
} from "@/lib/warehouse-carton-firestore";
import { assertCartonStatusTransition } from "@/lib/warehouse-carton-states";
import {
  closedCrossdockProductTitle,
  isCrossdockClosedCarton,
} from "@/lib/warehouse-crossdock";
import type { WarehouseQcUnitType } from "@/lib/warehouse-pack";
import type {
  UserProfile,
  WarehouseCartonDoc,
  WarehousePalletDoc,
  WarehousePutawayDisposition,
} from "@/types";

const WAREHOUSES = "warehouses";

export type CrossdockDispatchUnitKind = "carton" | "pallet";

export type CrossdockDispatchUnit = {
  kind: CrossdockDispatchUnitKind;
  id: string;
  code: string;
  barcode: string;
  clientUserId: string;
  clientDisplayName: string;
  productLabel: string;
  stagingArea: string | null;
  inboundTracking: string | null;
  disposition: WarehousePutawayDisposition;
  linkedShipmentRequestId: string | null;
  readyAt: Date | null;
  isClosed: boolean;
  defaultQcUnitType: WarehouseQcUnitType;
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

function dateFromFirestore(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object" && value !== null && "seconds" in value) {
    const seconds = Number((value as { seconds: number }).seconds);
    if (Number.isFinite(seconds)) return new Date(seconds * 1000);
  }
  return null;
}

export function isCrossdockDispatchReadyCarton(carton: WarehouseCartonDoc): boolean {
  if (carton.crossdockDispatchStatus === "dispatched") return false;
  if (carton.status === "closed" || carton.status === "voided") return false;
  if (!clientIdFromCarton(carton)) return false;

  if (carton.putawayDisposition === "return") {
    return carton.crossdockDispatchStatus === "ready";
  }

  if (carton.receiveMode !== "crossdock") return false;

  if (carton.putawayDisposition === "forward") {
    // Must pack first — on_hold alone is not enough.
    return carton.crossdockDispatchStatus === "ready";
  }
  if (carton.putawayDisposition === "keep_closed") {
    return (
      carton.crossdockDispatchStatus === "ready" &&
      !!carton.crossdockLinkedShipmentRequestId?.trim()
    );
  }
  return false;
}

export function isCrossdockDispatchReadyPallet(pallet: WarehousePalletDoc): boolean {
  if (pallet.receiveMode !== "crossdock") return false;
  if (pallet.crossdockDispatchStatus === "dispatched") return false;
  if (pallet.status === "dispatched") return false;
  if (!pallet.clientId?.trim()) return false;

  if (pallet.putawayDisposition === "forward") {
    return pallet.crossdockDispatchStatus === "ready";
  }
  if (pallet.putawayDisposition === "keep_closed") {
    return (
      pallet.crossdockDispatchStatus === "ready" &&
      !!pallet.crossdockLinkedShipmentRequestId?.trim()
    );
  }
  return false;
}

export function isCrossdockHoldAwaitingLink(carton: WarehouseCartonDoc): boolean {
  return (
    carton.receiveMode === "crossdock" &&
    carton.putawayDisposition === "keep_closed" &&
    carton.crossdockDispatchStatus !== "dispatched" &&
    carton.status !== "closed" &&
    carton.status !== "voided" &&
    !!clientIdFromCarton(carton) &&
    !carton.crossdockLinkedShipmentRequestId?.trim()
  );
}

export function isCrossdockHoldAwaitingLinkPallet(pallet: WarehousePalletDoc): boolean {
  return (
    pallet.receiveMode === "crossdock" &&
    pallet.putawayDisposition === "keep_closed" &&
    pallet.crossdockDispatchStatus !== "dispatched" &&
    pallet.status !== "dispatched" &&
    !!pallet.clientId?.trim() &&
    !pallet.crossdockLinkedShipmentRequestId?.trim()
  );
}

export function buildCrossdockDispatchQueue(input: {
  cartons: WarehouseCartonDoc[];
  pallets: WarehousePalletDoc[];
  clients: UserProfile[];
}): CrossdockDispatchUnit[] {
  const units: CrossdockDispatchUnit[] = [];

  for (const carton of input.cartons) {
    if (!isCrossdockDispatchReadyCarton(carton)) continue;
    const clientUserId = clientIdFromCarton(carton)!;
    const disposition = carton.putawayDisposition!;
    units.push({
      kind: "carton",
      id: carton.id,
      code: carton.cartonCode,
      barcode: carton.barcode,
      clientUserId,
      clientDisplayName: clientDisplayFor(
        input.clients,
        clientUserId,
        carton.receivedForClient
      ),
      productLabel:
        carton.productTitle?.trim() ||
        (isCrossdockClosedCarton(carton)
          ? closedCrossdockProductTitle(carton.receivedForClient)
          : carton.sku),
      stagingArea: carton.stagingArea ?? null,
      inboundTracking: carton.trackingNumber ?? null,
      disposition,
      linkedShipmentRequestId: carton.crossdockLinkedShipmentRequestId ?? null,
      readyAt: dateFromFirestore(carton.crossdockReadyToDispatchAt),
      isClosed: isCrossdockClosedCarton(carton),
      defaultQcUnitType: carton.isPackage ? "package" : "carton",
    });
  }

  for (const pallet of input.pallets) {
    if (!isCrossdockDispatchReadyPallet(pallet)) continue;
    const clientUserId = pallet.clientId!.trim();
    const disposition = pallet.putawayDisposition!;
    units.push({
      kind: "pallet",
      id: pallet.id,
      code: pallet.palletCode,
      barcode: pallet.barcode,
      clientUserId,
      clientDisplayName: clientDisplayFor(
        input.clients,
        clientUserId,
        pallet.receivedForClient
      ),
      productLabel: pallet.isClosedCrossdock
        ? closedCrossdockProductTitle(pallet.receivedForClient)
        : `Pallet ${pallet.palletCode}`,
      stagingArea: pallet.stagingArea ?? null,
      inboundTracking: pallet.trackingNumber ?? null,
      disposition,
      linkedShipmentRequestId: pallet.crossdockLinkedShipmentRequestId ?? null,
      readyAt: dateFromFirestore(pallet.crossdockReadyToDispatchAt),
      isClosed: !!pallet.isClosedCrossdock,
      defaultQcUnitType: "pallet",
    });
  }

  return units.sort((a, b) => {
    const ta = a.readyAt?.getTime() ?? 0;
    const tb = b.readyAt?.getTime() ?? 0;
    if (ta !== tb) return ta - tb;
    return a.code.localeCompare(b.code);
  });
}

export function buildCrossdockHoldQueue(input: {
  cartons: WarehouseCartonDoc[];
  pallets: WarehousePalletDoc[];
  clients: UserProfile[];
}): CrossdockDispatchUnit[] {
  const units: CrossdockDispatchUnit[] = [];

  for (const carton of input.cartons) {
    if (!isCrossdockHoldAwaitingLink(carton)) continue;
    const clientUserId = clientIdFromCarton(carton)!;
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
      inboundTracking: carton.trackingNumber ?? null,
      disposition: "keep_closed",
      linkedShipmentRequestId: null,
      readyAt: null,
      isClosed: isCrossdockClosedCarton(carton),
      defaultQcUnitType: carton.isPackage ? "package" : "carton",
    });
  }

  for (const pallet of input.pallets) {
    if (!isCrossdockHoldAwaitingLinkPallet(pallet)) continue;
    const clientUserId = pallet.clientId!.trim();
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
      inboundTracking: pallet.trackingNumber ?? null,
      disposition: "keep_closed",
      linkedShipmentRequestId: null,
      readyAt: null,
      isClosed: !!pallet.isClosedCrossdock,
      defaultQcUnitType: "pallet",
    });
  }

  return units.sort((a, b) => a.code.localeCompare(b.code));
}

function unitScanMatches(scan: string, code: string, barcode: string): boolean {
  const value = scan.trim().toUpperCase();
  if (!value) return false;
  return value === code.trim().toUpperCase() || value === barcode.trim().toUpperCase();
}

export function findCrossdockUnitByScan(
  scan: string,
  queue: CrossdockDispatchUnit[]
): CrossdockDispatchUnit | null {
  const value = scan.trim();
  if (!value) return null;
  return (
    queue.find((u) => unitScanMatches(value, u.code, u.barcode)) ??
    queue.find((u) => u.inboundTracking && courierScansMatch(value, u.inboundTracking)) ??
    null
  );
}

export function isCrossdockFulfillmentShipment(data: Record<string, unknown>): boolean {
  return data.crossdockFulfillment === true || !!String(data.crossdockLinkedUnitId ?? "").trim();
}

async function createCrossdockShippedRecord(input: {
  clientUserId: string;
  productName: string;
  service: string;
  shipTo: string;
  courierTracking: string;
  boxesShipped: number;
  shippedQty: number;
  unitCode: string;
  unitKind: CrossdockDispatchUnitKind;
  shipmentRequestId?: string | null;
  remarks?: string | null;
}): Promise<string> {
  const shippedRef = doc(collection(db, `users/${input.clientUserId}/shipped`));
  const now = Timestamp.now();
  await runTransaction(db, async (transaction) => {
    transaction.set(shippedRef, {
      productName: input.productName,
      date: now,
      createdAt: now,
      shippedQty: input.shippedQty,
      boxesShipped: input.boxesShipped,
      totalBoxes: input.boxesShipped,
      totalUnits: input.shippedQty,
      totalSkus: 1,
      shipTo: input.shipTo,
      service: input.service,
      remarks: input.remarks ?? "",
      items: [
        {
          productName: input.productName,
          boxesShipped: input.boxesShipped,
          shippedQty: input.shippedQty,
          packOf: 1,
        },
      ],
      crossdockUnitCode: input.unitCode,
      crossdockUnitKind: input.unitKind,
      crossdockCourierTracking: input.courierTracking,
      shipmentRequestId: input.shipmentRequestId ?? null,
    });
  });
  return shippedRef.id;
}

async function createShippedFromCrossdockFulfillmentRequest(input: {
  clientUserId: string;
  shipmentRequestId: string;
  courierTracking: string;
  unitCode: string;
  unitKind: CrossdockDispatchUnitKind;
  operatorId?: string | null;
}): Promise<string> {
  const requestRef = doc(db, `users/${input.clientUserId}/shipmentRequests`, input.shipmentRequestId);
  const logRef = doc(db, `users/${input.clientUserId}/outboundDispatchLogs`, input.shipmentRequestId);
  const shippedRef = doc(collection(db, `users/${input.clientUserId}/shipped`));

  await runTransaction(db, async (transaction) => {
    const requestSnap = await transaction.get(requestRef);
    if (!requestSnap.exists()) throw new Error("Linked outbound order not found.");

    const data = requestSnap.data() as Record<string, unknown>;
    if (data.status !== "confirmed") throw new Error("Linked order is not confirmed.");

    const logSnap = await transaction.get(logRef);
    if (logSnap.exists()) return;

    const shipments = Array.isArray(data.shipments)
      ? (data.shipments as Array<Record<string, unknown>>)
      : [];
    if (shipments.length === 0) throw new Error("Linked order has no line items.");

    const allItems = shipments.map((shipment) => ({
      productId: shipment.productId ?? null,
      productName: String(shipment.productName ?? shipment.sku ?? "Product"),
      boxesShipped: Math.max(0, Number(shipment.quantity) || 0),
      shippedQty: Math.max(0, Number(shipment.quantity) || 0) * Math.max(1, Number(shipment.packOf) || 1),
      packOf: Math.max(1, Number(shipment.packOf) || 1),
      unitPrice: Number(shipment.unitPrice) || 0,
    }));

    const totalBoxes = allItems.reduce((sum, row) => sum + row.boxesShipped, 0);
    const totalUnits = allItems.reduce((sum, row) => sum + row.shippedQty, 0);
    const now = Timestamp.now();

    transaction.set(shippedRef, {
      productName: allItems.length === 1 ? allItems[0].productName : "Multiple Products",
      date: now,
      createdAt: now,
      shippedQty: totalUnits,
      boxesShipped: totalBoxes,
      totalBoxes,
      totalUnits,
      totalSkus: allItems.length,
      shipTo: String(data.shipTo ?? ""),
      service: String(data.service ?? "Cross-dock"),
      remarks: String(data.adminRemarks ?? data.remarks ?? ""),
      items: allItems,
      crossdockUnitCode: input.unitCode,
      crossdockUnitKind: input.unitKind,
      crossdockCourierTracking: input.courierTracking,
      crossdockFulfillment: true,
      shipmentRequestId: input.shipmentRequestId,
    });

    transaction.update(requestRef, {
      warehouseDispatchStatus: "dispatched",
      warehouseDispatchedAt: now,
      warehouseDispatchedBy: input.operatorId ?? null,
      warehouseCourierTracking: input.courierTracking,
      clientInventoryDeductedAt: now,
      updatedAt: serverTimestamp(),
    });

    transaction.set(logRef, {
      shipmentRequestId: input.shipmentRequestId,
      shippedId: shippedRef.id,
      crossdockFulfillment: true,
      at: now,
    });
  });

  return shippedRef.id;
}

/** Path B — link a held cross-dock unit to a confirmed client outbound (then Pack → Dispatch). */
export async function linkCrossdockHoldToShipment(input: {
  warehouseId: string;
  kind: CrossdockDispatchUnitKind;
  unitId: string;
  clientUserId: string;
  shipmentRequestId: string;
  operatorId?: string | null;
}): Promise<void> {
  const unitRef =
    input.kind === "carton"
      ? warehouseCartonDocRef(input.warehouseId, input.unitId)
      : warehousePalletDocRef(input.warehouseId, input.unitId);
  const unitSnap = await getDoc(unitRef);
  if (!unitSnap.exists()) throw new Error("Cross-dock unit not found.");

  const unit =
    input.kind === "carton"
      ? ({ id: unitSnap.id, ...(unitSnap.data() as Omit<WarehouseCartonDoc, "id">) } as WarehouseCartonDoc)
      : ({ id: unitSnap.id, ...(unitSnap.data() as Omit<WarehousePalletDoc, "id">) } as WarehousePalletDoc);

  const shipmentRef = doc(db, `users/${input.clientUserId}/shipmentRequests`, input.shipmentRequestId);
  const shipmentSnap = await getDoc(shipmentRef);
  if (!shipmentSnap.exists()) throw new Error("Outbound order not found.");

  const shipmentData = shipmentSnap.data() as Record<string, unknown>;
  if (shipmentData.status !== "confirmed") {
    throw new Error("Outbound order must be confirmed before linking cross-dock.");
  }
  if (shipmentData.warehouseDispatchStatus === "dispatched") {
    throw new Error("Outbound order was already dispatched.");
  }

  const unitClientId =
    input.kind === "carton"
      ? clientIdFromCarton(unit as WarehouseCartonDoc)
      : (unit as WarehousePalletDoc).clientId?.trim() || null;
  if (!unitClientId || unitClientId !== input.clientUserId) {
    throw new Error("Cross-dock unit client does not match this outbound order.");
  }

  if (unit.putawayDisposition !== "keep_closed") {
    throw new Error("Only held (keep closed) cross-dock units can be linked to outbound.");
  }
  if (unit.crossdockDispatchStatus === "dispatched") {
    throw new Error("Cross-dock unit was already dispatched.");
  }

  const unitCode =
    input.kind === "carton"
      ? (unit as WarehouseCartonDoc).cartonCode
      : (unit as WarehousePalletDoc).palletCode;

  const batch = writeBatch(db);

  batch.update(unitRef, {
    crossdockLinkedShipmentRequestId: input.shipmentRequestId,
    crossdockDispatchStatus: "awaiting_pack",
    updatedAt: serverTimestamp(),
  });

  batch.update(shipmentRef, {
    crossdockFulfillment: true,
    crossdockLinkedUnitId: input.unitId,
    crossdockLinkedUnitKind: input.kind,
    crossdockLinkedUnitCode: unitCode,
    warehousePickStatus: "picked",
    warehousePickedAt: serverTimestamp(),
    warehousePickedBy: input.operatorId ?? null,
    warehousePackStatus: "packing",
    updatedAt: serverTimestamp(),
  });

  const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");
  batch.set(doc(eventsRef), {
    type: "crossdock_linked",
    shipmentRequestId: input.shipmentRequestId,
    clientUserId: input.clientUserId,
    crossdockUnitId: input.unitId,
    crossdockUnitKind: input.kind,
    crossdockUnitCode: unitCode,
    operatorId: input.operatorId ?? null,
    at: serverTimestamp(),
  });

  await batch.commit();
}

/** Direct cross-dock dispatch — skip pick/pack; auto-create client shipped entry. */
export async function completeCrossdockDispatch(input: {
  warehouseId: string;
  unit: CrossdockDispatchUnit;
  courierTracking: string;
  qcUnitType: WarehouseQcUnitType;
  operatorId?: string | null;
}): Promise<void> {
  const tracking = input.courierTracking.trim();
  if (!tracking) throw new Error("Scan the outbound courier label.");

  const unitRef =
    input.unit.kind === "carton"
      ? warehouseCartonDocRef(input.warehouseId, input.unit.id)
      : warehousePalletDocRef(input.warehouseId, input.unit.id);

  const unitSnap = await getDoc(unitRef);
  if (!unitSnap.exists()) throw new Error("Cross-dock unit not found.");

  const batch = writeBatch(db);

  let shippedQty = 1;
  let productName = input.unit.productLabel;

  if (input.unit.kind === "carton") {
    const carton = { id: unitSnap.id, ...(unitSnap.data() as Omit<WarehouseCartonDoc, "id">) };
    assertCartonStatusTransition(carton.status, "closed");
    const lines = Array.isArray(carton.lines) ? carton.lines : [];
    if (lines.length > 0) {
      shippedQty = Math.max(
        1,
        lines.reduce((sum, l) => sum + Math.max(0, Number(l.quantity) || 0), 0)
      );
      productName =
        lines.find((l) => l.productTitle?.trim())?.productTitle?.trim() ||
        lines[0]?.sku ||
        productName;
    } else {
      shippedQty = Math.max(1, Number(carton.quantity) || 1);
    }
    batch.update(unitRef, {
      status: "closed",
      crossdockDispatchStatus: "dispatched",
      crossdockDispatchedAt: serverTimestamp(),
      crossdockCourierTracking: tracking,
      updatedAt: serverTimestamp(),
    });
  } else {
    const pallet = unitSnap.data() as Record<string, unknown>;
    shippedQty = Math.max(1, Number(pallet.quantity) || 1);
    batch.update(unitRef, {
      status: "dispatched",
      crossdockDispatchStatus: "dispatched",
      crossdockDispatchedAt: serverTimestamp(),
      crossdockCourierTracking: tracking,
      updatedAt: serverTimestamp(),
    });
  }

  const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");
  batch.set(doc(eventsRef), {
    type: "crossdock_dispatched",
    crossdockUnitId: input.unit.id,
    crossdockUnitKind: input.unit.kind,
    crossdockUnitCode: input.unit.code,
    clientUserId: input.unit.clientUserId,
    shipmentRequestId: input.unit.linkedShipmentRequestId,
    courierTracking: tracking,
    qcUnitType: input.qcUnitType,
    qcCondition: "good",
    shippedQty,
    operatorId: input.operatorId ?? null,
    at: serverTimestamp(),
  });

  await batch.commit();

  if (input.unit.linkedShipmentRequestId) {
    await createShippedFromCrossdockFulfillmentRequest({
      clientUserId: input.unit.clientUserId,
      shipmentRequestId: input.unit.linkedShipmentRequestId,
      courierTracking: tracking,
      unitCode: input.unit.code,
      unitKind: input.unit.kind,
      operatorId: input.operatorId,
    });
    return;
  }

  const isReturn = input.unit.disposition === "return";
  await createCrossdockShippedRecord({
    clientUserId: input.unit.clientUserId,
    productName,
    service: isReturn ? "Quarantine / Return outbound" : "Cross-dock Forwarding",
    shipTo: isReturn ? "Return outbound" : "Cross-dock forward",
    courierTracking: tracking,
    boxesShipped: 1,
    shippedQty: input.unit.isClosed ? 1 : shippedQty,
    unitCode: input.unit.code,
    unitKind: input.unit.kind,
    remarks: isReturn
      ? `Return/quarantine ${input.unit.code} dispatched · qty ${input.unit.isClosed ? 1 : shippedQty}`
      : `Cross-dock ${input.unit.code} dispatched`,
  });
}
