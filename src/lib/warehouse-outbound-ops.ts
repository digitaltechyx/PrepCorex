import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  deleteField,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  getCommittedOutboundUnits,
  shipmentUnits,
  restoreClientInventoryForOutboundRequest,
} from "@/lib/client-inventory-outbound-sync";
import {
  buildOrderLinesFromRequestData,
  formatOutboundLineLabel,
  type ClientProductMap,
} from "@/lib/warehouse-outbound-lines";
import { clientMatchesWarehouse } from "@/lib/warehouse-client-match";
import { dateFromFirestore } from "@/lib/warehouse-stock-sort";
import type { LiveFirestoreDoc } from "@/lib/warehouse-ops-live-compute";
import {
  prepOutboundWaitingOnInbound,
  resolvePrepOutboundShipmentsForConfirm,
  shipmentRequestIsPrepOutbound,
} from "@/lib/prep-outbound";
import type { InventoryItem, InventoryRequest, UserProfile, WarehouseDoc } from "@/types";

export type PendingOutboundRequest = {
  id: string;
  clientUserId: string;
  clientDisplayName: string;
  shipTo?: string;
  service?: string;
  status: string;
  createdAt: Date | null;
  labelUrls: string[];
  lineSummary: string;
  needsClientLabel: boolean;
  canApprove: boolean;
  isPrepOutbound?: boolean;
  waitingOnInbound?: boolean;
};

/** Parse comma/newline-separated label URLs on a shipment request. */
export function parseShipmentLabelUrls(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map((u) => String(u ?? "").trim()).filter(Boolean);
  }
  return String(raw)
    .split(/[,\n]+/)
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u));
}

function displayClient(client: UserProfile | undefined, userId: string): string {
  if (!client) return userId.slice(0, 8);
  const name = client.name || client.email || userId;
  const cid = client.clientId ? ` (${client.clientId})` : "";
  return `${name}${cid}`;
}

function userIdFromDocPath(path: string): string {
  const parts = path.split("/");
  const idx = parts.indexOf("users");
  return idx >= 0 && parts[idx + 1] ? parts[idx + 1] : "";
}

