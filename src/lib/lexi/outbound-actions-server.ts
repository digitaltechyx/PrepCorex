import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { resolveLexiClient } from "@/lib/lexi/access";
import type { LexiOutboundApprovePayload } from "@/lib/lexi/types";
import type { UserProfile } from "@/types";

export async function lexiApproveOutboundRequest(
  adminProfile: UserProfile,
  adminUid: string,
  payload: LexiOutboundApprovePayload
): Promise<{ requestId: string; clientUserId: string }> {
  const client = await resolveLexiClient(
    adminProfile,
    payload.clientUserId,
    payload.clientUserName
  );

  const ref = adminDb().collection(`users/${client.uid}/shipmentRequests`).doc(payload.requestId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("Outbound request not found.");

  const request = snap.data()!;
  if (String(request.status ?? "").toLowerCase() !== "pending") {
    throw new Error("Only pending outbound requests can be approved.");
  }
  if (String(request.shipmentType ?? "product") !== "product") {
    throw new Error("LEXI outbound supports product shipments only.");
  }

  const now = Timestamp.now();
  await ref.update({
    status: "confirmed",
    confirmedBy: adminUid,
    confirmedAt: now,
    warehousePickStatus: "ready",
    warehousePackStatus: "pending",
    clientInventoryDeductionTiming: "create",
    adminRemarks: "",
    lexiApprovedBy: adminUid,
    approvalSource: "lexi_assistant",
  });

  await adminDb().collection(`users/${client.uid}/notifications`).add({
    type: "shipment_request",
    title: "Outbound shipment request approved",
    message: "Your outbound shipment request was approved and sent to the warehouse for fulfillment.",
    isRead: false,
    targetUrl: "/dashboard/create-shipment-with-labels",
    relatedRequestId: payload.requestId,
    createdAt: now,
    createdBy: adminUid,
    source: "lexi_assistant",
  });

  return { requestId: payload.requestId, clientUserId: client.uid };
}
