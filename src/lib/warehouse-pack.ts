import {
  collection,
  collectionGroup,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  applyClientInventoryOnDispatch,
  type ShopifyInventorySyncHint,
} from "@/lib/client-inventory-outbound-sync";
import {
  linesToFirestorePayload,
  rollCartonBinStateFromLines,
} from "@/lib/warehouse-carton-line-utils";
import { warehouseCartonDocRef } from "@/lib/warehouse-carton-firestore";
import { getWarehouseCarton } from "@/lib/warehouse-receive-corrections";
import { dateFromFirestore } from "@/lib/warehouse-stock-sort";
import {
  courierScansMatch,
  normalizeCourierScan,
  shipFromForRequest,
  shipToForRequest,
  trackingMatchesOrder,
} from "@/lib/warehouse-courier-label";
import type {
  OutboundPickLine,
  OutboundPickOrder,
  WarehousePickStatus,
} from "@/lib/warehouse-pick";
import { orderLinesForRequests } from "@/lib/warehouse-outbound-lines";
import { clientMatchesWarehouse } from "@/lib/warehouse-client-match";
import type {
  UserProfile,
  WarehouseCartonDoc,
  WarehouseCartonLine,
  WarehouseDoc,
} from "@/types";

const WAREHOUSES = "warehouses";

export type WarehousePackStatus = "pending" | "packing" | "ready_to_dispatch";

export type WarehouseDispatchStatus = "ready" | "dispatched";

export type WarehouseQcUnitType = "package" | "carton" | "pallet";

export type WarehouseQcCondition = "good" | "not_good";

export type PackStockSnapshotEntry = {
  cartonId: string;
  cartonCode: string;
  removedLines: WarehouseCartonLine[];
};

export type PackVerifyMode = "scan_pkg" | "scan_ctn" | "confirm";

export type PackPlanItem = {
  itemKey: string;
  verifyMode: PackVerifyMode;
  cartonId: string;
  cartonCode: string;
  isPackage: boolean;
  sku: string;
  productName: string;
  quantity: number;
  lineIds: string[];
  lot: string | null;
  expiry: string | null;
};

export type PackPlan = {
  order: OutboundPackOrder;
  items: PackPlanItem[];
  verifiedKeys: string[];
  readyToComplete: boolean;
  courierTracking: string | null;
  courierVerified: boolean;
};

export type OutboundPackOrder = OutboundPickOrder & {
  warehousePackStatus: WarehousePackStatus;
  warehouseDispatchStatus?: WarehouseDispatchStatus;
  readyToDispatchAt?: Date | null;
  courierTracking?: string | null;
  shipFrom?: string;
  qcRemarks?: string;
  qcFailedAt?: Date | null;
  defaultQcUnitType?: WarehouseQcUnitType;
};

type PickMovementEvent = {
  cartonId: string;
  cartonCode: string;
  lineId: string;
  sku: string;
  quantity: number;
  lot: string | null;
  expiry: string | null;
};

function displayClient(client: UserProfile | undefined, userId: string): string {
  if (!client) return userId.slice(0, 8);
  const name = client.name || client.email || userId;
  const cid = client.clientId ? ` (${client.clientId})` : "";
  return `${name}${cid}`;
}

function packStatusFromRequest(data: Record<string, unknown>): WarehousePackStatus {
  const raw = data.warehousePackStatus;
  if (raw === "packing" || raw === "ready_to_dispatch") return raw;
  return "pending";
}

function pickStatusFromRequest(data: Record<string, unknown>): WarehousePickStatus {
  const raw = data.warehousePickStatus;
  if (raw === "picking" || raw === "picked" || raw === "ready" || raw === "skipped") {
    return raw;
  }
  return "ready";
}

async function loadClientProductMap(
  clientUserId: string
): Promise<Map<string, { sku: string; productName: string }>> {
  const snap = await getDocs(collection(db, `users/${clientUserId}/inventory`));
  const map = new Map<string, { sku: string; productName: string }>();
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    const sku = String(data.sku ?? "").trim();
    if (!sku) continue;
    map.set(d.id, {
      sku,
      productName: String(data.productName ?? data.sku ?? "").trim() || sku,
    });
  }
  return map;
}

async function orderLinesFromRequest(
  clientUserId: string,
  data: Record<string, unknown>
): Promise<OutboundPickLine[]> {
  const shipments = Array.isArray(data.shipments)
    ? (data.shipments as Array<Record<string, unknown>>)
    : [];
  const products = await loadClientProductMap(clientUserId);
  const lines: OutboundPickLine[] = [];
  for (const shipment of shipments) {
    const productId = String(shipment.productId ?? "").trim();
    if (!productId) continue;
    const product = products.get(productId);
    const sku = String(shipment.sku ?? product?.sku ?? "").trim();
    if (!sku) continue;
    const qty = Math.max(0, Math.floor(Number(shipment.quantity) || 0));
    const packOf = Math.max(1, Math.floor(Number(shipment.packOf) || 1));
    const quantityUnits = qty * packOf;
    if (quantityUnits < 1) continue;
    lines.push({
      sku,
      productName: String(shipment.productName ?? product?.productName ?? sku).trim() || sku,
      quantityUnits,
      productId,
    });
  }
  return lines;
}

