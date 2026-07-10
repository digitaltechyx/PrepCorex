import {
  buildCartonQtyByInventoryRequestId,
  isLegacyAdminFulfilledInboundRequest,
  type InboundRequestRow,
} from "@/lib/warehouse-inbound-requests";
import {
  buildCartonQtyByProductReturnId,
  countQuarantineReturnQcCartons,
  filterQuarantineReturnCartons,
  type ReturnRequestRow,
} from "@/lib/warehouse-returns";
import { cartonDerivedDashboardStats } from "@/lib/warehouse-ops-dashboard-stats";
import {
  buildOrderLinesFromRequestData,
  clientIdsNeedingProductLookup,
  type ClientProductMap,
} from "@/lib/warehouse-outbound-lines";
import {
  dispatchStatusFromRequest,
  packStatusFromRequest,
  pickStatusFromRequest,
} from "@/lib/warehouse-outbound-request-status";
import { clientMatchesWarehouse } from "@/lib/warehouse-client-match";
import { resolveInboundTrackings } from "@/lib/inbound-tracking";
import { fbaPackPhaseFromRequest, isFbaLabelWorkflowRequest } from "@/lib/fba-shipment-workflow";
import {
  shipFromForRequest,
  shipToForRequest,
} from "@/lib/warehouse-courier-label";
import type { OutboundPickOrder } from "@/lib/warehouse-pick";
import type { OutboundPackOrder } from "@/lib/warehouse-pack";
import { dateFromFirestore } from "@/lib/warehouse-stock-sort";
import type {
  InventoryRequest,
  ProductReturn,
  UserProfile,
  WarehouseCartonDoc,
  WarehouseDoc,
} from "@/types";
import type { WarehouseOpsDashboardStats } from "@/lib/warehouse-ops-dashboard-stats";

export type LiveFirestoreDoc = {
  id: string;
  path: string;
  data: Record<string, unknown>;
};

function userIdFromDocPath(path: string): string {
  const parts = path.split("/");
  const idx = parts.indexOf("users");
  return idx >= 0 && parts[idx + 1] ? parts[idx + 1] : "";
}

function displayClient(client: UserProfile | undefined, userId: string): string {
  if (!client) return userId.slice(0, 8);
  const name = client.name || client.email || userId;
  const cid = client.clientId ? ` (${client.clientId})` : "";
  return `${name}${cid}`;
}

function expectedQuantity(req: InventoryRequest): number {
  if (typeof req.receivedQuantity === "number" && req.receivedQuantity > 0) {
    return req.receivedQuantity;
  }
  if (typeof req.requestedQuantity === "number" && req.requestedQuantity > 0) {
    return req.requestedQuantity;
  }
  return Math.max(0, req.quantity ?? 0);
}

function expectedReturnQty(r: ProductReturn): number {
  return Math.max(0, Math.floor(r.requestedQuantity ?? 0));
}

function inboundNeedsLegacyInventoryCheck(req: Omit<InventoryRequest, "id">): boolean {
  if (req.status !== "approved") return false;
  if (req.fulfillmentStatus === "open") return false;
  return true;
}

