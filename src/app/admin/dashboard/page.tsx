"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import { useManagedUsers } from "@/hooks/use-managed-users";
import type { UserProfile } from "@/types";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Users,
  Shield,
  Receipt,
  Bell,
  Truck,
  PackageCheck,
  TrendingUp,
  BarChart3,
  PieChart as PieChartIcon,
  Calendar,
  PlugZap,
  AlertTriangle,
  Wallet,
  DollarSign,
  ArrowRight,
  CheckCircle,
  XCircle,
  Loader2,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { collection, collectionGroup, getCountFromServer, getDocs, onSnapshot, query, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAdminDashboardSummary } from "@/hooks/use-admin-dashboard-summary";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Area, AreaChart, Bar, BarChart, Pie, PieChart, CartesianGrid, XAxis, YAxis, Cell } from "recharts";
import { cn } from "@/lib/utils";

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

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
function isDateInRange(date: Date | null, from?: Date, to?: Date): boolean {
  if (!date) return false;
  if (!from && !to) return true;
  const t = date.getTime();
  if (from && t < startOfDay(from).getTime()) return false;
  if (to && t > endOfDay(to).getTime()) return false;
  return true;
}

type ShippedDoc = { date?: unknown; shippedQty?: number; items?: Array<{ shippedQty?: number; quantity?: number }> };
type InventoryDoc = { dateAdded?: unknown; receivingDate?: unknown; quantity?: number };
type RequestDoc = { status?: string; requestedAt?: unknown; date?: unknown };

const CHART_COLLECTION_LIMIT = 400;