function dispatchStatusFromRequest(data: Record<string, unknown>): WarehouseDispatchStatus {
  return data.warehouseDispatchStatus === "dispatched" ? "dispatched" : "ready";
}

function courierTrackingFromRequest(data: Record<string, unknown>): string | null {
  const raw = data.warehouseCourierTracking;
  if (raw == null || String(raw).trim() === "") return null;
  return String(raw).trim();
}

export function inferQcUnitTypeFromRequest(
  data: Record<string, unknown>
): WarehouseQcUnitType {
  const st = String(data.shipmentType ?? "").toLowerCase();
  if (st === "pallet") return "pallet";
  if (st === "box") return "carton";
  return "package";
}

function lineFromFirestoreSnapshot(raw: Record<string, unknown>): WarehouseCartonLine {
  return {
    lineId: String(raw.lineId ?? ""),
    sku: String(raw.sku ?? ""),
    productTitle: raw.productTitle != null ? String(raw.productTitle) : undefined,
    quantity: Math.max(0, Math.floor(Number(raw.quantity) || 0)),
    lot: raw.lot != null ? String(raw.lot) : null,
    expiry: raw.expiry != null ? String(raw.expiry) : null,
    condition: raw.condition === "damaged" ? "damaged" : "good",
    binId: raw.binId != null ? String(raw.binId) : null,
    stagingArea: raw.stagingArea != null ? String(raw.stagingArea) : null,
    allocationStatus:
      raw.allocationStatus === "picked" ||
      raw.allocationStatus === "allocated" ||
      raw.allocationStatus === "unallocated"
        ? (raw.allocationStatus as WarehouseCartonLine["allocationStatus"])
        : "picked",
    clientId: raw.clientId != null ? String(raw.clientId) : null,
    inventoryRequestId:
      raw.inventoryRequestId != null ? String(raw.inventoryRequestId) : null,
  };
}

function packStockSnapshotFromRequest(
  data: Record<string, unknown>
): PackStockSnapshotEntry[] {
  const raw = data.warehousePackStockSnapshot;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const e = entry as Record<string, unknown>;
      const removed = Array.isArray(e.removedLines)
        ? (e.removedLines as Record<string, unknown>[]).map(lineFromFirestoreSnapshot)
        : [];
      const cartonId = String(e.cartonId ?? "").trim();
      if (!cartonId || removed.length === 0) return null;
      return {
        cartonId,
        cartonCode: String(e.cartonCode ?? ""),
        removedLines: removed,
      } satisfies PackStockSnapshotEntry;
    })
    .filter((x): x is PackStockSnapshotEntry => x != null);
}

async function restorePackStockFromSnapshot(input: {
  warehouseId: string;
  clientUserId: string;
  shipmentRequestId: string;
  snapshot: PackStockSnapshotEntry[];
  operatorId?: string | null;
  batch: ReturnType<typeof writeBatch>;
}): Promise<void> {
  for (const entry of input.snapshot) {
    const carton = await getWarehouseCarton(input.warehouseId, entry.cartonId);
    if (!carton) continue;

    const current = cartonLines(carton);
    const existingIds = new Set(current.map((l) => l.lineId));
    const toRestore = entry.removedLines.filter((l) => l.lineId && !existingIds.has(l.lineId));
    if (toRestore.length === 0) continue;

    const merged = [...current, ...toRestore];
    const { status, binId } = rollCartonBinStateFromLines(carton, merged);

    const payload: Record<string, unknown> = {
      lines: linesToFirestorePayload(merged),
      updatedAt: serverTimestamp(),
      status,
      binId,
    };

    if (!carton.isMixed && merged.length === 1) {
      payload.quantity = merged[0].quantity;
      payload.sku = merged[0].sku;
    } else {
      payload.quantity = sumLineQty(merged);
    }

    input.batch.update(warehouseCartonDocRef(input.warehouseId, entry.cartonId), payload);

    const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");
    input.batch.set(doc(eventsRef), {
      type: "dispatch_qc_return",
      shipmentRequestId: input.shipmentRequestId,
      clientUserId: input.clientUserId,
      cartonId: entry.cartonId,
      cartonCode: entry.cartonCode || carton.cartonCode,
      lineIds: toRestore.map((l) => l.lineId),
      operatorId: input.operatorId ?? null,
      at: serverTimestamp(),
    });
  }
}

function verifiedKeysFromRequest(data: Record<string, unknown>): string[] {
  const raw = data.warehousePackVerifiedKeys;
  if (!Array.isArray(raw)) return [];
  return raw.map(String).filter(Boolean);
}

function cartonLines(carton: WarehouseCartonDoc): WarehouseCartonLine[] {
  if (carton.lines && carton.lines.length > 0) return carton.lines;
  return [
    {
      lineId: "L1",
      sku: carton.sku,
      quantity: carton.quantity,
      lot: carton.lot ?? null,
      expiry: carton.expiry ?? null,
      condition: carton.status === "damaged" ? "damaged" : "good",
      binId: carton.binId ?? null,
      allocationStatus: "unallocated",
      clientId: carton.clientId ?? null,
    },
  ];
}

