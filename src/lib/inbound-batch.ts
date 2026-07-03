import {
  collection,
  doc,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  addDoc,
  type WriteBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { InboundBatch, InboundBatchLine, InboundLoadContents, InboundShipmentType, InventoryRequest } from "@/types";
import type { InboundBulkValidatedRow } from "@/lib/inbound-bulk-import";

export const INBOUND_SHIPMENT_TYPES: InboundShipmentType[] = ["carton", "pallet", "container", "package"];

export const INBOUND_LOAD_CONTENTS_OPTIONS: InboundLoadContents[] = ["carton", "pallet", "both"];

export type InboundBatchLineInput = Omit<
  InboundBatchLine,
  "id" | "batchId" | "lineNumber" | "status" | "inventoryRequestId"
>;

export function inboundBatchesPath(userId: string): string {
  return `users/${userId}/inboundBatches`;
}

export function inboundBatchLinesPath(userId: string, batchId: string): string {
  return `users/${userId}/inboundBatches/${batchId}/lines`;
}

export function bulkRowToLineInput(row: InboundBulkValidatedRow): InboundBatchLineInput {
  const line: InboundBatchLineInput = {
    userId: undefined,
    userName: undefined,
    inventoryType: row.inventoryType,
    productName: row.productName,
    quantity: row.quantity,
    requestedQuantity: row.quantity,
  };
  if (row.productSubType) line.productSubType = row.productSubType;
  if (row.productEntryMode) line.productEntryMode = row.productEntryMode;
  if (row.productId) line.productId = row.productId;
  if (row.sku) line.sku = row.sku;
  if (row.color) line.color = row.color;
  if (row.size) line.size = row.size;
  if (row.variantLabel) line.variantLabel = row.variantLabel;
  if (row.parentProductName) line.parentProductName = row.parentProductName;
  if (row.containerSize) line.containerSize = row.containerSize;
  if (row.retailIdentifier) line.retailIdentifier = row.retailIdentifier;
  if (row.expiryDate) line.expiryDate = row.expiryDate;
  if (row.remarks) line.remarks = row.remarks;
  if (row.trackingNumber) line.trackingNumber = row.trackingNumber;
  if (row.carrier) line.carrier = row.carrier;
  if (row.imageUrls?.length) {
    line.imageUrls = row.imageUrls;
    line.imageUrl = row.imageUrls[0];
  }
  return line;
}

function lineInputToFirestore(
  line: InboundBatchLineInput,
  context: {
    batchId: string;
    lineNumber: number;
    userId: string;
    userName: string;
    addDate: Timestamp;
    requestedAt: Timestamp;
  }
): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    batchId: context.batchId,
    lineNumber: context.lineNumber,
    userId: context.userId,
    userName: context.userName,
    inventoryType: line.inventoryType,
    productName: line.productName,
    quantity: line.quantity,
    requestedQuantity: line.requestedQuantity ?? line.quantity,
    status: "pending",
    addDate: context.addDate,
    requestedAt: context.requestedAt,
    requestedBy: context.userId,
  };

  if (line.productSubType) doc.productSubType = line.productSubType;
  if (line.productEntryMode) doc.productEntryMode = line.productEntryMode;
  if (line.productId) doc.productId = line.productId;
  if (line.sku) doc.sku = line.sku;
  if (line.color) doc.color = line.color;
  if (line.size) doc.size = line.size;
  if (line.variantLabel) doc.variantLabel = line.variantLabel;
  if (line.parentProductName) doc.parentProductName = line.parentProductName;
  if (line.containerSize) doc.containerSize = line.containerSize;
  if (line.retailIdentifier) doc.retailIdentifier = line.retailIdentifier;
  if (line.expiryDate) doc.expiryDate = line.expiryDate;
  if (line.remarks) doc.remarks = line.remarks;
  if (line.trackingNumber) doc.trackingNumber = line.trackingNumber;
  if (line.carrier) doc.carrier = line.carrier;
  if (line.imageUrls?.length) {
    doc.imageUrls = line.imageUrls;
    doc.imageUrl = line.imageUrl ?? line.imageUrls[0];
  }

  return doc;
}

const LINES_PER_WRITE_BATCH = 400;

export async function submitInboundBatch(input: {
  userId: string;
  userName: string;
  shipmentType?: InboundShipmentType;
  loadContents?: InboundLoadContents;
  productNotes?: string;
  lines: InboundBatchLineInput[];
}): Promise<string> {
  if (input.lines.length === 0) {
    throw new Error("Add at least one line before submitting.");
  }

  const batchRef = doc(collection(db, inboundBatchesPath(input.userId)));
  const batchId = batchRef.id;
  const now = Timestamp.now();

  await setDoc(batchRef, {
    userId: input.userId,
    userName: input.userName || "Unknown User",
    shipmentType: input.shipmentType ?? null,
    loadContents: input.loadContents ?? null,
    productNotes: input.productNotes?.trim() || null,
    status: "pending",
    totalLines: input.lines.length,
    pendingLines: input.lines.length,
    approvedLines: 0,
    rejectedLines: 0,
    cancelledLines: 0,
    addDate: now,
    requestedAt: now,
    requestedBy: input.userId,
  });

  for (let offset = 0; offset < input.lines.length; offset += LINES_PER_WRITE_BATCH) {
    const chunk = input.lines.slice(offset, offset + LINES_PER_WRITE_BATCH);
    const wb: WriteBatch = writeBatch(db);
    chunk.forEach((line, index) => {
      const lineRef = doc(collection(db, inboundBatchLinesPath(input.userId, batchId)));
      wb.set(
        lineRef,
        lineInputToFirestore(line, {
          batchId,
          lineNumber: offset + index + 1,
          userId: input.userId,
          userName: input.userName,
          addDate: now,
          requestedAt: now,
        })
      );
    });
    await wb.commit();
  }

  return batchId;
}

