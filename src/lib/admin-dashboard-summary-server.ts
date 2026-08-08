import { adminDb } from "@/lib/firebase-admin";
import { getSubAdminManagedUserIds } from "@/lib/permissions";
import type { Invoice, UserProfile } from "@/types";
import { buildAdminDashboardFinanceMetrics, type AdminDashboardFinanceMetrics } from "@/lib/admin-dashboard-finance-server";

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
  // users/{uid}/collection/{id}
  const parts = path.split("/");
  return parts[0] === "users" ? parts[1] || "" : "";
}

async function resolveClientUserIds(callerUid: string): Promise<string[]> {
  const usersSnap = await adminDb().collection("users").get();
  const users = usersSnap.docs.map((d) => ({ ...(d.data() as UserProfile), uid: d.id }));
  const caller = users.find((u) => u.uid === callerUid);
  const managedIds = getSubAdminManagedUserIds(caller, users);

  return users
    .filter((u) => {
      if (!u.uid || u.uid === callerUid) return false;
      if (u.status === "deleted") return false;
      const role = String(u.role || "").toLowerCase();
      if (role === "admin" || role === "sub_admin") return false;
      if (managedIds !== null && !managedIds.includes(u.uid)) return false;
      return true;
    })
    .map((u) => u.uid!)
    .filter(Boolean);
}

/** Pending docs under users/{uid}/… via collectionGroup (status pending only). */
async function countPendingCollectionGroup(
  collectionId: string,
  allowedUserIds: Set<string>
) {
  const snap = await adminDb()
    .collectionGroup(collectionId)
    .where("status", "in", ["pending", "Pending"])
    .get();
  return snap.docs.filter((d) => allowedUserIds.has(uidFromDocPath(d.ref.path)));
}

/**
 * Fast pending count for Notifications types (pending only).
 * Uses collectionGroup queries instead of loading every user subcollection.
 */
async function countPendingRequests(allowedUserIds: Set<string>): Promise<number> {
  const db = adminDb();

  const [
    shipDocs,
    invDocs,
    retDocs,
    disposeDocs,
    deleteDocs,
    labelDocs,
    inboundBatchDocs,
    disposeBatchDocs,
    quarantineSnap,
  ] = await Promise.all([
    countPendingCollectionGroup("shipmentRequests", allowedUserIds),
    countPendingCollectionGroup("inventoryRequests", allowedUserIds),
    countPendingCollectionGroup("productReturns", allowedUserIds),
    countPendingCollectionGroup("disposeRequests", allowedUserIds),
    countPendingCollectionGroup("deleteRequests", allowedUserIds),
    countPendingCollectionGroup("labelRefundRequests", allowedUserIds),
    countPendingCollectionGroup("inboundBatches", allowedUserIds),
    countPendingCollectionGroup("disposeBatches", allowedUserIds),
    db.collection("quarantineRequests").where("status", "in", ["pending", "Pending"]).get(),
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

  for (const d of quarantineSnap.docs) {
    if (allowedUserIds.has(String(d.data().userId || ""))) count += 1;
  }

  return count;
}

async function countTodayActivity(allowedUserIds: Set<string>): Promise<{
  ordersShippedToday: number;
  receivedUnitsToday: number;
}> {
  const todayStart = startOfDay(new Date()).getTime();
  const todayEnd = endOfDay(new Date()).getTime();
  const db = adminDb();

  // Prefer bounded queries when date fields are Timestamps; fall back to scan filter.
  const [shippedSnap, inventorySnap] = await Promise.all([
    db.collectionGroup("shipped").get(),
    db.collectionGroup("inventory").get(),
  ]);

  let ordersShippedToday = 0;
  for (const doc of shippedSnap.docs) {
    if (!allowedUserIds.has(uidFromDocPath(doc.ref.path))) continue;
    const ms = toMs(doc.data().date);
    if (ms >= todayStart && ms <= todayEnd) ordersShippedToday += 1;
  }

  let receivedUnitsToday = 0;
  for (const doc of inventorySnap.docs) {
    if (!allowedUserIds.has(uidFromDocPath(doc.ref.path))) continue;
    const data = doc.data();
    const ms = toMs(data.receivingDate) || toMs(data.dateAdded);
    if (ms >= todayStart && ms <= todayEnd) {
      receivedUnitsToday += Number(data.quantity) || 0;
    }
  }

  return { ordersShippedToday, receivedUnitsToday };
}

async function countAllTimePendingInvoices(allowedUserIds: Set<string>): Promise<{
  pendingInvoicesCount: number;
  pendingInvoicesAmount: number;
}> {
  const snap = await adminDb()
    .collectionGroup("invoices")
    .where("status", "in", ["pending", "Pending"])
    .get();

  let pendingInvoicesCount = 0;
  let pendingInvoicesAmount = 0;
  for (const doc of snap.docs) {
    if (!allowedUserIds.has(uidFromDocPath(doc.ref.path))) continue;
    const inv = doc.data() as Invoice;
    pendingInvoicesCount += 1;
    pendingInvoicesAmount += Number(inv.grandTotal || 0);
  }

  return { pendingInvoicesCount, pendingInvoicesAmount };
}

export async function buildAdminDashboardSummary(input: {
  callerUid: string;
  from?: Date;
  to?: Date;
  allTime?: boolean;
  topClientsDays?: number;
}): Promise<AdminDashboardSummary> {
  const userIds = await resolveClientUserIds(input.callerUid);
  const allowedUserIds = new Set(userIds);
  const allTime = input.allTime ?? !(input.from && input.to);

  const [pendingRequestsCount, todayActivity, pendingInvoices, financial] = await Promise.all([
    countPendingRequests(allowedUserIds),
    countTodayActivity(allowedUserIds),
    countAllTimePendingInvoices(allowedUserIds),
    buildAdminDashboardFinanceMetrics({
      callerUid: input.callerUid,
      from: allTime ? undefined : input.from,
      to: allTime ? undefined : input.to,
      allTime,
      topClientsDays: input.topClientsDays,
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