function isFullCartonPickForOrder(
  carton: WarehouseCartonDoc,
  events: PickMovementEvent[],
  clientUserId: string
): boolean {
  const lines = cartonLines(carton).filter((l) => l.quantity > 0);
  if (lines.length === 0) return false;

  for (const line of lines) {
    if (line.allocationStatus !== "picked") return false;
    if (line.clientId && line.clientId !== clientUserId) return false;
  }

  const cartonEvents = events.filter((e) => e.cartonId === carton.id);
  if (cartonEvents.length === 0) return false;

  for (const line of lines) {
    const eventQty = cartonEvents
      .filter((e) => e.lineId === line.lineId)
      .reduce((s, e) => s + e.quantity, 0);
    if (eventQty !== line.quantity) return false;
  }
  return true;
}

async function loadPickEventsForOrder(
  warehouseId: string,
  shipmentRequestId: string
): Promise<PickMovementEvent[]> {
  try {
    const snap = await getDocs(
      query(
        collection(db, WAREHOUSES, warehouseId, "movementEvents"),
        where("type", "==", "pick"),
        where("shipmentRequestId", "==", shipmentRequestId)
      )
    );
    return snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      return {
        cartonId: String(data.cartonId ?? ""),
        cartonCode: String(data.cartonCode ?? ""),
        lineId: String(data.lineId ?? ""),
        sku: String(data.sku ?? ""),
        quantity: Math.max(0, Math.floor(Number(data.quantity) || 0)),
        lot: data.lot != null ? String(data.lot) : null,
        expiry: data.expiry != null ? String(data.expiry) : null,
      };
    });
  } catch {
    const snap = await getDocs(
      query(
        collection(db, WAREHOUSES, warehouseId, "movementEvents"),
        where("type", "==", "pick")
      )
    );
    return snap.docs
      .filter((d) => String(d.data().shipmentRequestId ?? "") === shipmentRequestId)
      .map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          cartonId: String(data.cartonId ?? ""),
          cartonCode: String(data.cartonCode ?? ""),
          lineId: String(data.lineId ?? ""),
          sku: String(data.sku ?? ""),
          quantity: Math.max(0, Math.floor(Number(data.quantity) || 0)),
          lot: data.lot != null ? String(data.lot) : null,
          expiry: data.expiry != null ? String(data.expiry) : null,
        };
      });
  }
}

async function loadConfirmedOrders(input: {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
}): Promise<Array<{ id: string; clientUserId: string; data: Record<string, unknown> }>> {
  const eligible = new Set(
    input.clients
      .filter((c) => clientMatchesWarehouse(c, input.warehouse))
      .map((c) => c.uid)
  );

  type ReqDoc = { id: string; ref: { path: string }; data: () => Record<string, unknown> };
  let docs: ReqDoc[] = [];
  try {
    const snap = await getDocs(
      query(collectionGroup(db, "shipmentRequests"), where("status", "==", "confirmed"))
    );
    docs = snap.docs.map((d) => ({
      id: d.id,
      ref: d.ref,
      data: () => d.data() as Record<string, unknown>,
    }));
  } catch {
    for (const uid of eligible) {
      const snap = await getDocs(
        query(
          collection(db, `users/${uid}/shipmentRequests`),
          where("status", "==", "confirmed")
        )
      );
      for (const d of snap.docs) {
        docs.push({
          id: d.id,
          ref: d.ref,
          data: () => d.data() as Record<string, unknown>,
        });
      }
    }
  }

  const out: Array<{ id: string; clientUserId: string; data: Record<string, unknown> }> = [];
  for (const d of docs) {
    const clientUserId = d.ref.path.split("/")[1] ?? "";
    if (!eligible.has(clientUserId)) continue;
    out.push({ id: d.id, clientUserId, data: d.data() });
  }
  return out;
}

function fastPickableCheck(data: Record<string, unknown>): boolean | "lookup" {
  const shipments = Array.isArray(data.shipments)
    ? (data.shipments as Array<Record<string, unknown>>)
    : [];
  if (shipments.length === 0) return false;

  let sawLine = false;
  let needsLookup = false;
  for (const shipment of shipments) {
    const productId = String(shipment.productId ?? "").trim();
    if (!productId) continue;
    const qty = Math.max(0, Math.floor(Number(shipment.quantity) || 0));
    const packOf = Math.max(1, Math.floor(Number(shipment.packOf) || 1));
    if (qty * packOf < 1) continue;
    sawLine = true;
    const sku = String(shipment.sku ?? "").trim();
    if (sku) return true;
    needsLookup = true;
  }
  if (!sawLine) return false;
  return needsLookup ? "lookup" : false;
}

