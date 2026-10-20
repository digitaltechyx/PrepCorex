import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { QuarantineRequest, QuarantineRequestKind } from "@/types";

export const QUARANTINE_REQUESTS = "quarantineRequests";

export type QuarantineHistoryMeta = {
  requestId: string;
  productName: string;
  reason?: string | null;
  notes?: string | null;
  actedByName?: string | null;
  /** Distinct log id when reversing a hold (reject) vs a normal release. */
  logSuffix?: "reversed" | null;
};

function quarantineChangeLogEventType(
  kind: QuarantineRequestKind
): "quarantine_hold" | "quarantine_release" | "quarantine_dispose" {
  if (kind === "release") return "quarantine_release";
  if (kind === "dispose") return "quarantine_dispose";
  return "quarantine_hold";
}

function quarantineChangeLogDocId(
  requestId: string,
  kind: QuarantineRequestKind,
  suffix?: "reversed" | null
): string {
  if (suffix === "reversed") return `quarantine_${requestId}_reversed`;
  if (kind === "release") return `quarantine_${requestId}_release`;
  if (kind === "dispose") return `quarantine_${requestId}_dispose`;
  return `quarantine_${requestId}`;
}

function buildQuarantineHistoryDetails(input: {
  kind: QuarantineRequestKind;
  movedQty: number;
  damagedBefore: number;
  damagedAfter: number;
  reason?: string | null;
  notes?: string | null;
  requestId: string;
  reversed?: boolean;
}): string {
  const headline = input.reversed
    ? "Quarantine rejected — stock restored"
    : input.kind === "release"
      ? "Released from quarantine"
      : input.kind === "dispose"
        ? "Disposed from quarantine"
        : "Moved to quarantine";
  return [
    headline,
    `${input.movedQty} unit${input.movedQty === 1 ? "" : "s"}`,
    `Damaged ${input.damagedBefore} → ${input.damagedAfter}`,
    input.reason?.trim() ? `Reason: ${input.reason.trim()}` : "",
    input.notes?.trim() ? `Notes: ${input.notes.trim()}` : "",
    `Request: ${input.requestId}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export async function writeQuarantineInventoryChangeLog(input: {
  userId: string;
  inventoryId: string;
  productName: string;
  sku: string;
  kind: QuarantineRequestKind;
  qtyBefore: number;
  qtyAfter: number;
  damagedBefore: number;
  damagedAfter: number;
  movedQty: number;
  history: QuarantineHistoryMeta;
  at?: Timestamp;
}): Promise<void> {
  const logId = quarantineChangeLogDocId(
    input.history.requestId,
    input.kind,
    input.history.logSuffix ?? null
  );
  const logRef = doc(db, `users/${input.userId}/inventoryChangeLogs`, logId);
  const existing = await getDoc(logRef);
  if (existing.exists()) return;

  const eventType =
    input.history.logSuffix === "reversed"
      ? "quarantine_release"
      : quarantineChangeLogEventType(input.kind);
  const qtyChange = input.qtyAfter - input.qtyBefore;

  await setDoc(logRef, {
    inventoryId: input.inventoryId,
    productName: input.productName || input.history.productName,
    sku: input.sku?.trim() || null,
    eventType,
    qtyBefore: input.qtyBefore,
    qtyAfter: input.qtyAfter,
    qtyChange,
    quarantineRequestId: input.history.requestId,
    actedByName: input.history.actedByName?.trim() || null,
    details: buildQuarantineHistoryDetails({
      kind: input.kind,
      movedQty: input.movedQty,
      damagedBefore: input.damagedBefore,
      damagedAfter: input.damagedAfter,
      reason: input.history.reason,
      notes: input.history.notes,
      requestId: input.history.requestId,
      reversed: input.history.logSuffix === "reversed",
    }),
    at: input.at ?? Timestamp.now(),
  });
}

function requestHasClientInventoryAdjusted(
  request: Pick<QuarantineRequest, "clientInventoryAdjustedAt">
): boolean {
  return Boolean(request.clientInventoryAdjustedAt);
}

/**
 * Backfill Stock history for quarantine holds that already moved inventory
 * before change-log writes existed (idempotent by stable doc id).
 * Safe to import from UI — no warehouse / carton modules.
 */
export async function ensureQuarantineInventoryHistoryLogged(
  request: QuarantineRequest
): Promise<boolean> {
  if (request.kind !== "quarantine") return false;
  if (request.status !== "approved" && request.status !== "completed") {
    return false;
  }
  if (!requestHasClientInventoryAdjusted(request) && request.status !== "completed") {
    return false;
  }

  const qty = Math.max(0, Math.floor(Number(request.quantity) || 0));
  if (qty < 1) return false;

  const logId = quarantineChangeLogDocId(request.id, "quarantine");
  const logRef = doc(db, `users/${request.userId}/inventoryChangeLogs`, logId);
  const existing = await getDoc(logRef);
  if (existing.exists()) return false;

  let invRef = doc(db, `users/${request.userId}/inventory`, request.productId);
  let snap = await getDoc(invRef);
  if (!snap.exists() && request.sku.trim()) {
    const bySku = await getDocs(
      query(
        collection(db, `users/${request.userId}/inventory`),
        where("sku", "==", request.sku.trim()),
        limit(1)
      )
    );
    if (bySku.empty) return false;
    invRef = bySku.docs[0].ref;
    snap = await getDoc(invRef);
  }
  if (!snap.exists()) return false;

  const data = snap.data() as {
    quantity?: number;
    damagedQuantity?: number;
    productName?: string;
  };
  const qtyAfter = Math.max(0, Number(data.quantity ?? 0));
  const damagedAfter = Math.max(0, Number(data.damagedQuantity ?? 0));
  const qtyBefore = qtyAfter + qty;
  const damagedBefore = Math.max(0, damagedAfter - qty);

  await writeQuarantineInventoryChangeLog({
    userId: request.userId,
    inventoryId: invRef.id,
    productName: String(data.productName ?? request.productName),
    sku: request.sku,
    kind: "quarantine",
    qtyBefore,
    qtyAfter,
    damagedBefore,
    damagedAfter,
    movedQty: qty,
    history: {
      requestId: request.id,
      productName: request.productName,
      reason: request.reason,
      notes: request.notes,
      actedByName:
        request.approvedByName ||
        request.completedByName ||
        request.requestedByName ||
        null,
    },
    at:
      typeof request.approvedAt === "object" &&
      request.approvedAt &&
      "seconds" in request.approvedAt
        ? new Timestamp(
            request.approvedAt.seconds,
            request.approvedAt.nanoseconds ?? 0
          )
        : Timestamp.now(),
  });
  return true;
}
