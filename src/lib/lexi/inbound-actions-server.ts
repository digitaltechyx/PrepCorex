import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { resolveLexiClient, resolveLexiClientForInbound } from "@/lib/lexi/access";
import { addInboundTracking } from "@/lib/inbound-tracking-service";
import type {
  LexiInboundApprovePayload,
  LexiInboundCreatePayload,
} from "@/lib/lexi/types";
import type { UserProfile } from "@/types";

function parseExpiryTimestamp(raw?: string): Timestamp | undefined {
  const value = String(raw || "").trim();
  if (!value) return undefined;
  // Prefer YYYY-MM-DD noon local-ish to avoid timezone day shifts.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new Error("expiryDate must be a valid date (use YYYY-MM-DD).");
  }
  return Timestamp.fromDate(d);
}

function optionalPositiveNumber(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

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
  if (!Number.isFinite(payload.quantity) || payload.quantity <= 0) {
    throw new Error("Quantity must be greater than zero.");
  }
  if (payload.productSubType === "restock" && !String(payload.productId || "").trim()) {
    throw new Error("Restock requires productId from find_products.");
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
    approvalSource: null,
    lexiCreatedBy: adminUid,
  };
  if (payload.sku?.trim()) doc.sku = payload.sku.trim();

  if (payload.productSubType === "restock" && payload.productId) {
    doc.productId = payload.productId.trim();
  }
  if (payload.remarks?.trim()) doc.remarks = payload.remarks.trim();
  if (payload.retailIdentifier?.trim()) {
    doc.retailIdentifier = payload.retailIdentifier.trim();
  }

  const expiry = parseExpiryTimestamp(payload.expiryDate);
  if (expiry) doc.expiryDate = expiry;

  const length = optionalPositiveNumber(payload.unitLengthIn);
  const width = optionalPositiveNumber(payload.unitWidthIn);
  const height = optionalPositiveNumber(payload.unitHeightIn);
  const weight = optionalPositiveNumber(payload.unitWeightLb);
  if (length != null) doc.unitLengthIn = length;
  if (width != null) doc.unitWidthIn = width;
  if (height != null) doc.unitHeightIn = height;
  if (weight != null) doc.unitWeightLb = weight;

  const trackingNumber = payload.trackingNumber?.trim() || "";
  const carrier = payload.carrier?.trim() || undefined;
  if (trackingNumber) {
    doc.trackingNumber = trackingNumber;
    if (carrier) doc.carrier = carrier;
  }

  const ref = await adminDb()
    .collection(`users/${client.uid}/inventoryRequests`)
    .add(doc);

  if (trackingNumber) {
    try {
      await addInboundTracking({
        userId: client.uid,
        requestId: ref.id,
        trackingNumber,
        carrier,
        addedBy: adminUid,
      });
    } catch (err) {
      console.warn("[lexi] inbound tracking attach failed", err);
    }
  }

  return { requestId: ref.id, clientUserId: client.uid, clientUserName: client.name };
}

export async function lexiApproveInboundRequest(
  adminProfile: UserProfile,
  adminUid: string,
  payload: LexiInboundApprovePayload
): Promise<{ requestId: string; clientUserId: string }> {
  const client = await resolveLexiClientForInbound(adminProfile, {
    clientUserId: payload.clientUserId,
    clientUserName: payload.clientUserName,
    requestId: payload.requestId,
  });

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
