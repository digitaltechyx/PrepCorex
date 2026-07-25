import {
  addDoc,
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { DeleteRequest, InventoryItem } from "@/types";

export function deleteRequestsPath(userId: string): string {
  return `users/${userId}/deleteRequests`;
}

export function deleteLogsPath(userId: string): string {
  return `users/${userId}/deleteLogs`;
}

async function notifyUser(
  userId: string,
  payload: { title: string; message: string; requestId: string; createdBy: string }
): Promise<void> {
  try {
    await addDoc(collection(db, `users/${userId}/notifications`), {
      type: "delete_request",
      title: payload.title,
      message: payload.message,
      isRead: false,
      targetUrl: "/dashboard/delete-logs",
      relatedRequestId: payload.requestId,
      createdAt: Timestamp.now(),
      createdBy: payload.createdBy,
    });
  } catch {
    // Notification delivery must never block the request itself.
  }
}

export async function submitDeleteRequest(input: {
  userId: string;
  item: InventoryItem;
  reason: string;
  requestedBy: string;
  requestedByName: string;
  /** Admin raising the request for the client. */
  onBehalf?: boolean;
}): Promise<string> {
  const reason = input.reason.trim();
  if (!reason) throw new Error("Enter a reason for the deletion request.");

  const ref = await addDoc(collection(db, deleteRequestsPath(input.userId)), {
    productId: input.item.id,
    productName: input.item.productName,
    sku: input.item.sku ?? "",
    quantity: Number(input.item.quantity) || 0,
    dateAdded: input.item.dateAdded ?? null,
    stockStatus: input.item.status,
    reason,
    status: "pending",
    requestedAt: serverTimestamp(),
    requestedBy: input.requestedBy,
    requestedByName: input.requestedByName || "User",
    onBehalf: Boolean(input.onBehalf),
  });
  return ref.id;
}

/**
 * Approve a delete request: writes the `deleteLogs` audit row and removes the
 * inventory item in one transaction, so the log can never outlive a failed delete.
 * Returns the item as it was deleted (for external marketplace sync).
 */
export async function approveDeleteRequest(input: {
  userId: string;
  request: DeleteRequest;
  adminUid: string;
  adminName: string;
}): Promise<InventoryItem> {
  const requestRef = doc(db, deleteRequestsPath(input.userId), input.request.id);
  const inventoryRef = doc(db, `users/${input.userId}/inventory`, input.request.productId);
  const logRef = doc(collection(db, deleteLogsPath(input.userId)));

  const deletedItem = await runTransaction(db, async (tx) => {
    const requestSnap = await tx.get(requestRef);
    if (!requestSnap.exists()) throw new Error("This delete request no longer exists.");
    const current = requestSnap.data() as DeleteRequest;
    if (current.status !== "pending") {
      throw new Error(`This request was already ${current.status}.`);
    }

    const invSnap = await tx.get(inventoryRef);
    if (!invSnap.exists()) {
      throw new Error(
        `"${input.request.productName}" is no longer in inventory. Reject this request instead.`
      );
    }
    const item = { id: invSnap.id, ...invSnap.data() } as InventoryItem;

    const now = Timestamp.now();
    tx.set(logRef, {
      productName: item.productName,
      quantity: Number(item.quantity) || 0,
      dateAdded: item.dateAdded ?? null,
      status: item.status,
      deletedAt: now,
      deletedBy: input.adminName || "Admin",
      reason: input.request.reason,
      requestId: input.request.id,
      requestedByName: input.request.requestedByName || "",
    });
    tx.delete(inventoryRef);
    tx.update(requestRef, {
      status: "approved",
      approvedBy: input.adminUid,
      approvedByName: input.adminName || "Admin",
      approvedAt: now,
      deleteLogId: logRef.id,
    });

    return item;
  });

  await notifyUser(input.userId, {
    title: "Delete request approved",
    message: `"${deletedItem.productName}" has been permanently deleted from your inventory.`,
    requestId: input.request.id,
    createdBy: input.adminUid,
  });

  return deletedItem;
}

export async function rejectDeleteRequest(input: {
  userId: string;
  request: DeleteRequest;
  adminUid: string;
  adminName: string;
  adminFeedback?: string;
}): Promise<void> {
  const feedback = input.adminFeedback?.trim() ?? "";
  await updateDoc(doc(db, deleteRequestsPath(input.userId), input.request.id), {
    status: "rejected",
    rejectedBy: input.adminUid,
    rejectedByName: input.adminName || "Admin",
    rejectedAt: Timestamp.now(),
    ...(feedback ? { adminFeedback: feedback } : {}),
  });

  await notifyUser(input.userId, {
    title: "Delete request rejected",
    message: feedback
      ? `Your request to delete "${input.request.productName}" was rejected. Reason: ${feedback}`
      : `Your request to delete "${input.request.productName}" was rejected.`,
    requestId: input.request.id,
    createdBy: input.adminUid,
  });
}

/** Withdraw a pending request (submitter or admin). */
export async function cancelDeleteRequest(input: {
  userId: string;
  requestId: string;
}): Promise<void> {
  await updateDoc(doc(db, deleteRequestsPath(input.userId), input.requestId), {
    status: "cancelled",
    cancelledAt: Timestamp.now(),
  });
}

export function deleteRequestIsOpen(request: Pick<DeleteRequest, "status">): boolean {
  return request.status === "pending";
}

/** Product ids with a request still awaiting a decision. */
export function pendingDeleteProductIds(requests: DeleteRequest[]): Set<string> {
  return new Set(requests.filter(deleteRequestIsOpen).map((r) => r.productId));
}
