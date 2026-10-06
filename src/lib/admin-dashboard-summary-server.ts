import { adminDb } from "@/lib/firebase-admin";
import {
  buildAdminDashboardFinanceMetrics,
  resolveClientUserIdsForDashboard,
  type AdminDashboardFinanceMetrics,
} from "@/lib/admin-dashboard-finance-server";
import {
  countPendingNotificationItems,
  isPendingRequestStatus,
  type PendingNotificationCountItem,
} from "@/lib/pending-notification-count";

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

function mapPendingDocs(
  docs: Array<{ id: string; ref: { path: string }; data: () => Record<string, unknown> }>,
  allowedUserIds: Set<string>,
  opts?: { topLevelUserIdField?: boolean }
): QueryDoc[] {
  return docs
    .filter((d) => {
      if (!isPendingRequestStatus(d.data().status)) return false;
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
}

/**
 * Resilient pending load — matches Notifications / sidebar badges.
 * Tries status in ["pending","Pending"], then full scan + filter, then per-user fallback.
 */
async function pendingDocs(
  collectionId: string,
  allowedUserIds: Set<string>,
  opts?: { topLevelUserIdField?: boolean }
): Promise<QueryDoc[]> {
  const db = adminDb();

  if (opts?.topLevelUserIdField) {
    try {
      const snap = await db.collection(collectionId).where("status", "in", ["pending", "Pending"]).get();
      return mapPendingDocs(snap.docs, allowedUserIds, opts);
    } catch (e1) {
      console.warn(`[dashboard-summary] pending in-query failed for ${collectionId}, trying full scan:`, e1);
      try {
        const snap = await db.collection(collectionId).get();
        return mapPendingDocs(snap.docs, allowedUserIds, opts);
      } catch (e2) {
        console.warn(`[dashboard-summary] pending full scan failed for ${collectionId}:`, e2);
        return [];
      }
    }
  }

  try {
    const snap = await db.collectionGroup(collectionId).where("status", "in", ["pending", "Pending"]).get();
    return mapPendingDocs(snap.docs, allowedUserIds);
  } catch (e1) {
    console.warn(`[dashboard-summary] pending CG in-query failed for ${collectionId}, trying full CG:`, e1);
  }

  try {
    const snap = await db.collectionGroup(collectionId).get();
    return mapPendingDocs(snap.docs, allowedUserIds);
  } catch (e2) {
    console.warn(`[dashboard-summary] pending CG full scan failed for ${collectionId}, trying per-user:`, e2);
  }

  // Per-user fallback (same resilience as Notifications for dispose/delete).
  const out: QueryDoc[] = [];
  const uids = [...allowedUserIds];
  const chunkSize = 25;
  for (let i = 0; i < uids.length; i += chunkSize) {
    const chunk = uids.slice(i, i + chunkSize);
    const snaps = await Promise.all(
      chunk.map(async (uid) => {
        try {
          return await db.collection(`users/${uid}/${collectionId}`).get();
        } catch {
          return null;
        }
      })
    );
    for (const snap of snaps) {
      if (!snap) continue;
      out.push(...mapPendingDocs(snap.docs, allowedUserIds));
    }
  }
  return out;
}

function mapScopedDocs(
  docs: Array<{ id: string; ref: { path: string }; data: () => Record<string, unknown> }>,
  allowedUserIds: Set<string>,
  opts?: { topLevelUserIdField?: boolean }
): QueryDoc[] {
  return docs
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
}

/**
 * Load all docs in a collectionGroup (or top-level) scoped to allowed users.
 * Used for inbound/dispose batches so we can hide lines for partial multi-line batches.
 */
async function scopedDocs(
  collectionId: string,
  allowedUserIds: Set<string>,
  opts?: { topLevelUserIdField?: boolean }
): Promise<QueryDoc[]> {
  const db = adminDb();

  if (opts?.topLevelUserIdField) {
    try {
      const snap = await db.collection(collectionId).get();
      return mapScopedDocs(snap.docs, allowedUserIds, opts);
    } catch (e) {
      console.warn(`[dashboard-summary] scoped load failed for ${collectionId}:`, e);
      return [];
    }
  }

  try {
    const snap = await db.collectionGroup(collectionId).get();
    return mapScopedDocs(snap.docs, allowedUserIds);
  } catch (e1) {
    console.warn(`[dashboard-summary] scoped CG failed for ${collectionId}, trying per-user:`, e1);
  }

  const out: QueryDoc[] = [];
  const uids = [...allowedUserIds];
  const chunkSize = 25;
  for (let i = 0; i < uids.length; i += chunkSize) {
    const chunk = uids.slice(i, i + chunkSize);
    const snaps = await Promise.all(
      chunk.map(async (uid) => {
        try {
          return await db.collection(`users/${uid}/${collectionId}`).get();
        } catch {
          return null;
        }
      })
    );
    for (const snap of snaps) {
      if (!snap) continue;
      out.push(...mapScopedDocs(snap.docs, allowedUserIds));
    }
  }
  return out;
}

/**
 * Pending-only count for Notifications types (Pending tab).
 * Dedupes multi-line inbound/dispose batches to one parent row, matching the Notifications UI.
 * Uses shared rules with the sidebar badge (includes partial batches).
 */
export async function countPendingRequests(allowedUserIds: Set<string>): Promise<number> {
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
    walletTopupDocs,
    apiFeeDocs,
  ] = await Promise.all([
    pendingDocs("shipmentRequests", allowedUserIds),
    pendingDocs("inventoryRequests", allowedUserIds),
    pendingDocs("productReturns", allowedUserIds),
    pendingDocs("disposeRequests", allowedUserIds),
    pendingDocs("deleteRequests", allowedUserIds),
    pendingDocs("labelRefundRequests", allowedUserIds),
    scopedDocs("inboundBatches", allowedUserIds),
    scopedDocs("disposeBatches", allowedUserIds),
    pendingDocs("quarantineRequests", allowedUserIds, { topLevelUserIdField: true }),
    pendingDocs("labelWalletTopupRequests", allowedUserIds),
    pendingDocs("labelApiFeePaymentRequests", allowedUserIds),
  ]);

  const toItem = (
    d: QueryDoc,
    opts?: { topLevelUserIdField?: boolean }
  ): PendingNotificationCountItem => {
    const data = d.data();
    return {
      id: d.id,
      uid: opts?.topLevelUserIdField
        ? String(data.userId || "")
        : uidFromDocPath(d.ref.path),
      status: data.status,
      batchId: String(data.batchId || ""),
      totalLines: Number(data.totalLines || 0),
    };
  };

  return countPendingNotificationItems(allowedUserIds, {
    ship: shipDocs.map((d) => toItem(d)),
    inv: invDocs.map((d) => toItem(d)),
    ret: retDocs.map((d) => toItem(d)),
    dispose: disposeDocs.map((d) => toItem(d)),
    del: deleteDocs.map((d) => toItem(d)),
    quarantine: quarantineDocs.map((d) => toItem(d, { topLevelUserIdField: true })),
    labelRefund: labelDocs.map((d) => toItem(d)),
    inboundBatches: inboundBatchDocs.map((d) => toItem(d)),
    disposeBatches: disposeBatchDocs.map((d) => toItem(d)),
    wallet: walletTopupDocs.map((d) => toItem(d)),
    apiFee: apiFeeDocs.map((d) => toItem(d)),
  });
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

const EMPTY_FINANCE: AdminDashboardFinanceMetrics = {
  billedInRange: 0,
  paidInRange: 0,
  dueInRange: 0,
  todayPaidRevenue: 0,
  todayPaidCount: 0,
  topClientsByRevenue: [],
  pendingInvoicesCount: 0,
  pendingInvoicesAmount: 0,
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

  const [pendingRequestsCount, todayActivity, financial] = await Promise.all([
    countPendingRequests(allowedUserIds),
    countTodayActivity(allowedUserIds),
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
    pendingInvoicesCount: financial.pendingInvoicesCount,
    pendingInvoicesAmount: financial.pendingInvoicesAmount,
    ordersShippedToday: todayActivity.ordersShippedToday,
    receivedUnitsToday: todayActivity.receivedUnitsToday,
    financial,
  };
}
