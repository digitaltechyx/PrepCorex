"use client";

import { useCallback, useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import type { AdminDashboardFinanceMetrics } from "@/lib/admin-dashboard-finance-server";
import type { AdminDashboardSummary } from "@/lib/admin-dashboard-summary-server";

const EMPTY_FINANCE: AdminDashboardFinanceMetrics = {
  billedInRange: 0,
  paidInRange: 0,
  dueInRange: 0,
  todayPaidRevenue: 0,
  todayPaidCount: 0,
  topClientsByRevenue: [],
};

const EMPTY_SUMMARY: AdminDashboardSummary = {
  pendingRequestsCount: 0,
  pendingInvoicesCount: 0,
  pendingInvoicesAmount: 0,
  ordersShippedToday: 0,
  receivedUnitsToday: 0,
  financial: EMPTY_FINANCE,
};

export function useAdminDashboardSummary(input: {
  adminUid: string | undefined;
  dateRangeFrom?: Date;
  dateRangeTo?: Date;
  hasDateRange: boolean;
  topClientsDays: number;
  enabled?: boolean;
}) {
  const [summary, setSummary] = useState<AdminDashboardSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!input.enabled || !input.adminUid) {
      setSummary(EMPTY_SUMMARY);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated");

      const params = new URLSearchParams();
      if (input.hasDateRange && input.dateRangeFrom && input.dateRangeTo) {
        params.set("from", input.dateRangeFrom.toISOString());
        params.set("to", input.dateRangeTo.toISOString());
      }
      params.set("topClientsDays", String(input.topClientsDays));

      const res = await fetch(`/api/admin/dashboard/summary?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to load dashboard");
      }
      const data = (await res.json()) as AdminDashboardSummary;
      setSummary(data);
    } catch {
      setSummary(EMPTY_SUMMARY);
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
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!input.enabled || !input.adminUid) return;

    const interval = setInterval(() => void refresh(), 45000);
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [input.enabled, input.adminUid, refresh]);

  return {
    pendingRequestsCount: summary.pendingRequestsCount,
    pendingInvoicesCount: summary.pendingInvoicesCount,
    pendingInvoicesAmount: summary.pendingInvoicesAmount,
    ordersShippedToday: summary.ordersShippedToday,
    receivedUnitsToday: summary.receivedUnitsToday,
    financialMetrics: summary.financial,
    topClientsByRevenue: summary.financial.topClientsByRevenue,
    loading,
    refresh,
  };
}