function hasPickableLinesWithProductMap(
  data: Record<string, unknown>,
  products: Map<string, { sku: string; productName: string }>
): boolean {
  const shipments = Array.isArray(data.shipments)
    ? (data.shipments as Array<Record<string, unknown>>)
    : [];
  for (const shipment of shipments) {
    const productId = String(shipment.productId ?? "").trim();
    if (!productId) continue;
    const product = products.get(productId);
    const sku = String(shipment.sku ?? product?.sku ?? "").trim();
    if (!sku) continue;
    const qty = Math.max(0, Math.floor(Number(shipment.quantity) || 0));
    const packOf = Math.max(1, Math.floor(Number(shipment.packOf) || 1));
    if (qty * packOf >= 1) return true;
  }
  return false;
}

async function requestHasPickableLines(
  clientUserId: string,
  data: Record<string, unknown>,
  productCache: Map<string, Map<string, { sku: string; productName: string }>>
): Promise<boolean> {
  const shipments = Array.isArray(data.shipments)
    ? (data.shipments as Array<Record<string, unknown>>)
    : [];
  if (shipments.length === 0) return false;

  let needsProductLookup = false;
  for (const shipment of shipments) {
    const productId = String(shipment.productId ?? "").trim();
    if (!productId) continue;
    const qty = Math.max(0, Math.floor(Number(shipment.quantity) || 0));
    const packOf = Math.max(1, Math.floor(Number(shipment.packOf) || 1));
    if (qty * packOf < 1) continue;
    const sku = String(shipment.sku ?? "").trim();
    if (sku) return true;
    needsProductLookup = true;
  }

  if (!needsProductLookup) return false;

  if (!productCache.has(clientUserId)) {
    productCache.set(clientUserId, await loadClientProductMap(clientUserId));
  }
  const products = productCache.get(clientUserId)!;
  for (const shipment of shipments) {
    const productId = String(shipment.productId ?? "").trim();
    if (!productId) continue;
    const product = products.get(productId);
    const sku = String(shipment.sku ?? product?.sku ?? "").trim();
    if (!sku) continue;
    const qty = Math.max(0, Math.floor(Number(shipment.quantity) || 0));
    const packOf = Math.max(1, Math.floor(Number(shipment.packOf) || 1));
    if (qty * packOf >= 1) return true;
  }
  return false;
}

export type OutboundQueueCounts = {
  pickQueue: number;
  packQueue: number;
  dispatchReady: number;
};

/** Single-query outbound queue depths for dashboard metrics. */
export async function countOutboundQueueStats(input: {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
}): Promise<OutboundQueueCounts> {
  const raw = await loadConfirmedOrders(input);

  const pickable: typeof raw = [];
  const lookupByClient = new Map<string, typeof raw>();

  for (const d of raw) {
    const fast = fastPickableCheck(d.data);
    if (fast === true) {
      pickable.push(d);
      continue;
    }
    if (fast !== "lookup") continue;
    const list = lookupByClient.get(d.clientUserId) ?? [];
    list.push(d);
    lookupByClient.set(d.clientUserId, list);
  }

  if (lookupByClient.size > 0) {
    const clientIds = [...lookupByClient.keys()];
    const productMaps = await Promise.all(clientIds.map((uid) => loadClientProductMap(uid)));
    for (let i = 0; i < clientIds.length; i += 1) {
      const uid = clientIds[i]!;
      const products = productMaps[i]!;
      for (const d of lookupByClient.get(uid) ?? []) {
        if (hasPickableLinesWithProductMap(d.data, products)) pickable.push(d);
      }
    }
  }

  let pickQueue = 0;
  let packQueue = 0;
  let dispatchReady = 0;

  for (const d of pickable) {
    const pickStatus = pickStatusFromRequest(d.data);
    const packStatus = packStatusFromRequest(d.data);
    const dispatchStatus = dispatchStatusFromRequest(d.data);

    if (pickStatus !== "picked" && pickStatus !== "skipped") {
      pickQueue += 1;
      continue;
    }
    if (pickStatus === "picked" && packStatus !== "ready_to_dispatch") {
      packQueue += 1;
      continue;
    }
    if (packStatus === "ready_to_dispatch" && dispatchStatus !== "dispatched") {
      dispatchReady += 1;
    }
  }

  return { pickQueue, packQueue, dispatchReady };
}

function toOutboundPackOrder(
  id: string,
  clientUserId: string,
  data: Record<string, unknown>,
  clientById: Map<string, UserProfile>,
  lines: OutboundPickLine[],
  warehouse?: WarehouseDoc
): OutboundPackOrder {
  return {
    id,
    clientUserId,
    clientDisplayName: displayClient(clientById.get(clientUserId), clientUserId),
    shipTo: shipToForRequest(data) || undefined,
    shipFrom: warehouse ? shipFromForRequest(data, warehouse) : undefined,
    confirmedAt: dateFromFirestore(data.confirmedAt),
    readyToDispatchAt: dateFromFirestore(data.warehouseReadyToDispatchAt),
    warehousePickStatus: pickStatusFromRequest(data),
    warehousePackStatus: packStatusFromRequest(data),
    warehouseDispatchStatus: dispatchStatusFromRequest(data),
    courierTracking: courierTrackingFromRequest(data),
    qcRemarks: data.warehouseQcRemarks != null ? String(data.warehouseQcRemarks) : undefined,
    qcFailedAt: dateFromFirestore(data.warehouseQcFailedAt),
    defaultQcUnitType: inferQcUnitTypeFromRequest(data),
    lines,
  };
}