function normInboundStatus(status: unknown): string {
  return String(status ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function isAwaitingDockReceive(
  row: Pick<InventoryRequest, "status" | "remainingQty" | "inboundTrackings" | "cartonReceivedQty">,
  legacyFulfilled: boolean
): boolean {
  const status = normInboundStatus(row.status);
  if (status === "rejected" || status === "cancelled") return false;
  // Pending always listed for dock review (match Notifications), even if qty is already 0.
  if (status === "pending") return true;
  if (status !== "approved") return false;
  if (row.remainingQty <= 0) return false;
  if (legacyFulfilled) return false;
  return true;
}

function countInboundDockLive(input: {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
  cartons: WarehouseCartonDoc[];
  inventoryDocs: LiveFirestoreDoc[];
  legacyInventoryByUser?: Map<string, Array<Record<string, unknown>>>;
}): number {
  const cartonMap = buildCartonQtyByInventoryRequestId(input.cartons);
  const legacyInventory = input.legacyInventoryByUser ?? new Map();

  let count = 0;
  for (const doc of input.inventoryDocs) {
    const data = doc.data as Omit<InventoryRequest, "id">;
    const invType = String(data.inventoryType ?? "")
      .trim()
      .toLowerCase();
    if (invType && invType !== "product" && invType !== "container") continue;
    const status = normInboundStatus(data.status);
    if (status !== "approved" && status !== "pending") continue;

    const clientUserId = userIdFromDocPath(doc.path);
    if (!clientUserId) continue;

    const expectedQty = expectedQuantity({ ...data, id: doc.id });
    const cartonReceivedQty = cartonMap.get(doc.id) ?? 0;
    const remainingQty = Math.max(0, expectedQty - cartonReceivedQty);

    const legacyFulfilled = inboundNeedsLegacyInventoryCheck(data)
      ? isLegacyAdminFulfilledInboundRequest({
          clientUserId,
          requestId: doc.id,
          req: data,
          inventoryByUser: legacyInventory,
        })
      : false;

    if (data.fulfillmentStatus === "closed") continue;
    if (status === "approved" && legacyFulfilled && cartonReceivedQty === 0) continue;

    if (
      !isAwaitingDockReceive(
        {
          status: data.status,
          remainingQty,
          inboundTrackings: data.inboundTrackings,
          cartonReceivedQty,
        },
        legacyFulfilled
      )
    ) {
      continue;
    }

    count += 1;
  }
  return count;
}

function countReturnQcLive(cartons: WarehouseCartonDoc[]): number {
  return countQuarantineReturnQcCartons(cartons);
}

function inferQcUnitTypeFromRequest(data: Record<string, unknown>) {
  const raw = data.warehouseDefaultQcUnitType;
  if (raw === "carton" || raw === "pallet") return raw;
  return "package" as const;
}

function buildPackOrder(
  id: string,
  clientUserId: string,
  data: Record<string, unknown>,
  clientById: Map<string, UserProfile>,
  lines: OutboundPickOrder["lines"],
  warehouse: WarehouseDoc
): OutboundPackOrder {
  return {
    id,
    clientUserId,
    clientDisplayName: displayClient(clientById.get(clientUserId), clientUserId),
    shipTo: shipToForRequest(data) || undefined,
    shipFrom: shipFromForRequest(data, warehouse),
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
    service: data.service != null ? String(data.service) : undefined,
    fbaLabelWorkflow: isFbaLabelWorkflowRequest(data),
    fbaPackPhase: fbaPackPhaseFromRequest(data),
  };
}

function courierTrackingFromRequest(data: Record<string, unknown>): string | null {
  const raw = data.warehouseCourierTracking;
  if (raw == null || String(raw).trim() === "") return null;
  return String(raw).trim();
}

export function buildOutboundQueuesLive(input: {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
  shipmentDocs: LiveFirestoreDoc[];
  productMaps: Map<string, ClientProductMap>;
}): {
  pickQueue: OutboundPickOrder[];
  packQueue: OutboundPackOrder[];
  dispatchQueue: OutboundPackOrder[];
} {
  const clientById = new Map(input.clients.map((c) => [c.uid, c]));
  const eligible = new Set(
    input.clients
      .filter((c) => clientMatchesWarehouse(c, input.warehouse))
      .map((c) => c.uid)
  );

  const pickQueue: OutboundPickOrder[] = [];
  const packQueue: OutboundPackOrder[] = [];
  const dispatchQueue: OutboundPackOrder[] = [];

  for (const doc of input.shipmentDocs) {
    const data = doc.data;
    if (data.status !== "confirmed") continue;

    const clientUserId = userIdFromDocPath(doc.path);
    if (!eligible.has(clientUserId)) continue;

    const products = input.productMaps.get(clientUserId) ?? new Map();
    const lines = buildOrderLinesFromRequestData(data, products);
    if (lines.length === 0) continue;

    const pickStatus = pickStatusFromRequest(data);
    const packStatus = packStatusFromRequest(data);
    const dispatchStatus = dispatchStatusFromRequest(data);

    if (pickStatus !== "picked" && pickStatus !== "skipped") {
      pickQueue.push({
        id: doc.id,
        clientUserId,
        clientDisplayName: displayClient(clientById.get(clientUserId), clientUserId),
        shipTo: data.shipTo != null ? String(data.shipTo) : undefined,
        confirmedAt: dateFromFirestore(data.confirmedAt),
        warehousePickStatus: pickStatus,
        lines,
      });
      continue;
    }

    if (
      pickStatus === "picked" &&
      packStatus !== "ready_to_dispatch" &&
      fbaPackPhaseFromRequest(data) !== "awaiting_label"
    ) {
      packQueue.push(
        buildPackOrder(doc.id, clientUserId, data, clientById, lines, input.warehouse)
      );
      continue;
    }

    if (packStatus === "ready_to_dispatch" && dispatchStatus !== "dispatched") {
      dispatchQueue.push(
        buildPackOrder(doc.id, clientUserId, data, clientById, lines, input.warehouse)
      );
    }
  }

  pickQueue.sort((a, b) => (a.confirmedAt?.getTime() ?? 0) - (b.confirmedAt?.getTime() ?? 0));
  packQueue.sort((a, b) => {
    const aFailed = a.qcFailedAt ? 1 : 0;
    const bFailed = b.qcFailedAt ? 1 : 0;
    if (aFailed !== bFailed) return bFailed - aFailed;
    return (a.confirmedAt?.getTime() ?? 0) - (b.confirmedAt?.getTime() ?? 0);
  });
  dispatchQueue.sort((a, b) => {
    const ta = a.readyToDispatchAt?.getTime() ?? a.confirmedAt?.getTime() ?? 0;
    const tb = b.readyToDispatchAt?.getTime() ?? b.confirmedAt?.getTime() ?? 0;
    return tb - ta;
  });

  return { pickQueue, packQueue, dispatchQueue };
}

export function computeWarehouseOpsLiveStats(input: {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
  cartons: WarehouseCartonDoc[];
  shipmentDocs: LiveFirestoreDoc[];
  inventoryDocs: LiveFirestoreDoc[];
  returnDocs: LiveFirestoreDoc[];
  cycleCountOpen: number;
  productMaps: Map<string, ClientProductMap>;
  legacyInventoryByUser?: Map<string, Array<Record<string, unknown>>>;
}): WarehouseOpsDashboardStats {
  const cartonStats = cartonDerivedDashboardStats(input.cartons);
  const { pickQueue, packQueue, dispatchQueue } = buildOutboundQueuesLive({
    warehouse: input.warehouse,
    clients: input.clients,
    shipmentDocs: input.shipmentDocs,
    productMaps: input.productMaps,
  });

  return {
    ...cartonStats,
    inboundDock: countInboundDockLive({
      warehouse: input.warehouse,
      clients: input.clients,
      cartons: input.cartons,
      inventoryDocs: input.inventoryDocs,
      legacyInventoryByUser: input.legacyInventoryByUser,
    }),
    pickQueue: pickQueue.length,
    packQueue: packQueue.length,
    dispatchReady: dispatchQueue.length,
    cycleCountOpen: input.cycleCountOpen,
    returnQc: countReturnQcLive(input.cartons),
  };
}

export function clientIdsForProductMaps(input: {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
  shipmentDocs: LiveFirestoreDoc[];
}): string[] {
  const eligible = new Set(
    input.clients
      .filter((c) => clientMatchesWarehouse(c, input.warehouse))
      .map((c) => c.uid)
  );

  const pending: Array<{ clientUserId: string; data: Record<string, unknown> }> = [];
  for (const doc of input.shipmentDocs) {
    if (doc.data.status !== "confirmed") continue;
    const clientUserId = userIdFromDocPath(doc.path);
    if (!eligible.has(clientUserId)) continue;
    pending.push({ clientUserId, data: doc.data });
  }

  return clientIdsNeedingProductLookup(pending);
}

export function legacyInventoryClientIds(input: {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
  inventoryDocs: LiveFirestoreDoc[];
}): string[] {
  const eligible = new Set(
    input.clients
      .filter((c) => clientMatchesWarehouse(c, input.warehouse)).map((c) => c.uid)
  );
  const ids = new Set<string>();
  for (const doc of input.inventoryDocs) {
    const data = doc.data as Omit<InventoryRequest, "id">;
    if (data.status !== "approved") continue;
    const clientUserId = userIdFromDocPath(doc.path);
    if (!eligible.has(clientUserId)) continue;
    if (inboundNeedsLegacyInventoryCheck(data)) ids.add(clientUserId);
  }
  return [...ids];
}

export { buildOutboundQueuesLive as getLiveOutboundQueues };

function returnSku(r: ProductReturn): string {
  if (r.sku?.trim()) return r.sku.trim();
  if (r.newProductSku?.trim()) return r.newProductSku.trim();
  return "";
}

function returnProductName(r: ProductReturn): string {
  return (
    r.productName?.trim() ||
    r.newProductName?.trim() ||
    returnSku(r) ||
    "Product return"
  );
}

export function buildInboundDockQueueLive(input: {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
  cartons: WarehouseCartonDoc[];
  inventoryDocs: LiveFirestoreDoc[];
  legacyInventoryByUser?: Map<string, Array<Record<string, unknown>>>;
}): InboundRequestRow[] {
  const clientById = new Map(input.clients.map((c) => [c.uid, c]));
  // Do not filter by warehouse location assignment — inbound dock should mirror Notifications.
  const cartonMap = buildCartonQtyByInventoryRequestId(input.cartons);
  const legacyInventory = input.legacyInventoryByUser ?? new Map();
  const rows: InboundRequestRow[] = [];

  for (const doc of input.inventoryDocs) {
    const data = doc.data as Omit<InventoryRequest, "id">;
    const invType = String(data.inventoryType ?? "")
      .trim()
      .toLowerCase();
    if (invType && invType !== "product" && invType !== "container") continue;
    const status = normInboundStatus(data.status);
    if (status !== "approved" && status !== "pending") continue;

    const clientUserId = userIdFromDocPath(doc.path);
    if (!clientUserId) continue;

    const expectedQty = expectedQuantity({ ...data, id: doc.id });
    const cartonReceivedQty = cartonMap.get(doc.id) ?? 0;
    const remainingQty = Math.max(0, expectedQty - cartonReceivedQty);

    const legacyFulfilled = inboundNeedsLegacyInventoryCheck(data)
      ? isLegacyAdminFulfilledInboundRequest({
          clientUserId,
          requestId: doc.id,
          req: data,
          inventoryByUser: legacyInventory,
        })
      : false;

    const row: InboundRequestRow = {
      ...data,
      id: doc.id,
      // Normalize so dock UI / approve filters match Firestore casing variants.
      status: (status === "pending" ? "pending" : status === "approved" ? "approved" : data.status) as InventoryRequest["status"],
      userId: clientUserId,
      clientUserId,
      clientDisplayName: displayClient(clientById.get(clientUserId), clientUserId),
      expectedQty,
      cartonReceivedQty,
      remainingQty,
      inboundTrackings: resolveInboundTrackings(
        data as InventoryRequest & { trackingNumber?: string; carrier?: string }
      ),
    };

    if (!isAwaitingDockReceive(row, legacyFulfilled)) continue;
    if (data.fulfillmentStatus === "closed") continue;
    if (status === "approved" && legacyFulfilled && cartonReceivedQty === 0) continue;

    rows.push(row);
  }

  return rows.sort((a, b) => {
    // Pending first so receivers see work to approve.
    if (a.status === "pending" !== (b.status === "pending")) {
      return a.status === "pending" ? -1 : 1;
    }
    if (a.remainingQty > 0 !== b.remainingQty > 0) {
      return a.remainingQty > 0 ? -1 : 1;
    }
    return a.clientDisplayName.localeCompare(b.clientDisplayName);
  });
}

export function buildReturnDockQueueLive(input: {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
  cartons: WarehouseCartonDoc[];
  returnDocs: LiveFirestoreDoc[];
}): ReturnRequestRow[] {
  const clientById = new Map(input.clients.map((c) => [c.uid, c]));
  const eligibleClientIds = new Set(
    input.clients.filter((c) => clientMatchesWarehouse(c, input.warehouse)).map((c) => c.uid)
  );
  const cartonMap = buildCartonQtyByProductReturnId(input.cartons);
  const rows: ReturnRequestRow[] = [];

  for (const doc of input.returnDocs) {
    const data = doc.data as Omit<ProductReturn, "id">;
    const status = String(data.status ?? "");
    if (status !== "approved" && status !== "in_progress") continue;

    const clientUserId = userIdFromDocPath(doc.path);
    if (!clientUserId || !eligibleClientIds.has(clientUserId)) continue;

    const expectedQty = expectedReturnQty({ ...data, id: doc.id });
    const warehouseReceivedQty = cartonMap.get(doc.id) ?? 0;
    const remainingQty = Math.max(0, expectedQty - warehouseReceivedQty);

    rows.push({
      ...data,
      id: doc.id,
      clientUserId,
      clientDisplayName: displayClient(clientById.get(clientUserId), clientUserId),
      skuLabel: returnSku({ ...data, id: doc.id }),
      productLabel: returnProductName({ ...data, id: doc.id }),
      expectedQty,
      warehouseReceivedQty,
      remainingQty,
    });
  }

  return rows.sort((a, b) => {
    if (a.remainingQty > 0 !== b.remainingQty > 0) {
      return a.remainingQty > 0 ? -1 : 1;
    }
    return a.clientDisplayName.localeCompare(b.clientDisplayName);
  });
}

export { filterQuarantineReturnCartons } from "@/lib/warehouse-returns";