function normOutboundStatus(status: unknown): string {
  return String(status ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Build pending outbound rows for Pick screen (approve like inbound dock).
 */
export function buildPendingOutboundQueueLive(input: {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
  shipmentDocs: LiveFirestoreDoc[];
  productMaps: Map<string, ClientProductMap>;
  /** Optional inbound request docs (`users/{uid}/inventoryRequests/...`) for prep-outbound gating. */
  inventoryDocs?: LiveFirestoreDoc[];
}): PendingOutboundRequest[] {
  const clientById = new Map(input.clients.map((c) => [c.uid, c]));
  const eligible = new Set(
    input.clients
      .filter((c) => clientMatchesWarehouse(c, input.warehouse))
      .map((c) => c.uid)
  );

  const inboundByClient = new Map<string, Map<string, InventoryRequest>>();
  for (const invDoc of input.inventoryDocs ?? []) {
    const path = invDoc.path;
    if (!path.includes("/inventoryRequests/")) continue;
    const clientUserId = userIdFromDocPath(path);
    if (!clientUserId) continue;
    let map = inboundByClient.get(clientUserId);
    if (!map) {
      map = new Map();
      inboundByClient.set(clientUserId, map);
    }
    map.set(invDoc.id, { id: invDoc.id, ...(invDoc.data as Omit<InventoryRequest, "id">) });
  }

  const rows: PendingOutboundRequest[] = [];

  for (const docRow of input.shipmentDocs) {
    const data = docRow.data;
    const status = normOutboundStatus(data.status);
    if (status !== "pending" && status !== "awaiting_label_upload") continue;

    const clientUserId = userIdFromDocPath(docRow.path);
    if (!clientUserId || !eligible.has(clientUserId)) continue;

    // Already on the floor / mid FBA pack — not a new pending approve row.
    const pickStatus = String(data.warehousePickStatus ?? "")
      .trim()
      .toLowerCase();
    const packStatus = String(data.warehousePackStatus ?? "")
      .trim()
      .toLowerCase();
    const fbaPhase = String(data.fbaPackPhase ?? "")
      .trim()
      .toLowerCase();
    if (
      pickStatus === "picking" ||
      pickStatus === "picked" ||
      pickStatus === "skipped" ||
      packStatus === "packing" ||
      packStatus === "ready_to_dispatch" ||
      fbaPhase === "awaiting_label" ||
      fbaPhase === "awaiting_courier"
    ) {
      continue;
    }

    const products = input.productMaps.get(clientUserId) ?? new Map();
    const lines = buildOrderLinesFromRequestData(data, products);
    const labelUrls = parseShipmentLabelUrls(data.labelUrl);
    const isFba =
      data.fbaLabelWorkflow === true ||
      String(data.service ?? "")
        .toLowerCase()
        .includes("fba");
    const needsClientLabel =
      status === "awaiting_label_upload" || (isFba && labelUrls.length === 0);
    const isPrepOutbound = shipmentRequestIsPrepOutbound(data);
    const waitingOnInbound = prepOutboundWaitingOnInbound({
      shipmentData: data,
      inboundById: inboundByClient.get(clientUserId) ?? new Map(),
    });
    const canApprove =
      (status === "pending" || (status === "awaiting_label_upload" && labelUrls.length > 0)) &&
      !waitingOnInbound;

    rows.push({
      id: docRow.id,
      clientUserId,
      clientDisplayName: displayClient(clientById.get(clientUserId), clientUserId),
      shipTo: data.shipTo != null ? String(data.shipTo) : undefined,
      service: data.service != null ? String(data.service) : undefined,
      status,
      createdAt: dateFromFirestore(data.createdAt) ?? dateFromFirestore(data.requestedAt),
      labelUrls,
      lineSummary:
        lines.length > 0
          ? lines.map((l) => formatOutboundLineLabel(l)).join(" · ")
          : "No SKU lines resolved yet",
      needsClientLabel,
      canApprove,
      isPrepOutbound,
      waitingOnInbound,
    });
  }

  rows.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
  return rows;
}

/**
 * Floor approve for outbound — confirms request so it enters the pick queue.
 * Client sellable inventory is reserved at request create; warehouse stock still deducts at dispatch.
 */
export async function confirmOutboundRequestAtPick(input: {
  clientUserId: string;
  shipmentRequestId: string;
  confirmedBy: string;
}): Promise<void> {
  const clientUserId = input.clientUserId.trim();
  const requestId = input.shipmentRequestId.trim();
  if (!clientUserId || !requestId) throw new Error("Missing client or request.");
  if (!input.confirmedBy.trim()) throw new Error("Sign in required to approve.");

  const requestRef = doc(db, `users/${clientUserId}/shipmentRequests`, requestId);
  const snap = await getDoc(requestRef);
  if (!snap.exists()) throw new Error("Shipment request not found.");
  const data = snap.data() as Record<string, unknown>;
  const status = normOutboundStatus(data.status);

  if (status === "confirmed") return;
  if (status !== "pending" && status !== "awaiting_label_upload") {
    throw new Error(`Only pending requests can be approved (current: ${status || "unknown"}).`);
  }

  const labelUrls = parseShipmentLabelUrls(data.labelUrl);
  if (status === "awaiting_label_upload" && labelUrls.length === 0) {
    throw new Error("Client label not uploaded yet — wait for label, then approve.");
  }

  const resolvedShipments = await resolvePrepOutboundShipmentsForConfirm({
    clientUserId,
    requestData: data,
  });
  if (resolvedShipments.length === 0) throw new Error("Order has no line items.");

  const resolvedData = { ...data, shipments: resolvedShipments };

  const alreadyReserved = Boolean(data.clientInventoryDeductedAt);
  const existingTiming = String(data.clientInventoryDeductionTiming || "");

  const committedByProduct = new Map<string, number>();
  if (!alreadyReserved) {
    for (const shipment of resolvedShipments) {
      const productId = String(shipment.productId ?? "").trim();
      if (!productId || committedByProduct.has(productId)) continue;
      committedByProduct.set(
        productId,
        await getCommittedOutboundUnits(clientUserId, productId, requestId)
      );
    }
  }

  await runTransaction(db, async (transaction) => {
    // Create-time reservations already reduced sellable qty — skip re-check.
    if (!alreadyReserved) {
      const neededByProduct = new Map<string, { name: string; units: number; inventoryRef: ReturnType<typeof doc> }>();

      for (let index = 0; index < resolvedShipments.length; index += 1) {
        const shipment = resolvedShipments[index]!;
        const productId = String(shipment.productId ?? "").trim();
        if (!productId) throw new Error("Missing product on a shipment line.");

        const inventoryRef = doc(db, `users/${clientUserId}/inventory`, productId);
        const totalUnits = shipmentUnits(resolvedData, shipment, index);
        const existing = neededByProduct.get(productId);
        if (existing) {
          existing.units += totalUnits;
        } else {
          neededByProduct.set(productId, {
            name: String(shipment.productName || productId),
            units: totalUnits,
            inventoryRef,
          });
        }
      }

      for (const [productId, need] of neededByProduct) {
        const inventorySnap = await transaction.get(need.inventoryRef);
        if (!inventorySnap.exists()) {
          throw new Error(`Product ${productId} not found in inventory.`);
        }
        const currentInventory = inventorySnap.data() as Omit<InventoryItem, "id">;
        const committed = committedByProduct.get(productId) ?? 0;
        const sellable = Math.max(0, Number(currentInventory.quantity) - committed);
        if (sellable < need.units) {
          throw new Error(
            `Not enough stock for ${currentInventory.productName}. Available: ${sellable}, Requested: ${need.units}.`
          );
        }
      }
    }

    transaction.update(requestRef, {
      status: "confirmed",
      confirmedBy: input.confirmedBy,
      confirmedAt: Timestamp.now(),
      clientInventoryDeductionTiming:
        alreadyReserved || existingTiming === "create" ? "create" : "dispatch",
      warehousePickStatus: "ready",
      shipments: resolvedShipments,
      updatedAt: serverTimestamp(),
    });
  });
}

export async function rejectOutboundRequestAtPick(input: {
  clientUserId: string;
  shipmentRequestId: string;
  rejectedBy: string;
  reason?: string;
}): Promise<void> {
  const requestRef = doc(
    db,
    `users/${input.clientUserId}/shipmentRequests`,
    input.shipmentRequestId
  );
  const snap = await getDoc(requestRef);
  if (!snap.exists()) throw new Error("Shipment request not found.");
  const status = normOutboundStatus(snap.data()?.status);
  if (status === "rejected" || status === "cancelled") return;
  if (status !== "pending" && status !== "awaiting_label_upload") {
    throw new Error("Only pending requests can be rejected.");
  }

  const reason = input.reason?.trim() || "Rejected at warehouse pick";
  await updateDoc(requestRef, {
    status: "rejected",
    rejectedBy: input.rejectedBy,
    rejectedAt: serverTimestamp(),
    rejectionReason: reason,
    updatedAt: serverTimestamp(),
  });

  await restoreClientInventoryForOutboundRequest({
    clientUserId: input.clientUserId,
    shipmentRequestId: input.shipmentRequestId,
    reason,
  });
}

/**
 * Full cancel for a confirmed outbound before carrier dispatch.
 * Restores pack snapshot (if ready to dispatch), reverses warehouse picks, cancels the
 * request, and restores reserved client inventory.
 */
export async function cancelConfirmedOutboundAtWarehouse(input: {
  clientUserId: string;
  shipmentRequestId: string;
  warehouseId: string;
  cancelledBy: string;
  reason: string;
}): Promise<void> {
  const clientUserId = input.clientUserId.trim();
  const shipmentRequestId = input.shipmentRequestId.trim();
  const warehouseId = input.warehouseId.trim();
  const reason = input.reason.trim();
  if (!clientUserId || !shipmentRequestId) throw new Error("Missing client or request.");
  if (!warehouseId) throw new Error("Warehouse is required.");
  if (!input.cancelledBy.trim()) throw new Error("Sign in required to cancel.");
  if (!reason) throw new Error("Cancellation reason is required.");

  const { reverseWarehousePicksForShipment } = await import("@/lib/warehouse-pick");
  const { restoreWarehouseStockForOutboundCancel } = await import("@/lib/warehouse-pack");

  const requestRef = doc(db, `users/${clientUserId}/shipmentRequests`, shipmentRequestId);
  const snap = await getDoc(requestRef);
  if (!snap.exists()) throw new Error("Shipment request not found.");
  const data = snap.data() as Record<string, unknown>;
  const status = normOutboundStatus(data.status);

  if (status === "cancelled" || status === "rejected") return;
  if (status !== "confirmed") {
    throw new Error(
      `Only approved (confirmed) outbounds can be cancelled here (current: ${status || "unknown"}).`
    );
  }

  const dispatchStatus = String(data.warehouseDispatchStatus ?? "")
    .trim()
    .toLowerCase();
  if (dispatchStatus === "dispatched") {
    throw new Error("This order was already dispatched — cancel is not available.");
  }

  await restoreWarehouseStockForOutboundCancel({
    warehouseId,
    clientUserId,
    shipmentRequestId,
    operatorId: input.cancelledBy,
  });

  await reverseWarehousePicksForShipment({
    warehouseId,
    clientUserId,
    shipmentRequestId,
    operatorId: input.cancelledBy,
  });

  await updateDoc(requestRef, {
    status: "cancelled",
    cancelledAt: serverTimestamp(),
    cancelledBy: input.cancelledBy,
    cancellationReason: reason,
    warehousePickStatus: "skipped",
    warehousePickSkipReason: `Cancelled: ${reason}`,
    warehousePickSkippedAt: serverTimestamp(),
    warehousePickSkippedBy: input.cancelledBy,
    warehousePackStatus: deleteField(),
    warehouseDispatchStatus: deleteField(),
    warehouseReadyToDispatchAt: deleteField(),
    warehousePackedBy: deleteField(),
    warehousePackVerifiedKeys: deleteField(),
    warehouseCourierTracking: deleteField(),
    warehousePackCourierVerifiedAt: deleteField(),
    warehousePackStockSnapshot: deleteField(),
    warehousePickedAt: deleteField(),
    warehousePickedBy: deleteField(),
    updatedAt: serverTimestamp(),
  });

  await restoreClientInventoryForOutboundRequest({
    clientUserId,
    shipmentRequestId,
    reason,
  });
}

export { editOutboundLineAtWarehouse } from "@/lib/warehouse-outbound-line-edit";
export type { EditOutboundLineResult } from "@/lib/warehouse-outbound-line-edit";