export function summarizeBatchLines(lines: InboundBatchLineInput[]): string {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const key = line.inventoryType;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([type, count]) => `${count} ${type}${count === 1 ? "" : "s"}`)
    .join(", ");
}

export function formatShipmentTypeLabel(type?: InboundShipmentType | null): string {
  if (!type) return "Not specified";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function formatLoadContentsLabel(contents?: InboundLoadContents | null): string {
  if (!contents) return "Not specified";
  if (contents === "both") return "Carton & pallet";
  return contents.charAt(0).toUpperCase() + contents.slice(1);
}

export function batchLineToInventoryRequest(
  batch: InboundBatch,
  line: InboundBatchLine
): InventoryRequest {
  return {
    id: line.inventoryRequestId || line.id,
    userId: batch.userId,
    userName: batch.userName,
    inventoryType: line.inventoryType,
    productName: line.productName,
    quantity: line.quantity,
    requestedQuantity: line.requestedQuantity ?? line.quantity,
    receivedQuantity: line.receivedQuantity,
    sku: line.sku,
    retailIdentifier: line.retailIdentifier,
    expiryDate: line.expiryDate,
    productSubType: line.productSubType,
    productId: line.productId,
    productEntryMode: line.productEntryMode,
    color: line.color,
    size: line.size,
    variantLabel: line.variantLabel,
    parentProductName: line.parentProductName,
    containerSize: line.containerSize,
    addDate: line.addDate ?? batch.addDate,
    requestedAt: line.requestedAt ?? batch.requestedAt,
    status: line.status,
    remarks: line.remarks,
    imageUrl: line.imageUrl,
    imageUrls: line.imageUrls,
    batchId: batch.id,
    batchLineId: line.id,
  };
}

/** Recompute batch aggregate status from line counts. */
export async function refreshInboundBatchCounts(
  userId: string,
  batchId: string,
  counts: {
    pending: number;
    approved: number;
    rejected: number;
    cancelled: number;
    total: number;
  }
): Promise<void> {
  let status: "pending" | "partial" | "completed" | "cancelled" = "pending";
  if (counts.cancelled === counts.total) {
    status = "cancelled";
  } else if (counts.pending === 0) {
    status = "completed";
  } else if (counts.approved > 0 || counts.rejected > 0 || counts.cancelled > 0) {
    status = "partial";
  }

  await updateDoc(doc(db, inboundBatchesPath(userId), batchId), {
    status,
    totalLines: counts.total,
    pendingLines: counts.pending,
    approvedLines: counts.approved,
    rejectedLines: counts.rejected,
    cancelledLines: counts.cancelled,
  });
}

/** Mirror a batch line to top-level inventoryRequests for the existing approve/receive flow. */
export async function ensureInventoryRequestForBatchLine(
  userId: string,
  batch: InboundBatch,
  line: InboundBatchLine
): Promise<string> {
  if (line.inventoryRequestId) return line.inventoryRequestId;

  const requestRef = await addDoc(collection(db, `users/${userId}/inventoryRequests`), {
    userId: batch.userId,
    userName: batch.userName,
    batchId: batch.id,
    batchLineId: line.id,
    inventoryType: line.inventoryType,
    productName: line.productName,
    quantity: line.quantity,
    requestedQuantity: line.requestedQuantity ?? line.quantity,
    sku: line.sku ?? null,
    retailIdentifier: line.retailIdentifier ?? null,
    expiryDate: line.expiryDate ?? null,
    productSubType: line.productSubType ?? null,
    productId: line.productId ?? null,
    productEntryMode: line.productEntryMode ?? null,
    color: line.color ?? null,
    size: line.size ?? null,
    variantLabel: line.variantLabel ?? null,
    parentProductName: line.parentProductName ?? null,
    containerSize: (line as InboundBatchLine & { containerSize?: string }).containerSize ?? null,
    remarks: line.remarks ?? null,
    imageUrl: line.imageUrl ?? null,
    imageUrls: line.imageUrls ?? null,
    addDate: line.addDate ?? batch.addDate ?? Timestamp.now(),
    requestedAt: line.requestedAt ?? batch.requestedAt ?? Timestamp.now(),
    requestedBy: batch.requestedBy ?? userId,
    status: "pending",
  });

  await updateDoc(doc(db, inboundBatchLinesPath(userId, batch.id), line.id), {
    inventoryRequestId: requestRef.id,
  });

  return requestRef.id;
}

export async function syncBatchLineStatus(
  userId: string,
  batchId: string,
  lineId: string,
  status: "approved" | "rejected" | "cancelled",
  extra?: Record<string, unknown>
): Promise<void> {
  await updateDoc(doc(db, inboundBatchLinesPath(userId, batchId), lineId), {
    status,
    ...extra,
  });
}
