/**
 * Admin Quick Ship: create outbound request → confirm → ready-to-dispatch → dispatch
 * so the shipment completes without waiting on the pending / warehouse queue.
 */
import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  adminAutoPickAndPackOutbound,
  adminDispatchOutboundWithTracking,
  adminShipOutboundFromInventoryOnly,
} from "@/lib/admin-warehouse-override";
import { resolvePrepOutboundShipmentsForConfirm } from "@/lib/prep-outbound";
import { isDefaultNj2Warehouse } from "@/lib/warehouse-display";
import type { WarehouseDoc } from "@/types";

export async function loadAdminQuickShipWarehouse(
  preferredWarehouseId?: string | null
): Promise<WarehouseDoc> {
  const snap = await getDocs(collection(db, "warehouses"));
  const active = snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as WarehouseDoc))
    .filter((w) => w.active !== false);
  if (preferredWarehouseId) {
    const preferred = active.find((w) => w.id === preferredWarehouseId);
    if (preferred) return preferred;
  }
  const warehouse =
    active.find((w) => isDefaultNj2Warehouse(w.name) || isDefaultNj2Warehouse(w.code)) ??
    active[0];
  if (!warehouse) throw new Error("No active warehouse found.");
  return warehouse;
}

export async function adminQuickApproveOutboundRequest(input: {
  clientUserId: string;
  requestId: string;
  adminUid: string;
  adminRemarks?: string | null;
  shippingDate?: Date | null;
}): Promise<void> {
  const ref = doc(db, `users/${input.clientUserId}/shipmentRequests`, input.requestId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Outbound request not found.");

  const request = snap.data() as Record<string, unknown>;
  const status = String(request.status ?? "").toLowerCase();
  if (status === "confirmed") return;
  if (status !== "pending" && status !== "awaiting_label" && status !== "awaiting_label_upload") {
    throw new Error(`Cannot Quick Ship request in status "${status}".`);
  }

  const resolvedShipments = await resolvePrepOutboundShipmentsForConfirm({
    clientUserId: input.clientUserId,
    requestData: {
      ...request,
      shipments: Array.isArray(request.shipments)
        ? (request.shipments as Array<Record<string, unknown>>)
        : [],
    },
  });

  const now = Timestamp.now();
  const alreadyReserved = Boolean(request.clientInventoryDeductedAt);
  const existingTiming = request.clientInventoryDeductionTiming;

  await updateDoc(ref, {
    status: "confirmed",
    confirmedBy: input.adminUid,
    confirmedAt: now,
    warehousePickStatus: "ready",
    warehousePackStatus: "pending",
    shipments: resolvedShipments,
    adminRemarks: String(input.adminRemarks ?? "").trim(),
    approvalSource: "admin_quick_ship",
    ...(input.shippingDate
      ? { date: Timestamp.fromDate(input.shippingDate) }
      : {}),
    ...(alreadyReserved || existingTiming === "create"
      ? { clientInventoryDeductionTiming: "create" }
      : { clientInventoryDeductionTiming: "dispatch" }),
  });
}

async function fulfillAndDispatchOne(input: {
  warehouse: WarehouseDoc;
  clientUserId: string;
  requestId: string;
  adminUid: string;
  trackingNumber?: string | null;
}): Promise<"bins" | "inventory"> {
  let mode: "bins" | "inventory" = "bins";
  try {
    await adminAutoPickAndPackOutbound({
      warehouse: input.warehouse,
      clientUserId: input.clientUserId,
      shipmentRequestId: input.requestId,
      operatorId: input.adminUid,
    });
  } catch {
    mode = "inventory";
    await adminShipOutboundFromInventoryOnly({
      warehouseId: input.warehouse.id,
      clientUserId: input.clientUserId,
      shipmentRequestId: input.requestId,
      operatorId: input.adminUid,
    });
  }

  await adminDispatchOutboundWithTracking({
    warehouseId: input.warehouse.id,
    clientUserId: input.clientUserId,
    shipmentRequestId: input.requestId,
    trackingNumber: input.trackingNumber ?? undefined,
    operatorId: input.adminUid,
  });

  return mode;
}

/**
 * After Quick Ship creates pending outbound request(s): confirm each, then
 * pick/pack (or inventory-only) and dispatch immediately.
 */
export async function adminQuickOutboundShipAfterCreate(input: {
  clientUserId: string;
  requestIds: string[];
  adminUid: string;
  warehouseId?: string | null;
  trackingNumber?: string | null;
  adminRemarks?: string | null;
}): Promise<{
  shipped: string[];
  errors: Array<{ requestId: string; error: string }>;
  fulfillmentModes: Array<"bins" | "inventory">;
}> {
  const ids = input.requestIds.map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) throw new Error("No outbound requests were created.");

  const warehouse = await loadAdminQuickShipWarehouse(input.warehouseId);
  const shipped: string[] = [];
  const errors: Array<{ requestId: string; error: string }> = [];
  const fulfillmentModes: Array<"bins" | "inventory"> = [];

  for (const requestId of ids) {
    try {
      await adminQuickApproveOutboundRequest({
        clientUserId: input.clientUserId,
        requestId,
        adminUid: input.adminUid,
        adminRemarks: input.adminRemarks,
      });
      const mode = await fulfillAndDispatchOne({
        warehouse,
        clientUserId: input.clientUserId,
        requestId,
        adminUid: input.adminUid,
        trackingNumber: input.trackingNumber,
      });
      await addDoc(collection(db, `users/${input.clientUserId}/notifications`), {
        type: "shipment_request",
        title: "Outbound shipment shipped",
        message: "Your outbound shipment was Quick Shipped by admin and marked dispatched.",
        isRead: false,
        targetUrl: "/dashboard/shipped-orders",
        relatedRequestId: requestId,
        createdAt: Timestamp.now(),
        createdBy: input.adminUid,
        source: "admin_quick_ship",
      });
      shipped.push(requestId);
      fulfillmentModes.push(mode);
    } catch (e) {
      errors.push({
        requestId,
        error: e instanceof Error ? e.message : "Quick Ship failed.",
      });
    }
  }

  return { shipped, errors, fulfillmentModes };
}