/** Picked orders awaiting pack / ready to dispatch confirmation. */
export async function loadOutboundPackQueue(input: {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
}): Promise<OutboundPackOrder[]> {
  const clientById = new Map(input.clients.map((c) => [c.uid, c]));
  const raw = await loadConfirmedOrders(input);
  const pending = raw.filter(
    (d) =>
      pickStatusFromRequest(d.data) === "picked" &&
      packStatusFromRequest(d.data) !== "ready_to_dispatch"
  );

  const lineSets = await orderLinesForRequests(
    pending.map((d) => ({ clientUserId: d.clientUserId, data: d.data }))
  );

  const orders: OutboundPackOrder[] = [];
  pending.forEach((d, index) => {
    const lines = lineSets[index] ?? [];
    if (lines.length === 0) return;
    orders.push(
      toOutboundPackOrder(d.id, d.clientUserId, d.data, clientById, lines, input.warehouse)
    );
  });

  orders.sort((a, b) => {
    const aFailed = a.qcFailedAt ? 1 : 0;
    const bFailed = b.qcFailedAt ? 1 : 0;
    if (aFailed !== bFailed) return bFailed - aFailed;
    const ta = a.confirmedAt?.getTime() ?? 0;
    const tb = b.confirmedAt?.getTime() ?? 0;
    return ta - tb;
  });
  return orders;
}

/** Orders marked ready to dispatch (awaiting carrier handoff scan). */
export async function loadDispatchQueue(input: {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
}): Promise<OutboundPackOrder[]> {
  const clientById = new Map(input.clients.map((c) => [c.uid, c]));
  const raw = await loadConfirmedOrders(input);
  const pending = raw.filter(
    (d) =>
      packStatusFromRequest(d.data) === "ready_to_dispatch" &&
      dispatchStatusFromRequest(d.data) !== "dispatched"
  );

  const lineSets = await orderLinesForRequests(
    pending.map((d) => ({ clientUserId: d.clientUserId, data: d.data }))
  );

  const orders: OutboundPackOrder[] = [];
  pending.forEach((d, index) => {
    const lines = lineSets[index] ?? [];
    if (lines.length === 0) return;
    orders.push(
      toOutboundPackOrder(d.id, d.clientUserId, d.data, clientById, lines, input.warehouse)
    );
  });

  orders.sort((a, b) => {
    const ta = a.readyToDispatchAt?.getTime() ?? a.confirmedAt?.getTime() ?? 0;
    const tb = b.readyToDispatchAt?.getTime() ?? b.confirmedAt?.getTime() ?? 0;
    return tb - ta;
  });
  return orders;
}

export async function buildPackPlan(
  warehouse: WarehouseDoc,
  order: OutboundPackOrder
): Promise<PackPlan> {
  const reqRef = doc(db, `users/${order.clientUserId}/shipmentRequests`, order.id);
  const reqSnap = await getDoc(reqRef);
  const verifiedKeys = reqSnap.exists()
    ? verifiedKeysFromRequest(reqSnap.data() as Record<string, unknown>)
    : [];

  const events = await loadPickEventsForOrder(warehouse.id, order.id);
  const skuNames = new Map(order.lines.map((l) => [l.sku, l.productName]));

  const items: PackPlanItem[] = [];
  const byCarton = new Map<string, PickMovementEvent[]>();
  for (const e of events) {
    if (!e.cartonId) continue;
    const list = byCarton.get(e.cartonId) ?? [];
    list.push(e);
    byCarton.set(e.cartonId, list);
  }

  for (const [cartonId, cartonEvents] of byCarton) {
    const carton = await getWarehouseCarton(warehouse.id, cartonId);
    if (!carton) continue;

    const totalQty = cartonEvents.reduce((s, e) => s + e.quantity, 0);
    const primarySku = cartonEvents[0]?.sku ?? carton.sku;
    const productName = skuNames.get(primarySku) ?? primarySku;
    const lineIds = [...new Set(cartonEvents.map((e) => e.lineId))];

    if (carton.isPackage) {
      items.push({
        itemKey: `pkg:${cartonId}`,
        verifyMode: "scan_pkg",
        cartonId,
        cartonCode: carton.cartonCode,
        isPackage: true,
        sku: primarySku,
        productName,
        quantity: totalQty,
        lineIds,
        lot: cartonEvents[0]?.lot ?? carton.lot ?? null,
        expiry: cartonEvents[0]?.expiry ?? carton.expiry ?? null,
      });
      continue;
    }

    if (isFullCartonPickForOrder(carton, events, order.clientUserId)) {
      items.push({
        itemKey: `ctn:${cartonId}`,
        verifyMode: "scan_ctn",
        cartonId,
        cartonCode: carton.cartonCode,
        isPackage: false,
        sku: primarySku,
        productName,
        quantity: totalQty,
        lineIds,
        lot: cartonEvents[0]?.lot ?? carton.lot ?? null,
        expiry: cartonEvents[0]?.expiry ?? carton.expiry ?? null,
      });
      continue;
    }

    for (const e of cartonEvents) {
      items.push({
        itemKey: `loose:${e.cartonId}:${e.lineId}:${e.sku}`,
        verifyMode: "confirm",
        cartonId: e.cartonId,
        cartonCode: e.cartonCode,
        isPackage: false,
        sku: e.sku,
        productName: skuNames.get(e.sku) ?? e.sku,
        quantity: e.quantity,
        lineIds: [e.lineId],
        lot: e.lot,
        expiry: e.expiry,
      });
    }
  }

  items.sort((a, b) => a.cartonCode.localeCompare(b.cartonCode) || a.sku.localeCompare(b.sku));

  const readyToComplete =
    items.length > 0 && items.every((i) => verifiedKeys.includes(i.itemKey));

  const courierTracking = reqSnap.exists()
    ? courierTrackingFromRequest(reqSnap.data() as Record<string, unknown>)
    : null;

  return {
    order,
    items,
    verifiedKeys,
    readyToComplete,
    courierTracking,
    courierVerified: Boolean(courierTracking),
  };
}

