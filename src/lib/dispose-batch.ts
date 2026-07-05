import {
  collection,
  doc,
  runTransaction,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  type WriteBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { DisposeBatch, DisposeBatchLine, DisposeRequest, InventoryItem } from "@/types";
import type { DisposeBulkValidatedRow } from "@/lib/dispose-bulk-import";

export const LINES_PER_WRITE_BATCH = 400;

export function disposeBatchesPath(userId: string): string {
  return `users/${userId}/disposeBatches`;
}

export function disposeBatchLinesPath(userId: string, batchId: string): string {
  return `users/${userId}/disposeBatches/${batchId}/lines`;
}

export type DisposeBatchLineInput = Omit<
  DisposeBatchLine,
  "id" | "batchId" | "lineNumber" | "status" | "approvedBy" | "approvedAt" | "rejectedBy" | "rejectedAt" | "adminFeedback"
>;

function lineInputToFirestore(
  line: DisposeBatchLineInput,
  context: {
    batchId: string;
    lineNumber: number;
    requestedAt: Timestamp;
  }
): Record<string, unknown> {
  return {
    batchId: context.batchId,
    lineNumber: context.lineNumber,
    productId: line.productId,
    productName: line.productName,
    sku: line.sku ?? "",
    currentQuantity: line.currentQuantity,
    stockStatus: line.stockStatus,
    quantity: line.quantity,
    reason: line.reason ?? "",
    status: "pending",
    requestedAt: context.requestedAt,
    ...(line.expiryDate ? { expiryDate: line.expiryDate } : {}),
  };
}

export function bulkRowToDisposeLineInput(row: DisposeBulkValidatedRow): DisposeBatchLineInput {
  return {
    productId: row.productId,
    productName: row.productName,
    sku: row.sku,
    currentQuantity: row.currentQuantity,
    stockStatus: row.stockStatus,
    expiryDate: row.expiryDate,
    quantity: row.disposeQuantity,
    reason: row.reason,
  };
}

export async function submitDisposeBatch(input: {
  userId: string;
  userName: string;
  reason: string;
  lines: DisposeBatchLineInput[];
}): Promise<string> {
  if (input.lines.length === 0) {
    throw new Error("Add at least one dispose line before submitting.");
  }

  const batchRef = doc(collection(db, disposeBatchesPath(input.userId)));
  const batchId = batchRef.id;
  const now = Timestamp.now();

  await setDoc(batchRef, {
    userId: input.userId,
    userName: input.userName || "Unknown User",
    reason: input.reason.trim(),
    status: "pending",
    totalLines: input.lines.length,
    pendingLines: input.lines.length,
    approvedLines: 0,
    rejectedLines: 0,
    requestedAt: now,
    requestedBy: input.userId,
  });

  for (let offset = 0; offset < input.lines.length; offset += LINES_PER_WRITE_BATCH) {
    const chunk = input.lines.slice(offset, offset + LINES_PER_WRITE_BATCH);
    const wb: WriteBatch = writeBatch(db);
    chunk.forEach((line, index) => {
      const lineRef = doc(collection(db, disposeBatchLinesPath(input.userId, batchId)));
      wb.set(
        lineRef,
        lineInputToFirestore(line, {
          batchId,
          lineNumber: offset + index + 1,
          requestedAt: now,
        })
      );
    });
    await wb.commit();
  }

  return batchId;
}

export async function refreshDisposeBatchCounts(
  userId: string,
  batchId: string,
  counts: {
    pending: number;
    approved: number;
    rejected: number;
    total: number;
  }
): Promise<void> {
  let status: DisposeBatch["status"] = "pending";
  if (counts.pending === 0) {
    status = "completed";
  } else if (counts.approved > 0 || counts.rejected > 0) {
    status = "partial";
  }

  await updateDoc(doc(db, disposeBatchesPath(userId), batchId), {
    status,
    totalLines: counts.total,
    pendingLines: counts.pending,
    approvedLines: counts.approved,
    rejectedLines: counts.rejected,
  });
}

export async function syncDisposeBatchLineStatus(
  userId: string,
  batchId: string,
  lineId: string,
  status: "approved" | "rejected",
  extra?: {
    approvedBy?: string;
    approvedAt?: Timestamp;
    rejectedBy?: string;
    rejectedAt?: Timestamp;
    adminFeedback?: string;
  }
): Promise<void> {
  const payload: Record<string, unknown> = { status };
  if (status === "approved") {
    if (extra?.approvedBy) payload.approvedBy = extra.approvedBy;
    if (extra?.approvedAt) payload.approvedAt = extra.approvedAt;
  } else {
    if (extra?.rejectedBy) payload.rejectedBy = extra.rejectedBy;
    if (extra?.rejectedAt) payload.rejectedAt = extra.rejectedAt;
    if (extra?.adminFeedback) payload.adminFeedback = extra.adminFeedback;
  }
  await updateDoc(doc(db, disposeBatchLinesPath(userId, batchId), lineId), payload);
}

export function batchLineToDisposeRequest(batch: DisposeBatch, line: DisposeBatchLine): DisposeRequest {
  return {
    id: line.id,
    productId: line.productId,
    productName: line.productName,
    quantity: line.quantity,
    reason: line.reason || batch.reason,
    status: line.status,
    requestedAt: line.requestedAt ?? batch.requestedAt,
    approvedBy: line.approvedBy,
    approvedAt: line.approvedAt,
    rejectedBy: line.rejectedBy,
    rejectedAt: line.rejectedAt,
    adminFeedback: line.adminFeedback,
    batchId: batch.id,
    batchLineId: line.id,
  };
}

/** Approve one dispose batch line — deduct inventory and move to recycled. */
export async function approveDisposeBatchLine(input: {
  userId: string;
  batchId: string;
  line: DisposeBatchLine;
  inventoryItem: InventoryItem;
  adminUid: string;
  adminName: string;
}): Promise<void> {
  const requestRef = doc(db, disposeBatchLinesPath(input.userId, input.batchId), input.line.id);
  const recycledCol = collection(db, `users/${input.userId}/recycledInventory`);
  const inventoryRef = doc(db, `users/${input.userId}/inventory`, input.inventoryItem.id);

  await runTransaction(db, async (tx) => {
    const invSnap = await tx.get(inventoryRef);
    if (!invSnap.exists()) {
      throw new Error(`Product ${input.inventoryItem.productName} not found in inventory.`);
    }
    const invItem = { id: invSnap.id, ...invSnap.data() } as InventoryItem;
    if (input.line.quantity > invItem.quantity) {
      throw new Error(
        `Insufficient quantity for ${invItem.productName}. Available: ${invItem.quantity}, requested: ${input.line.quantity}.`
      );
    }

    const now = Timestamp.now();
    const newRecycledRef = doc(recycledCol);

    if (input.line.quantity >= invItem.quantity) {
      tx.set(newRecycledRef, {
        ...invItem,
        recycledAt: now,
        recycledBy: input.adminName,
        remarks: input.line.reason || "",
      });
      tx.delete(inventoryRef);
    } else {
      const newQty = invItem.quantity - input.line.quantity;
      tx.update(inventoryRef, { quantity: newQty, status: newQty > 0 ? "In Stock" : "Out of Stock" });
      tx.set(newRecycledRef, {
        productName: invItem.productName,
        quantity: input.line.quantity,
        dateAdded: invItem.dateAdded,
        status: invItem.status,
        recycledAt: now,
        recycledBy: input.adminName,
        remarks: input.line.reason || "",
      });
    }

    tx.update(requestRef, {
      status: "approved",
      approvedBy: input.adminUid,
      approvedAt: now,
    });
  });
}

export async function rejectDisposeBatchLine(input: {
  userId: string;
  batchId: string;
  lineId: string;
  adminUid: string;
  adminFeedback?: string;
}): Promise<void> {
  const payload: Record<string, unknown> = {
    status: "rejected",
    rejectedBy: input.adminUid,
    rejectedAt: Timestamp.now(),
  };
  if (input.adminFeedback?.trim()) {
    payload.adminFeedback = input.adminFeedback.trim();
  }
  await updateDoc(doc(db, disposeBatchLinesPath(input.userId, input.batchId), input.lineId), payload);
}
