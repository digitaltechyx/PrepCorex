"use client";

import { useCallback, useEffect, useState } from "react";
import { collectionGroup, onSnapshot, query, where } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { AdminDashboardFinanceMetrics } from "@/lib/admin-dashboard-finance-server";

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

function uidFromPath(path: string): string {
  return path.split("/")[1] || "";
}

function isAllowedUser(
  path: string,
  adminUid: string | undefined,
  managedIds: Set<string> | null
): boolean {
  const userId = uidFromPath(path);
  if (!userId || userId === adminUid) return false;
  if (managedIds !== null && !managedIds.has(userId)) return false;
  return true;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

const EMPTY_METRICS: AdminDashboardFinanceMetrics = {
  billedInRange: 0,
  paidInRange: 0,
  dueInRange: 0,
  todayPaidRevenue: 0,
  todayPaidCount: 0,
  topClientsByRevenue: [],
};

export function useAdminDashboardFinance(input: {
  adminUid: string | undefined;
  managedUserIds: string[] | null;
  dateRangeFrom?: Date;
  dateRangeTo?: Date;
  hasDateRange: boolean;
  topClientsDays: number;
  pendingInvoicesAmount: number;
  enabled?: boolean;
}) {
  const [metrics, setMetrics] = useState<AdminDashboardFinanceMetrics>(EMPTY_METRICS);
  const [loading, setLoading] = useState(true);

  const managedIds =
    input.managedUserIds === null ? null : new Set(input.managedUserIds);

  const fetchRangeMetrics = useCallback(async () => {
    if (!input.enabled || !input.adminUid) {
      setMetrics(EMPTY_METRICS);
      setLoading(false);
      return;
    }

    if (!input.hasDateRange) {
      return;
    }

    setLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated");

      const params = new URLSearchParams();
      if (input.dateRangeFrom) params.set("from", input.dateRangeFrom.toISOString());
      if (input.dateRangeTo) params.set("to", input.dateRangeTo.toISOString());
      params.set("topClientsDays", String(input.topClientsDays));

      const res = await fetch(`/api/admin/dashboard/finance?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load finance metrics");
      const data = (await res.json()) as AdminDashboardFinanceMetrics;
      setMetrics(data);
    } catch {
      setMetrics(EMPTY_METRICS);
    } finally {
      setLoading(false);
    }
  }, [
    input.enabled,
    input.adminUid,
    input.hasDateRange,
    input.dateRangeFrom,
    input.dateRangeTo,
    input.topClientsDays,
  ]);

  useEffect(() => {
    if (!input.enabled || !input.adminUid) {
      setMetrics(EMPTY_METRICS);
      setLoading(false);
      return;
    }

    if (input.hasDateRange) {
      void fetchRangeMetrics();
      return;
    }

    setLoading(true);
    let paidTotal = 0;
    let paidTodayRevenue = 0;
    let paidTodayCount = 0;
    const todayStart = startOfDay(new Date()).getTime();
    const todayEnd = endOfDay(new Date()).getTime();

    const paidQ = query(
      collectionGroup(db, "invoices"),
      where("status", "in", ["paid", "Paid"])
    );

    const unsub = onSnapshot(
      paidQ,
      (snap) => {
        paidTotal = 0;
        paidTodayRevenue = 0;
        paidTodayCount = 0;

        for (const doc of snap.docs) {
          if (!isAllowedUser(doc.ref.path, input.adminUid, managedIds)) continue;
          const data = doc.data();
          const amount = Number(data.grandTotal || 0);
          paidTotal += amount;

          const paidMs = toMs(data.paidAt) || toMs(data.issuedAt) || toMs(data.date) || toMs(data.createdAt);
          if (paidMs >= todayStart && paidMs <= todayEnd) {
            paidTodayRevenue += amount;
            paidTodayCount += 1;
          }
        }

        const pendingAmount = input.pendingInvoicesAmount;
        setMetrics({
          billedInRange: paidTotal + pendingAmount,
          paidInRange: paidTotal,
          dueInRange: pendingAmount,
          todayPaidRevenue: paidTodayRevenue,
          todayPaidCount: paidTodayCount,
          topClientsByRevenue: [],
        });
        setLoading(false);
      },
      () => {
        setMetrics(EMPTY_METRICS);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [
    input.enabled,
    input.adminUid,
    input.hasDateRange,
    input.pendingInvoicesAmount,
    managedIds,
    fetchRangeMetrics,
  ]);

  useEffect(() => {
    if (!input.enabled || !input.adminUid || input.hasDateRange) return;

    let cancelled = false;
    const loadTopClients = async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token || cancelled) return;

        const params = new URLSearchParams({
          topClientsDays: String(input.topClientsDays),
          topClientsOnly: "true",
        });
        const res = await fetch(`/api/admin/dashboard/finance?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as AdminDashboardFinanceMetrics;
        setMetrics((prev) => ({ ...prev, topClientsByRevenue: data.topClientsByRevenue }));
      } catch {
        // keep chart empty on failure
      }
    };

    void loadTopClients();
    return () => {
      cancelled = true;
    };
  }, [input.enabled, input.adminUid, input.hasDateRange, input.topClientsDays]);

  return { metrics, loading, refreshRangeMetrics: fetchRangeMetrics };
}