export async function markPackItemVerified(input: {
  clientUserId: string;
  shipmentRequestId: string;
  itemKey: string;
  warehouseId: string;
  operatorId?: string | null;
}): Promise<string[]> {
  const ref = doc(db, `users/${input.clientUserId}/shipmentRequests`, input.shipmentRequestId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Order not found.");

  const data = snap.data() as Record<string, unknown>;
  if (pickStatusFromRequest(data) !== "picked") {
    throw new Error("Order is not fully picked.");
  }
  if (packStatusFromRequest(data) === "ready_to_dispatch") {
    throw new Error("Order is already ready to dispatch.");
  }

  const keys = verifiedKeysFromRequest(data);
  if (!keys.includes(input.itemKey)) {
    keys.push(input.itemKey);
  }

  await updateDoc(ref, {
    warehousePackStatus: "packing",
    warehousePackVerifiedKeys: keys,
    warehouseId: input.warehouseId,
    updatedAt: serverTimestamp(),
  });

  return keys;
}

export async function verifyPackScan(input: {
  warehouseId: string;
  clientUserId: string;
  shipmentRequestId: string;
  item: PackPlanItem;
  scannedCartonId: string;
  operatorId?: string | null;
}): Promise<string[]> {
  if (input.scannedCartonId !== input.item.cartonId) {
    throw new Error(
      input.item.verifyMode === "scan_pkg"
        ? "Wrong PKG — scan the package label shown for this line."
        : "Wrong carton — scan the CTN label shown for this line."
    );
  }
  return markPackItemVerified({
    clientUserId: input.clientUserId,
    shipmentRequestId: input.shipmentRequestId,
    itemKey: input.item.itemKey,
    warehouseId: input.warehouseId,
    operatorId: input.operatorId,
  });
}

export type CourierLabelBindResult = {
  normalizedTracking: string;
  shipTo: string;
  shipFrom: string;
};

/** Scan courier label at pack bench — binds tracking to order before ready to dispatch. */
export async function bindCourierLabelAtPack(input: {
  warehouse: WarehouseDoc;
  clientUserId: string;
  shipmentRequestId: string;
  scannedValue: string;
  operatorId?: string | null;
}): Promise<CourierLabelBindResult> {
  const ref = doc(db, `users/${input.clientUserId}/shipmentRequests`, input.shipmentRequestId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Order not found.");

  const data = snap.data() as Record<string, unknown>;
  if (pickStatusFromRequest(data) !== "picked") {
    throw new Error("Order is not fully picked.");
  }
  if (packStatusFromRequest(data) === "ready_to_dispatch") {
    throw new Error("Order is already ready to dispatch.");
  }

  const lines = await orderLinesFromRequest(input.clientUserId, data);
  const order: OutboundPackOrder = {
    id: input.shipmentRequestId,
    clientUserId: input.clientUserId,
    clientDisplayName: "",
    warehousePickStatus: "picked",
    warehousePackStatus: packStatusFromRequest(data),
    lines,
    confirmedAt: dateFromFirestore(data.confirmedAt),
  };

  const plan = await buildPackPlan(input.warehouse, order);
  if (!plan.readyToComplete) {
    throw new Error("Verify all picked stock before scanning the courier label.");
  }

  const scanned = String(input.scannedValue ?? "").trim();
  if (!scanned) throw new Error("Scan the courier label barcode.");

  if (!trackingMatchesOrder(scanned, data)) {
    throw new Error("This tracking number does not match this order.");
  }

  const normalized = normalizeCourierScan(scanned);

  await updateDoc(ref, {
    warehouseCourierTracking: normalized,
    warehousePackCourierVerifiedAt: serverTimestamp(),
    warehousePackStatus: "packing",
    warehouseId: input.warehouse.id,
    updatedAt: serverTimestamp(),
  });

  return {
    normalizedTracking: normalized,
    shipTo: shipToForRequest(data),
    shipFrom: shipFromForRequest(data, input.warehouse),
  };
}

function removeDispatchedLines(
  lines: WarehouseCartonLine[],
  lineIds: Set<string>
): WarehouseCartonLine[] {
  return lines.filter((l) => !lineIds.has(l.lineId));
}

function sumLineQty(lines: WarehouseCartonLine[]): number {
  return lines.reduce((s, l) => s + l.quantity, 0);
}

/** Confirm pack complete — decrement warehouse carton stock and mark ready to dispatch. */
export async function completePackReadyToDispatch(input: {
  warehouseId: string;
  clientUserId: string;
  shipmentRequestId: string;
  operatorId?: string | null;
}): Promise<void> {
  const ref = doc(db, `users/${input.clientUserId}/shipmentRequests`, input.shipmentRequestId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Order not found.");

  const data = snap.data() as Record<string, unknown>;
  if (pickStatusFromRequest(data) !== "picked") {
    throw new Error("Order must be fully picked before pack.");
  }
  if (packStatusFromRequest(data) === "ready_to_dispatch") {
    throw new Error("Order is already ready to dispatch.");
  }

  const lines = await orderLinesFromRequest(input.clientUserId, data);
  const order: OutboundPackOrder = {
    id: input.shipmentRequestId,
    clientUserId: input.clientUserId,
    clientDisplayName: "",
    warehousePickStatus: "picked",
    warehousePackStatus: packStatusFromRequest(data),
    lines,
    confirmedAt: dateFromFirestore(data.confirmedAt),
  };

  const plan = await buildPackPlan({ id: input.warehouseId } as WarehouseDoc, order);
  if (plan.items.length === 0) {
    throw new Error("No picked stock found for this order — re-pick or contact a supervisor.");
  }
  if (!plan.readyToComplete) {
    throw new Error("Verify all pack lines before marking ready to dispatch.");
  }

  const courierTracking = courierTrackingFromRequest(data);
  if (!courierTracking) {
    throw new Error("Scan the courier label before marking ready to dispatch.");
  }

  const events = await loadPickEventsForOrder(input.warehouseId, input.shipmentRequestId);
  const byCarton = new Map<string, Set<string>>();
  for (const e of events) {
    if (!e.cartonId || !e.lineId) continue;
    const set = byCarton.get(e.cartonId) ?? new Set<string>();
    set.add(e.lineId);
    byCarton.set(e.cartonId, set);
  }

  const batch = writeBatch(db);
  const stockSnapshot: PackStockSnapshotEntry[] = [];

  for (const [cartonId, lineIds] of byCarton) {
    const carton = await getWarehouseCarton(input.warehouseId, cartonId);
    if (!carton) continue;

    const baseLines = cartonLines(carton);
    const removedLines = baseLines.filter((l) => lineIds.has(l.lineId));
    if (removedLines.length > 0) {
      stockSnapshot.push({
        cartonId,
        cartonCode: carton.cartonCode,
        removedLines,
      });
    }

    const nextLines = removeDispatchedLines(baseLines, lineIds);
    const { status, binId } = rollCartonBinStateFromLines(carton, nextLines);

    const payload: Record<string, unknown> = {
      lines: linesToFirestorePayload(nextLines),
      updatedAt: serverTimestamp(),
    };

    if (nextLines.length === 0) {
      payload.status = "closed";
      payload.quantity = 0;
      payload.binId = null;
    } else {
      payload.status = status;
      payload.binId = binId;
      if (!carton.isMixed && nextLines.length === 1) {
        payload.quantity = nextLines[0].quantity;
        payload.sku = nextLines[0].sku;
      } else {
        payload.quantity = sumLineQty(nextLines);
      }
    }

    batch.update(warehouseCartonDocRef(input.warehouseId, cartonId), payload);

    const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");
    batch.set(doc(eventsRef), {
      type: "dispatch",
      shipmentRequestId: input.shipmentRequestId,
      clientUserId: input.clientUserId,
      cartonId,
      cartonCode: carton.cartonCode,
      lineIds: [...lineIds],
      operatorId: input.operatorId ?? null,
      at: serverTimestamp(),
    });
  }

  batch.update(ref, {
    warehousePackStatus: "ready_to_dispatch",
    warehouseDispatchStatus: "ready",
    warehouseReadyToDispatchAt: serverTimestamp(),
    warehousePackedBy: input.operatorId ?? null,
    warehousePackVerifiedKeys: plan.verifiedKeys,
    warehouseCourierTracking: courierTracking,
    warehousePackStockSnapshot: stockSnapshot.map((s) => ({
      cartonId: s.cartonId,
      cartonCode: s.cartonCode,
      removedLines: linesToFirestorePayload(s.removedLines),
    })),
    warehouseQcRemarks: deleteField(),
    warehouseQcFailedAt: deleteField(),
    warehouseQcFailedBy: deleteField(),
    warehouseQcCondition: deleteField(),
    warehouseId: input.warehouseId,
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
}

/** Find a ready order in the dispatch queue by courier label scan. */
export async function resolveDispatchOrderByScan(input: {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
  scannedValue: string;
}): Promise<OutboundPackOrder | null> {
  const scanned = String(input.scannedValue ?? "").trim();
  if (!scanned) return null;

  const queue = await loadDispatchQueue({
    warehouse: input.warehouse,
    clients: input.clients,
  });

  return (
    queue.find(
      (o) => o.courierTracking && courierScansMatch(scanned, o.courierTracking)
    ) ?? null
  );
}

/** Confirm carrier handoff after dispatch QC passes. */
export async function completeDispatchHandoff(input: {
  warehouseId: string;
  clientUserId: string;
  shipmentRequestId: string;
  scannedValue: string;
  qcUnitType: WarehouseQcUnitType;
  operatorId?: string | null;
}): Promise<ShopifyInventorySyncHint[]> {
  const ref = doc(db, `users/${input.clientUserId}/shipmentRequests`, input.shipmentRequestId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Order not found.");

  const data = snap.data() as Record<string, unknown>;
  if (packStatusFromRequest(data) !== "ready_to_dispatch") {
    throw new Error("Order is not ready to dispatch.");
  }
  if (dispatchStatusFromRequest(data) === "dispatched") {
    throw new Error("Order was already dispatched.");
  }

  const stored = courierTrackingFromRequest(data);
  if (!stored) {
    throw new Error("No courier label on file — re-pack this order.");
  }
  if (!courierScansMatch(input.scannedValue, stored)) {
    throw new Error("Wrong parcel — label does not match this order.");
  }

  const shopifyHints = await applyClientInventoryOnDispatch({
    clientUserId: input.clientUserId,
    shipmentRequestId: input.shipmentRequestId,
  });

  const batch = writeBatch(db);

  batch.update(ref, {
    warehouseDispatchStatus: "dispatched",
    warehouseDispatchedAt: serverTimestamp(),
    warehouseDispatchedBy: input.operatorId ?? null,
    warehouseQcUnitType: input.qcUnitType,
    warehouseQcCondition: "good",
    warehouseQcPassedAt: serverTimestamp(),
    warehouseQcPassedBy: input.operatorId ?? null,
    warehousePackStockSnapshot: deleteField(),
    updatedAt: serverTimestamp(),
  });

  const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");
  batch.set(doc(eventsRef), {
    type: "dispatched",
    shipmentRequestId: input.shipmentRequestId,
    clientUserId: input.clientUserId,
    courierTracking: stored,
    qcUnitType: input.qcUnitType,
    qcCondition: "good",
    operatorId: input.operatorId ?? null,
    at: serverTimestamp(),
  });

  await batch.commit();
  return shopifyHints;
}

/** Dispatch QC failed — restore warehouse stock and return order to pack. */
export async function returnToPackFromDispatchQc(input: {
  warehouseId: string;
  clientUserId: string;
  shipmentRequestId: string;
  scannedValue: string;
  qcUnitType: WarehouseQcUnitType;
  remarks: string;
  operatorId?: string | null;
}): Promise<void> {
  const remarks = input.remarks.trim();
  if (!remarks) throw new Error("Remarks are required when condition is not good.");

  const ref = doc(db, `users/${input.clientUserId}/shipmentRequests`, input.shipmentRequestId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Order not found.");

  const data = snap.data() as Record<string, unknown>;
  if (packStatusFromRequest(data) !== "ready_to_dispatch") {
    throw new Error("Order is not ready to dispatch.");
  }
  if (dispatchStatusFromRequest(data) === "dispatched") {
    throw new Error("Order was already dispatched.");
  }

  const stored = courierTrackingFromRequest(data);
  if (!stored) {
    throw new Error("No courier label on file — re-pack this order.");
  }
  if (!courierScansMatch(input.scannedValue, stored)) {
    throw new Error("Wrong parcel — label does not match this order.");
  }

  const snapshot = packStockSnapshotFromRequest(data);
  if (snapshot.length === 0) {
    throw new Error("No pack stock snapshot — contact a supervisor.");
  }

  const batch = writeBatch(db);

  await restorePackStockFromSnapshot({
    warehouseId: input.warehouseId,
    clientUserId: input.clientUserId,
    shipmentRequestId: input.shipmentRequestId,
    snapshot,
    operatorId: input.operatorId,
    batch,
  });

  batch.update(ref, {
    warehousePackStatus: "packing",
    warehouseDispatchStatus: deleteField(),
    warehouseReadyToDispatchAt: deleteField(),
    warehousePackedBy: deleteField(),
    warehousePackVerifiedKeys: [],
    warehouseCourierTracking: deleteField(),
    warehousePackCourierVerifiedAt: deleteField(),
    warehousePackStockSnapshot: deleteField(),
    warehouseQcUnitType: input.qcUnitType,
    warehouseQcCondition: "not_good",
    warehouseQcRemarks: remarks,
    warehouseQcFailedAt: serverTimestamp(),
    warehouseQcFailedBy: input.operatorId ?? null,
    warehouseQcPassedAt: deleteField(),
    warehouseQcPassedBy: deleteField(),
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
}
