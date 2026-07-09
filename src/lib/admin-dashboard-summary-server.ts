import { adminDb } from "@/lib/firebase-admin";
import { pickInvoiceDateMs } from "@/lib/admin-reports-utils";
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

function normStatus(v: unknown): string {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

const PENDING_SHIP_STATUSES = new Set(["pending"]);
const PENDING_INV_REQ_STATUSES = new Set(["pending"]);
const PENDING_RETURN_STATUSES = new Set(["pending", "approved", "in_progress"]);

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

async function countPendingRequestsForUser(userId: string): Promise<number> {
  const db = adminDb();
  const [shipSnap, invSnap, retSnap] = await Promise.all([
    db.collection(`users/${userId}/shipmentRequests`).get(),
    db.collection(`users/${userId}/inventoryRequests`).get(),
    db.collection(`users/${userId}/productReturns`).get(),
  ]);

  let count = 0;
  for (const doc of shipSnap.docs) {
    if (PENDING_SHIP_STATUSES.has(normStatus(doc.data().status))) count += 1;
  }
  for (const doc of invSnap.docs) {
    if (PENDING_INV_REQ_STATUSES.has(normStatus(doc.data().status))) count += 1;
  }
  for (const doc of retSnap.docs) {
    if (PENDING_RETURN_STATUSES.has(normStatus(doc.data().status))) count += 1;
  }
  return count;
}

async function countTodayActivityForUser(
  userId: string,
  todayStart: number,
  todayEnd: number
): Promise<{ shipped: number; received: number }> {
  const db = adminDb();
  const [shippedSnap, inventorySnap] = await Promise.all([
    db.collection(`users/${userId}/shipped`).get(),
    db.collection(`users/${userId}/inventory`).get(),
  ]);

  let shipped = 0;
  for (const doc of shippedSnap.docs) {
    const ms = toMs(doc.data().date);
    if (ms >= todayStart && ms <= todayEnd) shipped += 1;
  }

  let received = 0;
  for (const doc of inventorySnap.docs) {
    const data = doc.data();
    const ms = toMs(data.receivingDate) || toMs(data.dateAdded);
    if (ms >= todayStart && ms <= todayEnd) {
      received += Number(data.quantity) || 0;
    }
  }

  return { shipped, received };
}

async function countTodayActivity(userIds: string[]): Promise<{
  ordersShippedToday: number;
  receivedUnitsToday: number;
}> {
  const todayStart = startOfDay(new Date()).getTime();
  const todayEnd = endOfDay(new Date()).getTime();

  const rows = await Promise.all(
    userIds.map((uid) => countTodayActivityForUser(uid, todayStart, todayEnd))
  );

  return {
    ordersShippedToday: rows.reduce((s, r) => s + r.shipped, 0),
    receivedUnitsToday: rows.reduce((s, r) => s + r.received, 0),
  };
}

async function countAllTimePendingInvoices(userIds: string[]): Promise<{
  pendingInvoicesCount: number;
  pendingInvoicesAmount: number;
}> {
  const batches = await Promise.all(
    userIds.map(async (userId) => {
      const snap = await adminDb().collection(`users/${userId}/invoices`).get();
      return snap.docs.map((doc) => doc.data() as Invoice);
    })
  );

  let pendingInvoicesCount = 0;
  let pendingInvoicesAmount = 0;
  for (const invoices of batches) {
    for (const inv of invoices) {
      if (String(inv.status || "").toLowerCase() !== "pending") continue;
      pendingInvoicesCount += 1;
      pendingInvoicesAmount += Number(inv.grandTotal || 0);
    }
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
  const allTime = input.allTime ?? !(input.from && input.to);

  const [pendingRequestsPerUser, todayActivity, pendingInvoices, financial] = await Promise.all([
    Promise.all(userIds.map((uid) => countPendingRequestsForUser(uid))),
    countTodayActivity(userIds),
    countAllTimePendingInvoices(userIds),
    buildAdminDashboardFinanceMetrics({
      callerUid: input.callerUid,
      from: allTime ? undefined : input.from,
      to: allTime ? undefined : input.to,
      allTime,
      topClientsDays: input.topClientsDays,
    }),
  ]);

  return {
    pendingRequestsCount: pendingRequestsPerUser.reduce((a, b) => a + b, 0),
    pendingInvoicesCount: pendingInvoices.pendingInvoicesCount,
    pendingInvoicesAmount: pendingInvoices.pendingInvoicesAmount,
    ordersShippedToday: todayActivity.ordersShippedToday,
    receivedUnitsToday: todayActivity.receivedUnitsToday,
    financial,
  };
}