function aggregateChartData(
  shippedDocs: Array<{ ref: { path: string }; data: () => ShippedDoc }>,
  inventoryDocs: Array<{ ref: { path: string }; data: () => InventoryDoc }>,
  shipReqDocs: Array<{ ref: { path: string }; data: () => RequestDoc }>,
  invReqDocs: Array<{ ref: { path: string }; data: () => RequestDoc }>,
  returnsDocs: Array<{ ref: { path: string }; data: () => RequestDoc }>,
  disposeDocs: Array<{ ref: { path: string }; data: () => RequestDoc }>,
  start: Date,
  end: Date,
  adminUid: string,
  users: UserProfile[],
  allowedUserIds: Set<string> | null
): typeof initialChartData {
  const buckets = new Map<string, { label: string; shipped: number; added: number; returns: number; disposed: number }>();
  const requestBuckets = new Map<string, { label: string; total: number }>();
  for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
    const d = new Date(t);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, { label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }), shipped: 0, added: 0, returns: 0, disposed: 0 });
    requestBuckets.set(key, { label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }), total: 0 });
  }
  const requestTypeCounts = { Shipment: 0, Inventory: 0, Returns: 0, Dispose: 0 };
  const statusCounts = { Pending: 0, Processing: 0, Shipped: 0, Rejected: 0 };
  const userRequestCounts = new Map<string, number>();
  let shippedOrderCount = 0;
  const recentList: Array<{ id: string; type: string; userName: string; date: string; status: string; ms: number }> = [];

  const uidFromPath = (path: string) => path.split("/")[1] || "";
  const userName = (uid: string) => users?.find((u) => u.uid === uid)?.name || users?.find((u) => u.uid === uid)?.email || "User";
  const allowed = (uid: string) => !allowedUserIds || allowedUserIds.has(uid);

  shippedDocs.forEach((doc) => {
    const uid = uidFromPath(doc.ref.path);
    if (uid === adminUid || !allowed(uid)) return;
    const data = doc.data();
    const date = new Date(toMs(data?.date));
    if (!isDateInRange(date, start, end)) return;
    shippedOrderCount += 1;
    const key = date.toISOString().slice(0, 10);
    const bucket = buckets.get(key);
    if (bucket) {
      const qty = Number(data?.shippedQty ?? 0) || (Array.isArray(data?.items) ? data.items.reduce((s, i) => s + (Number(i?.shippedQty ?? i?.quantity) || 0), 0) : 0);
      bucket.shipped += Number.isFinite(qty) ? qty : 0;
    }
  });
  inventoryDocs.forEach((doc) => {
    const uid = uidFromPath(doc.ref.path);
    if (uid === adminUid || !allowed(uid)) return;
    const data = doc.data();
    const date = new Date(toMs(data?.receivingDate) || toMs(data?.dateAdded));
    if (!isDateInRange(date, start, end)) return;
    const key = date.toISOString().slice(0, 10);
    const bucket = buckets.get(key);
    if (bucket) bucket.added += Number(data?.quantity) || 0;
  });

  [shipReqDocs, invReqDocs].forEach((docs, idx) => {
    const type = idx === 0 ? "Shipment" : "Inventory";
    docs.forEach((doc) => {
      const uid = uidFromPath(doc.ref.path);
      if (uid === adminUid || !allowed(uid)) return;
      const data = doc.data();
      requestTypeCounts[type as "Shipment" | "Inventory"] += 1;
      const status = (data?.status || "").toLowerCase();
      if (status === "pending") statusCounts.Pending += 1;
      else if (status === "rejected") statusCounts.Rejected += 1;
      else statusCounts.Processing += 1;
      const ms = toMs(data?.requestedAt || data?.date);
      if (isDateInRange(new Date(ms), start, end)) {
        recentList.push({ id: doc.ref.path, type, userName: userName(uid), date: new Date(ms).toLocaleDateString(), status: data?.status || "—", ms });
        const key = new Date(ms).toISOString().slice(0, 10);
        const bucket = requestBuckets.get(key);
        if (bucket) bucket.total += 1;
        userRequestCounts.set(userName(uid), (userRequestCounts.get(userName(uid)) || 0) + 1);
      }
    });
  });
  returnsDocs.forEach((doc) => {
    const uid = uidFromPath(doc.ref.path);
    if (uid === adminUid || !allowed(uid)) return;
    requestTypeCounts.Returns += 1;
    const data = doc.data();
    const status = (data?.status || "").toLowerCase();
    if (status === "pending") statusCounts.Pending += 1;
    else if (status === "rejected") statusCounts.Rejected += 1;
    else statusCounts.Processing += 1;
    const ms = toMs(data?.requestedAt || data?.date);
    if (isDateInRange(new Date(ms), start, end)) {
      const key = new Date(ms).toISOString().slice(0, 10);
      const tBucket = buckets.get(key);
      if (tBucket) tBucket.returns += 1;
      const b = requestBuckets.get(key);
      if (b) b.total += 1;
      userRequestCounts.set(userName(uid), (userRequestCounts.get(userName(uid)) || 0) + 1);
    }
  });
  disposeDocs.forEach((doc) => {
    const uid = uidFromPath(doc.ref.path);
    if (uid === adminUid || !allowed(uid)) return;
    requestTypeCounts.Dispose += 1;
    const data = doc.data();
    const status = (data?.status || "").toLowerCase();
    if (status === "pending") statusCounts.Pending += 1;
    else if (status === "rejected") statusCounts.Rejected += 1;
    else statusCounts.Processing += 1;
    const ms = toMs(data?.requestedAt || data?.date);
    if (isDateInRange(new Date(ms), start, end)) {
      const key = new Date(ms).toISOString().slice(0, 10);
      const tBucket = buckets.get(key);
      if (tBucket) tBucket.disposed += 1;
      const b = requestBuckets.get(key);
      if (b) b.total += 1;
      userRequestCounts.set(userName(uid), (userRequestCounts.get(userName(uid)) || 0) + 1);
    }
  });

  statusCounts.Shipped = shippedOrderCount;
  const trend = Array.from(buckets.values());
  const requestTrend = Array.from(requestBuckets.values());
  const requestTypes = [
    { type: "Shipment", count: requestTypeCounts.Shipment, fill: "var(--color-shipment)" },
    { type: "Inventory", count: requestTypeCounts.Inventory, fill: "var(--color-inventory)" },
    { type: "Returns", count: requestTypeCounts.Returns, fill: "var(--color-returns)" },
    { type: "Dispose", count: requestTypeCounts.Dispose, fill: "var(--color-dispose)" },
  ];
  const statusDonut = [
    { name: "Pending", value: statusCounts.Pending, fill: "#f59e0b" },
    { name: "Processing", value: statusCounts.Processing, fill: "#3b82f6" },
    { name: "Shipped", value: statusCounts.Shipped, fill: "#22c55e" },
    { name: "Rejected", value: statusCounts.Rejected, fill: "#ef4444" },
  ].filter((d) => d.value > 0);
  const topUsers = Array.from(userRequestCounts.entries())
    .map(([user, count]) => ({ user, count, fill: "#06b6d4" }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  recentList.sort((a, b) => b.ms - a.ms);
  const recentActivity = recentList.slice(0, 10).map(({ id, type, userName, date, status }) => ({ id, type, userName, date, status }));

  return {
    trend,
    requestTrend,
    requestTypes,
    statusDonut: statusDonut.length ? statusDonut : [{ name: "No data", value: 1, fill: "#94a3b8" }],
    topUsers,
    recentActivity,
  };
}

const initialChartData = { trend: [] as Array<{ label: string; shipped: number; added: number; returns: number; disposed: number }>, requestTrend: [], requestTypes: [], statusDonut: [{ name: "No data", value: 1, fill: "#94a3b8" }], topUsers: [], recentActivity: [] };

export default function AdminDashboardPage() {
  const { userProfile: adminUser } = useAuth();
  const { managedUsers: users, managedUserIds, loading: usersLoading } = useManagedUsers();

  const [dateRangeFrom, setDateRangeFrom] = useState<Date | undefined>();
  const [dateRangeTo, setDateRangeTo] = useState<Date | undefined>();
  const [trendRange, setTrendRange] = useState<7 | 14 | 30>(30);
  const [requestTrendRange, setRequestTrendRange] = useState<7 | 14 | 30>(30);
  const [topUsersRange, setTopUsersRange] = useState<7 | 14 | 30>(30);
  const [requestTypesRange, setRequestTypesRange] = useState<7 | 14 | 30>(30);
  const hasDateRange = Boolean(dateRangeFrom && dateRangeTo);

  const activeUsersCount = useMemo(() => {
    if (!users || !adminUser?.uid) return 0;
    return users.filter(
      (user) =>
        user.uid !== adminUser.uid &&
        (user.status === "approved" || !user.status) &&
        user.status !== "deleted"
  ).length;
  }, [users, adminUser]);
  
  const pendingUsersCount = useMemo(() => {
    if (!users || !adminUser?.uid) return 0;
    return users.filter((user) => user.uid !== adminUser.uid && user.status === "pending").length;
  }, [users, adminUser]);

  const managedIdsSet = useMemo(() => (managedUserIds === null ? null : new Set(managedUserIds)), [managedUserIds]);

  const {
    pendingRequestsCount,
    pendingInvoicesCount,
    pendingInvoicesAmount,
    ordersShippedToday,
    receivedUnitsToday,
    financialMetrics,
    topClientsByRevenue,
    loading: dashboardSummaryLoading,
  } = useAdminDashboardSummary({
    adminUid: adminUser?.uid,
    dateRangeFrom,
    dateRangeTo,
    hasDateRange,
    topClientsDays: topUsersRange,
    enabled: Boolean(users?.length && adminUser?.uid),
  });

  const requestsLoading = dashboardSummaryLoading;
  const kpiInvoicesLoading = dashboardSummaryLoading;
  const shippedAndReceivedLoading = dashboardSummaryLoading;
  const financeLoading = dashboardSummaryLoading;
  const [integrationStats, setIntegrationStats] = useState({
    shopify: 0,
    ebay: 0,
  });
  const [integrationLoading, setIntegrationLoading] = useState(true);
  const [oneDriveConnected, setOneDriveConnected] = useState<boolean | null>(null);
  const [oneDriveChecking, setOneDriveChecking] = useState(true);
  const [oneDriveDisconnecting, setOneDriveDisconnecting] = useState(false);

  useEffect(() => {
    const run = async () => {
      try {
        setIntegrationLoading(true);
        const [shopifySnap, ebaySnap] = await Promise.all([
          getCountFromServer(collectionGroup(db, "shopifyConnections")),
          getCountFromServer(collectionGroup(db, "ebayConnections")),
        ]);
        setIntegrationStats({
          shopify: shopifySnap.data().count || 0,
          ebay: ebaySnap.data().count || 0,
        });
      } catch {
        setIntegrationStats({ shopify: 0, ebay: 0 });
      } finally {
        setIntegrationLoading(false);
      }
    };
    run();
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/onedrive/token")
      .then((res) => {
        if (cancelled) return;
        setOneDriveConnected(res.ok);
      })
      .catch(() => {
        if (!cancelled) setOneDriveConnected(false);
      })
      .finally(() => {
        if (!cancelled) setOneDriveChecking(false);
      });
    return () => { cancelled = true; };
  }, []);

  const [chartData, setChartData] = useState<{
    trend: Array<{ label: string; shipped: number; added: number; returns: number; disposed: number }>;
    requestTrend: Array<{ label: string; total: number }>;
    requestTypes: Array<{ type: string; count: number; fill: string }>;
    statusDonut: Array<{ name: string; value: number; fill: string }>;
    topUsers: Array<{ user: string; count: number; fill: string }>;
    recentActivity: Array<{ id: string; type: string; userName: string; date: string; status: string }>;
  }>({ trend: [], requestTrend: [], requestTypes: [], statusDonut: [], topUsers: [], recentActivity: [] });
  const [chartLoading, setChartLoading] = useState(true);

  const chartRefs = useRef({
    shipped: [] as Array<{ ref: { path: string }; data: () => ShippedDoc }>,
    inventory: [] as Array<{ ref: { path: string }; data: () => InventoryDoc }>,
    shipReq: [] as Array<{ ref: { path: string }; data: () => RequestDoc }>,
    invReq: [] as Array<{ ref: { path: string }; data: () => RequestDoc }>,
    returns: [] as Array<{ ref: { path: string }; data: () => RequestDoc }>,
    dispose: [] as Array<{ ref: { path: string }; data: () => RequestDoc }>,
  });
  const rangeRef = useRef({ trendRange, requestTrendRange, topUsersRange, requestTypesRange });
  const runAggregateRef = useRef<() => void>(() => {});
  const hasChartDataRef = useRef(false);

  useEffect(() => {
    rangeRef.current = { trendRange, requestTrendRange, topUsersRange, requestTypesRange };
  }, [trendRange, requestTrendRange, topUsersRange, requestTypesRange]);

  useEffect(() => {
    hasChartDataRef.current = false;
    if (!adminUser?.uid || !users?.length) {
      setChartData({ trend: [], requestTrend: [], requestTypes: [], statusDonut: [], topUsers: [], recentActivity: [] });
      setChartLoading(false);
      return;
    }
    const adminUid = adminUser.uid;
    const getStartEnd = (range: 7 | 14 | 30) => {
      if (hasDateRange && dateRangeFrom && dateRangeTo) {
        return { start: startOfDay(dateRangeFrom), end: endOfDay(dateRangeTo) };
      }
      return {
        start: new Date(Date.now() - range * 86400000),
        end: new Date(),
      };
    };

    const allowedSet = managedUserIds === null ? null : new Set(managedUserIds);
    const refs = chartRefs.current;
    const runAggregate = () => {
      const r = rangeRef.current;
      const se1 = getStartEnd(r.trendRange);
      const se2 = getStartEnd(r.requestTrendRange);
      const se3 = getStartEnd(r.topUsersRange);
      const se4 = getStartEnd(r.requestTypesRange);
      const r1 = aggregateChartData(refs.shipped, refs.inventory, refs.shipReq, refs.invReq, refs.returns, refs.dispose, se1.start, se1.end, adminUid, users || [], allowedSet);
      const r2 = aggregateChartData(refs.shipped, refs.inventory, refs.shipReq, refs.invReq, refs.returns, refs.dispose, se2.start, se2.end, adminUid, users || [], allowedSet);
      const r3 = aggregateChartData(refs.shipped, refs.inventory, refs.shipReq, refs.invReq, refs.returns, refs.dispose, se3.start, se3.end, adminUid, users || [], allowedSet);
      const r4 = aggregateChartData(refs.shipped, refs.inventory, refs.shipReq, refs.invReq, refs.returns, refs.dispose, se4.start, se4.end, adminUid, users || [], allowedSet);
      setChartData({
        trend: r1.trend,
        requestTrend: r2.requestTrend,
        requestTypes: r3.requestTypes,
        statusDonut: r1.statusDonut,
        topUsers: r4.topUsers,
        recentActivity: r2.recentActivity,
      });
      hasChartDataRef.current = true;
    };
    runAggregateRef.current = runAggregate;

    setChartLoading(true);
    const limitQ = limit(CHART_COLLECTION_LIMIT);
    const qShipped = query(collectionGroup(db, "shipped"), limitQ);
    const qInventory = query(collectionGroup(db, "inventory"), limitQ);
    const qShipReq = query(collectionGroup(db, "shipmentRequests"), limitQ);
    const qInvReq = query(collectionGroup(db, "inventoryRequests"), limitQ);
    const qReturns = query(collectionGroup(db, "productReturns"), limitQ);
    const qDispose = query(collectionGroup(db, "disposeRequests"), limitQ);

    let initialDone = false;
    const maybeInitialDone = () => {
      if (initialDone) return;
      initialDone = true;
      setChartLoading(false);
    };

    Promise.all([
      getDocs(qShipped),
      getDocs(qInventory),
      getDocs(qShipReq),
      getDocs(qInvReq),
      getDocs(qReturns),
      getDocs(qDispose),
    ])
      .then(([a, b, c, d, e, f]) => {
        refs.shipped = a.docs as unknown as typeof refs.shipped;
        refs.inventory = b.docs as unknown as typeof refs.inventory;
        refs.shipReq = c.docs as unknown as typeof refs.shipReq;
        refs.invReq = d.docs as unknown as typeof refs.invReq;
        refs.returns = e.docs as unknown as typeof refs.returns;
        refs.dispose = f.docs as unknown as typeof refs.dispose;
        runAggregate();
        maybeInitialDone();
      })
      .catch(() => {
        setChartData({ trend: [], requestTrend: [], requestTypes: [], statusDonut: [{ name: "No data", value: 1, fill: "#94a3b8" }], topUsers: [], recentActivity: [] });
        maybeInitialDone();
      });

    const unsubShipped = onSnapshot(qShipped, (snap) => {
      refs.shipped = snap.docs as unknown as typeof refs.shipped;
      runAggregate();
      maybeInitialDone();
    }, maybeInitialDone);
    const unsubInventory = onSnapshot(qInventory, (snap) => {
      refs.inventory = snap.docs as unknown as typeof refs.inventory;
      runAggregate();
      maybeInitialDone();
    }, maybeInitialDone);
    const unsubShipReq = onSnapshot(qShipReq, (snap) => {
      refs.shipReq = snap.docs as unknown as typeof refs.shipReq;
      runAggregate();
      maybeInitialDone();
    }, maybeInitialDone);
    const unsubInvReq = onSnapshot(qInvReq, (snap) => {
      refs.invReq = snap.docs as unknown as typeof refs.invReq;
      runAggregate();
      maybeInitialDone();
    }, maybeInitialDone);
    const unsubReturns = onSnapshot(qReturns, (snap) => {
      refs.returns = snap.docs as unknown as typeof refs.returns;
      runAggregate();
      maybeInitialDone();
    }, maybeInitialDone);
    const unsubDispose = onSnapshot(qDispose, (snap) => {
      refs.dispose = snap.docs as unknown as typeof refs.dispose;
      runAggregate();
      maybeInitialDone();
    }, maybeInitialDone);

    return () => {
      unsubShipped();
      unsubInventory();
      unsubShipReq();
      unsubInvReq();
      unsubReturns();
      unsubDispose();
    };
  }, [adminUser?.uid, users, managedUserIds, hasDateRange, dateRangeFrom, dateRangeTo]);

  useEffect(() => {
    if (hasChartDataRef.current) runAggregateRef.current();
  }, [trendRange, requestTrendRange, topUsersRange, requestTypesRange]);

  const trendChartConfig = {
    shipped: { label: "Shipped", color: "#3b82f6" },
    added: { label: "Inventory added", color: "#22c55e" },
    returns: { label: "Returns", color: "#f97316" },
    disposed: { label: "Disposed", color: "#8b5cf6" },
  } satisfies ChartConfig;
  const requestTypesChartConfig = {
    shipment: { label: "Shipment", color: "#2563eb" },
    inventory: { label: "Inventory", color: "#16a34a" },
    returns: { label: "Returns", color: "#ea580c" },
    dispose: { label: "Dispose", color: "#7c3aed" },
  } satisfies ChartConfig;
  const statusChartConfig = {
    pending: { label: "Pending", color: "#f59e0b" },
    processing: { label: "Processing", color: "#3b82f6" },
    shipped: { label: "Shipped", color: "#22c55e" },
    rejected: { label: "Rejected", color: "#ef4444" },
    Pending: { label: "Pending", color: "#f59e0b" },
    Processing: { label: "Processing", color: "#3b82f6" },
    Shipped: { label: "Shipped", color: "#22c55e" },
    Rejected: { label: "Rejected", color: "#ef4444" },
  } satisfies ChartConfig;
  const requestTrendConfig = {
    total: { label: "Requests", color: "#8b5cf6" },
  } satisfies ChartConfig;
  const topClientsConfig = {
    count: { label: "Revenue", color: "#06b6d4" },
  } satisfies ChartConfig;

  const kpiCards = [
    { title: "Pending Users", value: String(pendingUsersCount), hint: "Awaiting approval", icon: Shield, iconBg: "bg-orange-500/10 text-orange-600", href: "/admin/dashboard/users?tab=users&status=pending" },
    { title: "Active Users", value: String(activeUsersCount), hint: "Approved users", icon: Users, iconBg: "bg-emerald-500/10 text-emerald-600", href: "/admin/dashboard/users?tab=users&status=approved" },
    {
      title: "Pending Invoices",
      value: kpiInvoicesLoading ? "…" : String(pendingInvoicesCount),
      hint: kpiInvoicesLoading
        ? "Outstanding…"
        : hasDateRange
          ? `Selected range outstanding $${Number(Math.max(financialMetrics.dueInRange || 0, 0)).toLocaleString("en-US")}`
          : `Outstanding $${Number(pendingInvoicesAmount || 0).toLocaleString("en-US")}`,
      icon: Receipt,
      iconBg: "bg-blue-500/10 text-blue-600",
      href: "/admin/dashboard/invoices?tab=pending",
    },
    { title: "Pending Requests", value: requestsLoading ? "…" : String(pendingRequestsCount), hint: "All request types", icon: Bell, iconBg: "bg-indigo-500/10 text-indigo-600", href: "/admin/dashboard/notifications?tab=pending" },
    {
      title: "Today Shipped Orders",
      value: shippedAndReceivedLoading ? "…" : String(ordersShippedToday),
      hint: "Shipments recorded",
      icon: Truck,
      iconBg: "bg-teal-500/10 text-teal-600",
      href: "/admin/dashboard/notifications?type=shipment_request&user=all&period=today",
    },
    {
      title: "Today Received Inventory",
      value: shippedAndReceivedLoading ? "…" : String(receivedUnitsToday),
      hint: "Units added",
      icon: PackageCheck,
      iconBg: "bg-amber-500/10 text-amber-600",
      href: "/admin/dashboard/notifications?type=inventory_request&user=all&period=today",
    },
  ];
  const collectionRate = financialMetrics.billedInRange > 0
    ? Math.round((financialMetrics.paidInRange / financialMetrics.billedInRange) * 100)
    : 0;
  const dueAmount = Math.max(financialMetrics.dueInRange || 0, 0);
  const todayRevenueAvg = financialMetrics.todayPaidCount > 0
    ? financialMetrics.todayPaidRevenue / financialMetrics.todayPaidCount
    : 0;
  const integrationHealth = integrationStats.shopify + integrationStats.ebay > 0 ? "Healthy" : "Needs setup";
  const alerts = [
    pendingRequestsCount > 0 ? `${pendingRequestsCount} document requests pending` : null,
    pendingInvoicesCount > 0 ? `${pendingInvoicesCount} due invoices` : null,
    (hasDateRange ? dueAmount : pendingInvoicesAmount) > 0
      ? `Outstanding balance $${Number(hasDateRange ? dueAmount : pendingInvoicesAmount).toLocaleString("en-US")}`
      : null,
  ].filter((v): v is string => Boolean(v));

  return (
    <div className="min-h-full bg-gradient-to-b from-slate-50/95 to-slate-100/80">
      <div className="mx-auto max-w-[1600px] space-y-8 px-4 py-6 md:px-6">
        {/* Page title + Date picker */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Admin Dashboard</h1>
            <p className="mt-1 text-sm text-slate-500">PrepCorex — operations overview</p>
            </div>
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-slate-500" />
            <DateRangePicker
              fromDate={dateRangeFrom}
              toDate={dateRangeTo}
              setFromDate={setDateRangeFrom}
              setToDate={setDateRangeTo}
              className="h-9 min-w-[240px] border-slate-200 bg-white text-sm shadow-sm sm:w-[260px]"
            />
          </div>
        </div>

        {/* KPI Cards — same style as user dashboard */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {kpiCards.map((kpi) => {
            const Icon = kpi.icon;
            return (
              <Link key={kpi.title} href={kpi.href} className="block cursor-pointer">
                <Card className="overflow-hidden rounded-xl border-neutral-200/80 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition-shadow hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between">
                      <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", kpi.iconBg)}>
                        <Icon className="h-5 w-5" />
            </div>
                    </div>
                    <p className="mt-3 text-2xl font-semibold tracking-tight text-neutral-900">{kpi.value}</p>
                    <p className="mt-0.5 text-sm font-medium text-neutral-600">{kpi.title}</p>
                    <p className="mt-1 text-xs text-neutral-500">{kpi.hint}</p>
          </CardContent>
        </Card>
              </Link>
            );
          })}
        </section>

        {/* Financial + Integrations + Alerts */}
        <section className="grid gap-6 lg:grid-cols-12">
          <Card className="overflow-hidden rounded-xl border-slate-200/80 bg-white/95 shadow-[0_1px_3px_rgba(0,0,0,0.06)] lg:col-span-4">
            <CardHeader className="pb-2 pt-6 px-6">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                  <Wallet className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold text-slate-900">Finance snapshot</CardTitle>
                  <CardDescription className="text-slate-500">
                    {hasDateRange ? "Selected date range" : "All time"}
                  </CardDescription>
                </div>
            </div>
          </CardHeader>
            <CardContent className="px-6 pb-6">
            {financeLoading ? (
                <Skeleton className="h-20 w-full rounded-lg" />
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Billed</span>
                    <span className="font-semibold text-slate-900">
                      ${Number(financialMetrics.billedInRange || 0).toLocaleString("en-US")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Paid</span>
                    <span className="font-semibold text-emerald-600">
                      ${Number(financialMetrics.paidInRange || 0).toLocaleString("en-US")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Due</span>
                    <span className="font-semibold text-rose-600">
                      ${Number(dueAmount || 0).toLocaleString("en-US")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Collection rate</span>
                    <span className="font-semibold text-slate-900">{collectionRate}%</span>
                  </div>
                  <Link href="/admin/dashboard/invoices" className="inline-flex items-center text-xs font-medium text-emerald-600 hover:underline">
                    Open invoices <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Link>
                </div>
            )}
          </CardContent>
        </Card>

          <Card className="overflow-hidden rounded-xl border-slate-200/80 bg-white/95 shadow-[0_1px_3px_rgba(0,0,0,0.06)] lg:col-span-4">
            <CardHeader className="pb-2 pt-6 px-6">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                  <DollarSign className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold text-slate-900">Today's Revenue</CardTitle>
                  <CardDescription className="text-slate-500">Real-time paid invoices today</CardDescription>
                </div>
            </div>
          </CardHeader>
            <CardContent className="px-6 pb-6">
              {financeLoading ? (
                <Skeleton className="h-20 w-full rounded-lg" />
              ) : (
                <div className="space-y-3">
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 p-3">
                    <p className="text-xs uppercase tracking-wide text-emerald-700">Collected today</p>
                    <p className="mt-1 text-2xl font-semibold text-emerald-700">
                      ${Number(financialMetrics.todayPaidRevenue || 0).toLocaleString("en-US")}
                    </p>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Paid invoices today</span>
                    <span className="font-semibold text-slate-900">{financialMetrics.todayPaidCount}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Average per invoice</span>
                    <span className="font-semibold text-slate-900">
                      ${Number(todayRevenueAvg || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <Link href="/admin/dashboard/invoices?tab=paid" className="inline-flex items-center text-xs font-medium text-emerald-600 hover:underline">
                    Open paid invoices <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Link>
                </div>
            )}
          </CardContent>
        </Card>

          <Card className="overflow-hidden rounded-xl border-slate-200/80 bg-white/95 shadow-[0_1px_3px_rgba(0,0,0,0.06)] lg:col-span-4">
            <CardHeader className="pb-2 pt-6 px-6">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold text-slate-900">Alerts</CardTitle>
                  <CardDescription className="text-slate-500">Needs attention</CardDescription>
                </div>
            </div>
          </CardHeader>
            <CardContent className="px-6 pb-6">
              <div className="space-y-2">
                {alerts.length === 0 ? (
                  <p className="text-sm text-emerald-600">No critical alerts right now.</p>
                ) : (
                  alerts.slice(0, 4).map((alert) => (
                    <p key={alert} className="text-sm text-slate-700">• {alert}</p>
                  ))
                )}
                <Link href="/admin/dashboard/notifications" className="inline-flex items-center text-xs font-medium text-rose-600 hover:underline">
                  Open notifications <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </div>
          </CardContent>
        </Card>

          <Card className="overflow-hidden rounded-xl border-slate-200/80 bg-white/95 shadow-[0_1px_3px_rgba(0,0,0,0.06)] lg:col-span-12">
            <CardHeader className="pb-2 pt-6 px-6">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-600">
                  <PlugZap className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold text-slate-900">Integrations & Storage</CardTitle>
                  <CardDescription className="text-slate-500">{integrationHealth}</CardDescription>
                </div>
            </div>
          </CardHeader>
            <CardContent className="px-6 pb-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/70 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Order Integrations</p>
                  {integrationLoading ? (
                    <Skeleton className="h-16 w-full rounded-lg" />
                  ) : (
                    <>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-500">Shopify connections</span>
                        <span className="font-semibold text-slate-900">{integrationStats.shopify}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-500">eBay connections</span>
                        <span className="font-semibold text-slate-900">{integrationStats.ebay}</span>
                      </div>
                      <Link href="/admin/dashboard/shopify-orders" className="inline-flex items-center text-xs font-medium text-cyan-600 hover:underline">
                        Open order integrations <ArrowRight className="ml-1 h-3.5 w-3.5" />
                      </Link>
                    </>
                  )}
                </div>
                <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/70 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Label Storage (OneDrive)</p>
                  <p className="text-xs text-slate-500">Labels uploaded in Outbound Shipment are stored here</p>
                  {oneDriveChecking ? (
                    <p className="flex items-center gap-2 text-sm text-slate-500">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Checking…
                    </p>
                  ) : oneDriveConnected ? (
                    <div className="space-y-2">
                      <p className="flex items-center gap-2 text-sm font-medium text-emerald-600">
                        <CheckCircle className="h-4 w-4" />
                        Connected
                      </p>
                      <button
                        type="button"
                        onClick={async () => {
                          setOneDriveDisconnecting(true);
                          try {
                            const res = await fetch("/api/onedrive/disconnect", { method: "POST" });
                            if (res.ok) {
                              setOneDriveConnected(false);
                            }
                          } finally {
                            setOneDriveDisconnecting(false);
                          }
                        }}
                        disabled={oneDriveDisconnecting}
                        className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {oneDriveDisconnecting ? (
                          <>
                            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                            Disconnecting…
                          </>
                        ) : (
                          "Disconnect"
                        )}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="flex items-center gap-2 text-sm text-amber-600">
                        <XCircle className="h-4 w-4" />
                        Not connected
                      </p>
                      <a
                        href="/api/onedrive/auth"
                        className="inline-flex items-center rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700"
                      >
                        Connect OneDrive
                      </a>
                    </div>
                  )}
                </div>
              </div>
          </CardContent>
        </Card>
        </section>

        {/* Charts row 1: Trend + Status donut */}
        <section className="grid gap-6 lg:grid-cols-12">
          <Card className="overflow-hidden rounded-xl border-slate-200/80 bg-white/95 shadow-[0_1px_3px_rgba(0,0,0,0.06)] backdrop-blur-sm lg:col-span-8">
            <CardHeader className="pb-2 pt-6 px-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600">
                    <TrendingUp className="h-4 w-4" />
                  </div>
            <div>
                    <CardTitle className="text-base font-semibold text-slate-900">
                      {hasDateRange
                        ? "Inventory & Shipment Activity (Selected range)"
                        : `Inventory & Shipment Activity (Last ${trendRange} days)`}
              </CardTitle>
                    <CardDescription className="text-slate-500">
                      {hasDateRange ? "Shipped, added, returns & disposed in date picker range" : `Shipped, added, returns & disposed — ${trendRange}d view`}
              </CardDescription>
            </div>
            </div>
                {!hasDateRange && (
                  <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50/80 p-1">
                    {([7, 14, 30] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setTrendRange(d)}
                        className={cn(
                          "rounded-md px-3 py-1.5 text-xs font-medium transition",
                          trendRange === d ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                        )}
                      >
                        {d}d
                      </button>
                    ))}
                  </div>
                )}
          </div>
        </CardHeader>
            <CardContent className="px-6 pb-6">
              {chartLoading ? (
                <Skeleton className="h-[280px] w-full rounded-lg" />
              ) : (
                <ChartContainer config={trendChartConfig} className="h-[280px] w-full">
                  <AreaChart data={chartData.trend} margin={{ top: 8, right: 8, left: 8, bottom: 8 }} animationDuration={400} animationEasing="ease-out">
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgb(226 232 240)" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Area dataKey="shipped" type="monotone" fill="var(--color-shipped)" fillOpacity={0.2} stroke="var(--color-shipped)" strokeWidth={2} />
                    <Area dataKey="added" type="monotone" fill="var(--color-added)" fillOpacity={0.2} stroke="var(--color-added)" strokeWidth={2} />
                    <Area dataKey="returns" type="monotone" fill="var(--color-returns)" fillOpacity={0.16} stroke="var(--color-returns)" strokeWidth={2} />
                    <Area dataKey="disposed" type="monotone" fill="var(--color-disposed)" fillOpacity={0.16} stroke="var(--color-disposed)" strokeWidth={2} />
                  </AreaChart>
                </ChartContainer>
            )}
          </CardContent>
        </Card>

          <Card className="overflow-hidden rounded-xl border-slate-200/80 bg-white/95 shadow-[0_1px_3px_rgba(0,0,0,0.06)] backdrop-blur-sm lg:col-span-4">
            <CardHeader className="pb-2 pt-6 px-6">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600">
                  <PieChartIcon className="h-4 w-4" />
              </div>
            <div>
                  <CardTitle className="text-base font-semibold text-slate-900">Request Processing Status</CardTitle>
                  <CardDescription className="text-slate-500">Pending, processing, shipped, rejected</CardDescription>
            </div>
          </div>
        </CardHeader>
            <CardContent className="px-6 pb-6">
              {chartLoading ? (
                <Skeleton className="h-[280px] w-full rounded-lg" />
              ) : (
                <ChartContainer config={statusChartConfig} className="h-[280px] w-full">
                  <PieChart animationDuration={400} animationEasing="ease-out">
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent nameKey="name" className="grid grid-cols-2 gap-x-4 gap-y-2 justify-items-start" />} />
                    <Pie data={chartData.statusDonut} dataKey="value" nameKey="name" innerRadius={58} outerRadius={86} paddingAngle={2}>
                      {chartData.statusDonut.map((entry, i) => (
                        <Cell key={`cell-${i}`} fill={entry.fill} />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Charts row 2: Requests trend + Top users by activity */}
        <section className="grid gap-6 lg:grid-cols-12">
          <Card className="overflow-hidden rounded-xl border-slate-200/80 bg-white/95 shadow-[0_1px_3px_rgba(0,0,0,0.06)] backdrop-blur-sm lg:col-span-6">
            <CardHeader className="pb-2 pt-6 px-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-fuchsia-500/10 text-fuchsia-600">
                    <TrendingUp className="h-4 w-4" />
              </div>
                <div>
                  <CardTitle className="text-base font-semibold text-slate-900">Request Activity Trend</CardTitle>
                  <CardDescription className="text-slate-500">Daily request activity — {hasDateRange ? "date range" : `${requestTrendRange}d view`}</CardDescription>
                </div>
                </div>
                {!hasDateRange && (
                  <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50/80 p-1">
                    {([7, 14, 30] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setRequestTrendRange(d)}
                        className={cn(
                          "rounded-md px-3 py-1.5 text-xs font-medium transition",
                          requestTrendRange === d ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                        )}
                      >
                        {d}d
                      </button>
                    ))}
                      </div>
                )}
                            </div>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              {chartLoading ? (
                <Skeleton className="h-[260px] w-full rounded-lg" />
              ) : (
                <ChartContainer config={requestTrendConfig} className="h-[260px] w-full">
                  <AreaChart data={chartData.requestTrend} margin={{ top: 8, right: 8, left: 8, bottom: 8 }} animationDuration={400} animationEasing="ease-out">
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgb(226 232 240)" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Area dataKey="total" type="monotone" fill="var(--color-total)" fillOpacity={0.22} stroke="var(--color-total)" strokeWidth={2} />
                  </AreaChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-xl border-slate-200/80 bg-white/95 shadow-[0_1px_3px_rgba(0,0,0,0.06)] backdrop-blur-sm lg:col-span-6">
            <CardHeader className="pb-2 pt-6 px-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base font-semibold text-slate-900">Top Active Clients</CardTitle>
                  <CardDescription className="text-slate-500">By revenue — {hasDateRange ? "date range" : `last ${topUsersRange} days`}</CardDescription>
                </div>
                {!hasDateRange && (
                  <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50/80 p-1">
                    {([7, 14, 30] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setTopUsersRange(d)}
                        className={cn(
                          "rounded-md px-3 py-1.5 text-xs font-medium transition",
                          topUsersRange === d ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                        )}
                      >
                        {d}d
                      </button>
                    ))}
                  </div>
                        )}
                      </div>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              {financeLoading && topClientsByRevenue.length === 0 ? (
                <Skeleton className="h-[260px] w-full rounded-lg" />
              ) : (
                <ChartContainer config={topClientsConfig} className="h-[260px] w-full">
                  <BarChart data={topClientsByRevenue} layout="vertical" margin={{ left: 8, right: 8 }} animationDuration={400} animationEasing="ease-out">
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgb(226 232 240)" />
                    <XAxis type="number" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(v) => `$${Number(v).toLocaleString("en-US")}`} />
                    <YAxis type="category" dataKey="user" tickLine={false} axisLine={false} width={92} />
                    <ChartTooltip content={<ChartTooltipContent formatter={(value) => `$${Number(value).toLocaleString("en-US")}`} />} />
                    <Bar dataKey="count" radius={[0, 6, 6, 0]} fill="var(--color-count)" />
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Separate section: Requests by type */}
        <section className="grid gap-6 lg:grid-cols-12">
          <Card className="overflow-hidden rounded-xl border-slate-200/80 bg-white/95 shadow-[0_1px_3px_rgba(0,0,0,0.06)] backdrop-blur-sm lg:col-span-12">
            <CardHeader className="pb-2 pt-6 px-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600">
                    <BarChart3 className="h-4 w-4" />
              </div>
                  <div>
                    <CardTitle className="text-base font-semibold text-slate-900">Operational Workload</CardTitle>
                    <CardDescription className="text-slate-500">Shipment, inventory, returns, dispose — {hasDateRange ? "date range" : `${requestTypesRange}d view`}</CardDescription>
            </div>
          </div>
                {!hasDateRange && (
                  <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50/80 p-1">
                    {([7, 14, 30] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setRequestTypesRange(d)}
                        className={cn(
                          "rounded-md px-3 py-1.5 text-xs font-medium transition",
                          requestTypesRange === d ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                        )}
                      >
                        {d}d
                      </button>
                    ))}
              </div>
                )}
            </div>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              {chartLoading ? (
                <Skeleton className="h-[260px] w-full rounded-lg" />
              ) : (
                <ChartContainer config={requestTypesChartConfig} className="h-[260px] w-full">
                  <BarChart data={chartData.requestTypes} layout="vertical" margin={{ left: 18, right: 18 }} animationDuration={400} animationEasing="ease-out">
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgb(226 232 240)" />
                    <XAxis type="number" tickLine={false} axisLine={false} tickMargin={8} />
                    <YAxis type="category" dataKey="type" tickLine={false} axisLine={false} width={84} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Bar dataKey="count" nameKey="type" radius={[0, 6, 6, 0]}>
                      {chartData.requestTypes.map((entry, i) => (
                        <Cell key={`type-cell-${i}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>
          )}
        </CardContent>
      </Card>
        </section>

        {/* Recent activity table */}
        <section className="grid gap-6 lg:grid-cols-12">
          <Card className="overflow-hidden rounded-xl border-slate-200/80 bg-white/95 shadow-[0_1px_3px_rgba(0,0,0,0.06)] backdrop-blur-sm lg:col-span-12">
            <CardHeader className="pb-2 pt-6 px-6">
              <CardTitle className="text-base font-semibold text-slate-900">Recent activity</CardTitle>
              <CardDescription className="text-slate-500">Latest requests in selected period</CardDescription>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              {chartLoading ? (
                <Skeleton className="h-[260px] w-full rounded-lg" />
              ) : (
                <div className="overflow-hidden rounded-lg border border-slate-200/80">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-200 bg-slate-50/80 hover:bg-slate-50/80">
                        <TableHead className="font-medium text-slate-600">Type</TableHead>
                        <TableHead className="font-medium text-slate-600">User</TableHead>
                        <TableHead className="font-medium text-slate-600">Date</TableHead>
                        <TableHead className="font-medium text-slate-600">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {chartData.recentActivity.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="py-10 text-center text-sm text-slate-500">
                            No recent activity in this period
                          </TableCell>
                        </TableRow>
                      ) : (
                        chartData.recentActivity.map((row) => (
                          <TableRow key={row.id} className="border-slate-100">
                            <TableCell className="font-medium text-slate-900">
                              <Link href="/admin/dashboard/notifications" className="hover:underline">
                                {row.type}
                              </Link>
                            </TableCell>
                            <TableCell className="text-slate-600">{row.userName}</TableCell>
                            <TableCell className="text-slate-600">{row.date}</TableCell>
                            <TableCell>
                              <span
                                className={cn(
                                  "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                                  row.status.toLowerCase() === "pending" && "bg-amber-100 text-amber-800",
                                  row.status.toLowerCase() === "approved" && "bg-blue-100 text-blue-800",
                                  row.status.toLowerCase() === "rejected" && "bg-red-100 text-red-800",
                                  !["pending", "approved", "rejected"].includes(row.status.toLowerCase()) && "bg-slate-100 text-slate-700"
                                )}
                              >
                                {row.status}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
