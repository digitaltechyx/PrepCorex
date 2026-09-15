import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { resolveLexiClient } from "@/lib/lexi/access";
import type {
  LexiInboundApprovePayload,
  LexiInboundCreatePayload,
} from "@/lib/lexi/types";
import type { UserProfile } from "@/types";

export async function lexiCreateInboundRequest(
  adminProfile: UserProfile,
  adminUid: string,
  payload: LexiInboundCreatePayload
): Promise<{ requestId: string; clientUserId: string; clientUserName: string }> {
  const client = await resolveLexiClient(
    adminProfile,
    payload.clientUserId,
    payload.clientUserName
  );

  if (!payload.productName?.trim()) throw new Error("Product name is required.");
  if (!payload.sku?.trim()) throw new Error("SKU is required.");
  if (!Number.isFinite(payload.quantity) || payload.quantity <= 0) {
    throw new Error("Quantity must be greater than zero.");
  }

  const now = Timestamp.now();
  const doc: Record<string, unknown> = {
    userId: client.uid,
    userName: client.name,
    inventoryType: "product",
    productName: payload.productName.trim(),
    quantity: Math.floor(payload.quantity),
    requestedQuantity: Math.floor(payload.quantity),
    status: "pending",
    addDate: now,
    requestedAt: now,
    requestedBy: client.uid,
    productSubType: payload.productSubType,
    sku: payload.sku.trim(),
    approvalSource: null,
    lexiCreatedBy: adminUid,
  };

  if (payload.productSubType === "restock" && payload.productId) {
    doc.productId = payload.productId;
  }
  if (payload.remarks?.trim()) doc.remarks = payload.remarks.trim();

  const ref = await adminDb()
    .collection(`users/${client.uid}/inventoryRequests`)
    .add(doc);

  return { requestId: ref.id, clientUserId: client.uid, clientUserName: client.name };
}

export async function lexiApproveInboundRequest(
  adminProfile: UserProfile,
  adminUid: string,
  payload: LexiInboundApprovePayload
): Promise<{ requestId: string; clientUserId: string }> {
  const client = await resolveLexiClient(
    adminProfile,
    payload.clientUserId,
    payload.clientUserName
  );

  const ref = adminDb()
    .collection(`users/${client.uid}/inventoryRequests`)
    .doc(payload.requestId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Inbound request not found.");

  const request = snap.data()!;
  if (String(request.status ?? "").toLowerCase() !== "pending") {
    throw new Error("Only pending requests can be approved.");
  }
  if (String(request.inventoryType ?? "product") !== "product") {
    throw new Error("LEXI v1 supports product inbound only.");
  }

  const requestedQty =
    Number(request.requestedQuantity) ||
    Number(request.quantity) ||
    payload.quantity;
  const finalQuantity = Math.max(1, Math.floor(payload.quantity || requestedQty));
  const now = Timestamp.now();

  await ref.update({
    status: "approved",
    approvedBy: adminUid,
    approvedAt: now,
    approvalSource: "lexi_assistant",
    receivingDate: now,
    remarks: String(request.remarks ?? "").trim(),
    imageUrls: Array.isArray(request.imageUrls) ? request.imageUrls : [],
    requestedQuantity: requestedQty,
    receivedQuantity: finalQuantity,
    fulfillmentStatus: "open",
    warehouseGoodReceivedQty: 0,
    warehouseDamagedReceivedQty: 0,
    inboundWorkflowVersion: 2,
    lexiApprovedBy: adminUid,
  });

  return { requestId: payload.requestId, clientUserId: client.uid };
}

export async function lexiRejectInboundRequest(
  adminProfile: UserProfile,
  adminUid: string,
  payload: { clientUserId: string; clientUserName?: string; requestId: string; reason: string }
): Promise<{ requestId: string; clientUserId: string }> {
  const client = await resolveLexiClient(
    adminProfile,
    payload.clientUserId,
    payload.clientUserName
  );
  const reason = payload.reason.trim();
  if (reason.length < 3) throw new Error("Rejection reason is required.");

  const ref = adminDb()
    .collection(`users/${client.uid}/inventoryRequests`)
    .doc(payload.requestId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Inbound request not found.");
  if (String(snap.data()?.status ?? "").toLowerCase() !== "pending") {
    throw new Error("Only pending inbound requests can be rejected.");
  }

  const now = Timestamp.now();
  await ref.update({
    status: "rejected",
    rejectedBy: adminUid,
    rejectedAt: now,
    rejectionReason: reason,
    remarks: reason,
    lexiRejectedBy: adminUid,
  });

  await adminDb().collection(`users/${client.uid}/notifications`).add({
    type: "inventory_request",
    title: "Inventory request rejected",
    message: `Your inventory request was rejected. Reason: ${reason}`,
    isRead: false,
    targetUrl: "/dashboard/inventory",
    relatedRequestId: payload.requestId,
    createdAt: now,
    createdBy: adminUid,
  });

  return { requestId: payload.requestId, clientUserId: client.uid };
}
