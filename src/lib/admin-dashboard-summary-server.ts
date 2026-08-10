import { adminDb } from "@/lib/firebase-admin";
import {
  buildAdminDashboardFinanceMetrics,
  resolveClientUserIdsForDashboard,
  type AdminDashboardFinanceMetrics,
} from "@/lib/admin-dashboard-finance-server";
import type { Invoice } from "@/types";

export type AdminDashboardSummary = {
  pendingRequestsCount: number;
  pendingInvoicesCount: number;
  pendingInvoicesAmount: number;
  ordersShippedToday: number;
  receivedUnitsToday: number;
  financial: AdminDashboardFinanceMetrics;
};

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function toMs(v: unknown): number {
  if (!v) return 0;
  if (typeof v === "string") {
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  if (typeof v === "object" && v !== null && "seconds" in v && typeof (v as { seconds: number }).seconds === "number") {
    return (v as { seconds: number }).seconds * 1000;
  }
  if (v instanceof Date) return v.getTime();
  return 0;
}

function uidFromDocPath(path: string): string {
  const parts = path.split("/");
  return parts[0] === "users" ? parts[1] || "" : "";
}

type QueryDoc = {
  id: string;
  ref: { path: string };
  data: () => Record<string, unknown>;
};

/** Safe pending query — never throws (missing index / rules → empty). */
async function pendingDocs(
  collectionId: string,
  allowedUserIds: Set<string>,
  opts?: { topLevelUserIdField?: boolean }
): Promise<QueryDoc[]> {
  try {
    const snap = opts?.topLevelUserIdField
      ? await adminDb().collection(collectionId).where("status", "==", "pending").get()
      : await adminDb().collectionGroup(collectionId).where("status", "==", "pending").get();

    return snap.docs
      .filter((d) => {
        if (opts?.topLevelUserIdField) {
          return allowedUserIds.has(String(d.data().userId || ""));
        }
        return allowedUserIds.has(uidFromDocPath(d.ref.path));
      })
      .map((d) => ({
        id: d.id,
        ref: { path: d.ref.path },
        data: () => d.data() as Record<string, unknown>,
      }));
  } catch (e) {
    console.warn(`[dashboard-summary] pending query failed for ${collectionId}:`, e);
    return [];
  }
}

/**
 * Pending-only count for Notifications types.
 * Fast collectionGroup status==pending queries (no full subcollection scans).
 */
async function countPendingRequests(allowedUserIds: Set<string>): Promise<number> {
  const [
    shipDocs,
    invDocs,
    retDocs,
    disposeDocs,
    deleteDocs,
    labelDocs,
    inboundBatchDocs,
    disposeBatchDocs,
    quarantineDocs,
  ] = await Promise.all([
    pendingDocs("shipmentRequests", allowedUserIds),
    pendingDocs("inventoryRequests", allowedUserIds),
    pendingDocs("productReturns", allowedUserIds),
    pendingDocs("disposeRequests", allowedUserIds),
    pendingDocs("deleteRequests", allowedUserIds),
    pendingDocs("labelRefundRequests", allowedUserIds),
    pendingDocs("inboundBatches", allowedUserIds),
    pendingDocs("disposeBatches", allowedUserIds),
    pendingDocs("quarantineRequests", allowedUserIds, { topLevelUserIdField: true }),
  ]);

  const multiLineInboundBatchIds = new Set(
    inboundBatchDocs.filter((d) => Number(d.data().totalLines || 0) > 1).map((d) => d.id)
  );
  const multiLineDisposeBatchIds = new Set(
    disposeBatchDocs.filter((d) => Number(d.data().totalLines || 0) > 1).map((d) => d.id)
  );

  let count = 0;
  count += shipDocs.length;
  count += retDocs.length;
  count += deleteDocs.length;
  count += labelDocs.length;
  count += quarantineDocs.length;

  for (const d of invDocs) {
    const batchId = String(d.data().batchId || "");
    if (batchId && multiLineInboundBatchIds.has(batchId)) continue;
    count += 1;
  }
  for (const d of inboundBatchDocs) {
    if (Number(d.data().totalLines || 0) <= 1) continue;
    count += 1;
  }

  for (const d of disposeDocs) {
    const batchId = String(d.data().batchId || "");
    if (batchId && multiLineDisposeBatchIds.has(batchId)) continue;
    count += 1;
  }
  for (const d of disposeBatchDocs) {
    if (Number(d.data().totalLines || 0) <= 1) continue;
    count += 1;
  }

  return count;
}

async function countTodayActivity(allowedUserIds: Set<string>): Promise<{
  ordersShippedToday: number;
  receivedUnitsToday: number;
}> {
  const todayStart = startOfDay(new Date());
  const todayEnd = endOfDay(new Date());
  const startMs = todayStart.getTime();
  const endMs = todayEnd.getTime();
  const db = adminDb();
  // Admin SDK Timestamp for range queries (indexes exist on shipped.date / inventory.receivingDate).
  const { Timestamp } = await import("firebase-admin/firestore");
  const startTs = Timestamp.fromDate(todayStart);
  const endTs = Timestamp.fromDate(todayEnd);

  let ordersShippedToday = 0;
  let receivedUnitsToday = 0;

  try {
    const shippedSnap = await db
      .collectionGroup("shipped")
      .where("date", ">=", startTs)
      .where("date", "<=", endTs)
      .get();
    for (const doc of shippedSnap.docs) {
      if (!allowedUserIds.has(uidFromDocPath(doc.ref.path))) continue;
      ordersShippedToday += 1;
    }
  } catch (e) {
    console.warn("[dashboard-summary] today shipped query failed:", e);
  }

  try {
    const invByReceiving = await db
      .collectionGroup("inventory")
      .where("receivingDate", ">=", startTs)
      .where("receivingDate", "<=", endTs)
      .get();
    for (const doc of invByReceiving.docs) {
      if (!allowedUserIds.has(uidFromDocPath(doc.ref.path))) continue;
      receivedUnitsToday += Number(doc.data().quantity) || 0;
    }
  } catch (e) {
    console.warn("[dashboard-summary] today inventory receivingDate query failed:", e);
  }

  // Also catch string-date inventory rows via dateAdded range when possible.
  try {
    const invByAdded = await db
      .collectionGroup("inventory")
      .where("dateAdded", ">=", startTs)
      .where("dateAdded", "<=", endTs)
      .get();
    const seen = new Set<string>();
    // Avoid double-count if both receivingDate and dateAdded match — only add when
    // receivingDate is missing/out of range.
    for (const doc of invByAdded.docs) {
      if (!allowedUserIds.has(uidFromDocPath(doc.ref.path))) continue;
      const data = doc.data();
      const recvMs = toMs(data.receivingDate);
      if (recvMs >= startMs && recvMs <= endMs) continue;
      if (seen.has(doc.ref.path)) continue;
      seen.add(doc.ref.path);
      receivedUnitsToday += Number(data.quantity) || 0;
    }
  } catch (e) {
    console.warn("[dashboard-summary] today inventory dateAdded query failed:", e);
  }

  return { ordersShippedToday, receivedUnitsToday };
}

async function countAllTimePendingInvoices(allowedUserIds: Set<string>): Promise<{
  pendingInvoicesCount: number;
  pendingInvoicesAmount: number;
}> {
  try {
    const snap = await adminDb().collectionGroup("invoices").where("status", "==", "pending").get();

    let pendingInvoicesCount = 0;
    let pendingInvoicesAmount = 0;
    for (const doc of snap.docs) {
      if (!allowedUserIds.has(uidFromDocPath(doc.ref.path))) continue;
      const inv = doc.data() as Invoice;
      pendingInvoicesCount += 1;
      pendingInvoicesAmount += Number(inv.grandTotal || 0);
    }
    return { pendingInvoicesCount, pendingInvoicesAmount };
  } catch (e) {
    console.warn("[dashboard-summary] pending invoices query failed:", e);
    return { pendingInvoicesCount: 0, pendingInvoicesAmount: 0 };
  }
}

const EMPTY_FINANCE: AdminDashboardFinanceMetrics = {
  billedInRange: 0,
  paidInRange: 0,
  dueInRange: 0,
  todayPaidRevenue: 0,
  todayPaidCount: 0,
  topClientsByRevenue: [],
};

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

export async function buildAdminDashboardSummary(input: {
  callerUid: string;
  from?: Date;
  to?: Date;
  allTime?: boolean;
  topClientsDays?: number;
}): Promise<AdminDashboardSummary> {
  const { userIds, nameByUid } = await resolveClientUserIdsForDashboard(input.callerUid);
  const allowedUserIds = new Set(userIds);
  const allTime = input.allTime ?? !(input.from && input.to);

  const [pendingRequestsCount, todayActivity, pendingInvoices, financial] = await Promise.all([
    countPendingRequests(allowedUserIds),
    countTodayActivity(allowedUserIds),
    countAllTimePendingInvoices(allowedUserIds),
    withTimeout(
      buildAdminDashboardFinanceMetrics({
        callerUid: input.callerUid,
        from: allTime ? undefined : input.from,
        to: allTime ? undefined : input.to,
        allTime,
        topClientsDays: input.topClientsDays,
        allowedUserIds,
        nameByUid,
      }),
      25000,
      "finance metrics"
    ).catch((e) => {
      console.warn("[dashboard-summary] finance metrics failed:", e);
      return EMPTY_FINANCE;
    }),
  ]);

  return {
    pendingRequestsCount,
    pendingInvoicesCount: pendingInvoices.pendingInvoicesCount,
    pendingInvoicesAmount: pendingInvoices.pendingInvoicesAmount,
    ordersShippedToday: todayActivity.ordersShippedToday,
    receivedUnitsToday: todayActivity.receivedUnitsToday,
    financial,
  };
}
