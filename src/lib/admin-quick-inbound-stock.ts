/**
 * Admin Quick Add: create inbound → approve (warehouse v2) → receive + putaway
 * so stock lands on the client without the pending-request workflow.
 */
import { doc, getDoc, Timestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  adminBatchReceiveInboundRequests,
  adminCompleteInboundReceiveAndPutaway,
  type AdminInboundCompleteInput,
  type AdminInboundCompleteResult,
} from "@/lib/admin-warehouse-override";
import type { InventoryRequest } from "@/types";

export async function approveProductInboundForWarehouseV2(input: {
  clientUserId: string;
  requestId: string;
  adminUid: string;
  approvalSource?: string;
}): Promise<void> {
  const ref = doc(db, `users/${input.clientUserId}/inventoryRequests`, input.requestId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Inbound request not found.");

  const request = snap.data() as InventoryRequest;
  if (String(request.status ?? "").toLowerCase() !== "pending") {
    throw new Error("Only pending requests can be approved.");
  }
  if (String(request.inventoryType ?? "product") !== "product") {
    throw new Error("Quick Add putaway supports product inbound only.");
  }

  const requestedQty =
    Number(request.requestedQuantity) || Number(request.quantity) || 0;
  const finalQuantity = Math.max(1, Math.floor(requestedQty));
  const now = Timestamp.now();

  await updateDoc(ref, {
    status: "approved",
    approvedBy: input.adminUid,
    approvedAt: now,
    approvalSource: input.approvalSource ?? "admin_quick_add",
    receivingDate: now,
    remarks: String(request.remarks ?? "").trim(),
    imageUrls: Array.isArray(request.imageUrls) ? request.imageUrls : [],
    requestedQuantity: requestedQty > 0 ? requestedQty : finalQuantity,
    receivedQuantity: finalQuantity,
    fulfillmentStatus: "open",
    warehouseGoodReceivedQty: 0,
    warehouseDamagedReceivedQty: 0,
    inboundWorkflowVersion: 2,
  });
}

export type AdminQuickInboundPutawayInput = Omit<
  AdminInboundCompleteInput,
  "clientUserId" | "requestId" | "clientDisplayName"
>;

/**
 * After Quick Add creates pending product request(s): approve each, then receive + putaway.
 */
export async function adminQuickInboundStockAfterCreate(input: {
  clientUserId: string;
  clientDisplayName?: string | null;
  requestIds: string[];
  adminUid: string;
  putaway: AdminQuickInboundPutawayInput;
}): Promise<{
  results: AdminInboundCompleteResult[];
  errors: Array<{ requestId: string; error: string }>;
}> {
  const ids = input.requestIds.map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) {
    throw new Error("No inbound requests were created.");
  }
  if (!input.putaway.warehouseId?.trim()) {
    throw new Error("Select a warehouse for putaway.");
  }

  for (const requestId of ids) {
    await approveProductInboundForWarehouseV2({
      clientUserId: input.clientUserId,
      requestId,
      adminUid: input.adminUid,
    });
  }

  const damagedQty = Math.max(0, Math.floor(input.putaway.damagedQuantity ?? 0));

  // Single line: allow damaged + exact putaway destinations from the form.
  if (ids.length === 1) {
    try {
      const result = await adminCompleteInboundReceiveAndPutaway({
        ...input.putaway,
        clientUserId: input.clientUserId,
        requestId: ids[0]!,
        clientDisplayName: input.clientDisplayName ?? null,
        damagedQuantity: damagedQty,
      });
      return { results: [result], errors: [] };
    } catch (e) {
      return {
        results: [],
        errors: [
          {
            requestId: ids[0]!,
            error: e instanceof Error ? e.message : "Receive failed.",
          },
        ],
      };
    }
  }

  // Multi-line: shared warehouse/bin; auto-resolve per SKU when needed. Damaged skipped.
  return adminBatchReceiveInboundRequests({
    items: ids.map((requestId) => ({
      clientUserId: input.clientUserId,
      requestId,
      clientDisplayName: input.clientDisplayName ?? null,
    })),
    shared: {
      warehouseId: input.putaway.warehouseId,
      stagingArea: input.putaway.stagingArea ?? null,
      binPath: input.putaway.binPath ?? null,
      unitType: input.putaway.unitType ?? "loose",
      packageCount: input.putaway.packageCount,
      lot: input.putaway.lot ?? null,
      expiry: input.putaway.expiry ?? null,
      carrier: input.putaway.carrier ?? null,
      trackingNumber: input.putaway.trackingNumber ?? null,
      notes: input.putaway.notes ?? null,
      operatorId: input.putaway.operatorId ?? null,
    },
  });
}
