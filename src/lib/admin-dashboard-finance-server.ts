import { adminDb } from "@/lib/firebase-admin";
import { pickInvoiceDateMs } from "@/lib/admin-reports-utils";
import { getSubAdminManagedUserIds } from "@/lib/permissions";
import type { Invoice, UserProfile } from "@/types";

export type AdminDashboardFinanceMetrics = {
  billedInRange: number;
  paidInRange: number;
  dueInRange: number;
  todayPaidRevenue: number;
  todayPaidCount: number;
  topClientsByRevenue: Array<{ user: string; count: number; fill: string }>;
};

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
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

function invoiceDateMs(inv: Invoice): number {
  return pickInvoiceDateMs(inv as unknown as Record<string, unknown>);
}

function paidAtMs(inv: Invoice): number {
  if (inv.paidAt) return toMs(inv.paidAt);
  return invoiceDateMs(inv);
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

export async function buildAdminDashboardFinanceMetrics(input: {
  callerUid: string;
  from?: Date;
  to?: Date;
  allTime?: boolean;
  topClientsDays?: number;
}): Promise<AdminDashboardFinanceMetrics> {
  const userIds = await resolveClientUserIds(input.callerUid);
  const allTime = input.allTime ?? !(input.from && input.to);
  const rangeFrom = allTime
    ? new Date(0)
    : startOfDay(input.from!);
  const rangeTo = allTime ? new Date() : endOfDay(input.to!);
  const rangeFromMs = rangeFrom.getTime();
  const rangeToMs = rangeTo.getTime();

  const todayStart = startOfDay(new Date()).getTime();
  const todayEnd = endOfDay(new Date()).getTime();

  const topWindowFrom = allTime
    ? new Date(Date.now() - (input.topClientsDays ?? 30) * 86400000)
    : rangeFrom;
  const topWindowTo = allTime ? new Date() : rangeTo;

  const usersSnap = await adminDb().collection("users").get();
  const nameByUid = new Map<string, string>();
  usersSnap.docs.forEach((d) => {
    const data = d.data();
    nameByUid.set(d.id, String(data.name || data.email || "User"));
  });

  let billedInRange = 0;
  let paidInRange = 0;
  let dueInRange = 0;
  let todayPaidRevenue = 0;
  let todayPaidCount = 0;
  const userRevenueInWindow = new Map<string, number>();

  const batches = await Promise.all(
    userIds.map(async (userId) => {
      const snap = await adminDb().collection(`users/${userId}/invoices`).get();
      return { userId, invoices: snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Invoice) })) };
    })
  );

  for (const batch of batches) {
    const displayName = nameByUid.get(batch.userId) || "User";
    let userRevenue = 0;

    for (const inv of batch.invoices) {
      const amount = Number(inv.grandTotal || 0);
      const status = String(inv.status || "").toLowerCase();
      const dMs = invoiceDateMs(inv);
      const inFinancialRange = allTime || (dMs >= rangeFromMs && dMs <= rangeToMs);

      if (inFinancialRange) {
        billedInRange += amount;
        if (status === "paid") paidInRange += amount;
        if (status === "pending") dueInRange += amount;
      }

      if (status === "paid") {
        const paidMs = paidAtMs(inv);
        if (paidMs >= todayStart && paidMs <= todayEnd) {
          todayPaidRevenue += amount;
          todayPaidCount += 1;
        }
      }

      if (dMs >= topWindowFrom.getTime() && dMs <= topWindowTo.getTime()) {
        userRevenue += amount;
      }
    }

    if (userRevenue > 0) {
      userRevenueInWindow.set(displayName, (userRevenueInWindow.get(displayName) ?? 0) + userRevenue);
    }
  }

  const topClientsByRevenue = Array.from(userRevenueInWindow.entries())
    .map(([user, revenue]) => ({ user, count: revenue, fill: "#06b6d4" }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return {
    billedInRange,
    paidInRange,
    dueInRange,
    todayPaidRevenue,
    todayPaidCount,
    topClientsByRevenue,
  };
}
