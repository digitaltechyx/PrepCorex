"use client";

import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import type { InventoryItem, ShippedItem, Invoice } from "@/types";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Boxes,
  Clock3,
  DollarSign,
  AlertTriangle,
  Truck,
  RefreshCw,
  CheckCircle2,
  PlugZap,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { hasRole } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { useDashboardNav } from "@/contexts/dashboard-nav-context";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Area, AreaChart, Bar, BarChart, Pie, PieChart, CartesianGrid, XAxis, Cell } from "recharts";

type InventoryRequestLite = {
  status?: string;
  productName?: string;
  rejectionReason?: string;
};

type ShipmentRequestLite = {
  id?: string;
  status?: string;
  requestedAt?: { seconds: number; nanoseconds: number } | string;
  date?: { seconds: number; nanoseconds: number } | string;
  shipTo?: string;
  shipments?: Array<{
    productName?: string;
    quantity?: number;
    packOf?: number;
  }>;
};

type InventoryItemWithSource = InventoryItem & {
  source?: "shopify" | "ebay";
};

function normalizeDate(value: ShippedItem["date"]): Date | null {
  if (!value) return null;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object" && "seconds" in value) {
    return new Date(value.seconds * 1000);
  }
  return null;
}

function normalizeInventoryDate(value: InventoryItem["dateAdded"]): Date | null {
  if (!value) return null;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object" && "seconds" in value) {
    return new Date(value.seconds * 1000);
  }
  return null;
}

function normalizeRequestDate(
  value?: { seconds: number; nanoseconds: number } | string
): Date | null {
  if (!value) return null;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object" && "seconds" in value) {
    return new Date(value.seconds * 1000);
  }
  return null;
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

export default function DashboardPage() {
  const { userProfile } = useAuth();
  const router = useRouter();
  const nav = useDashboardNav();
  const [trendRange, setTrendRange] = useState<7 | 14 | 30>(14);
  const dateRangeFrom = nav?.dateRangeFrom;
  const dateRangeTo = nav?.dateRangeTo;
  const sourceFilter = nav?.sourceFilter ?? "all";

  useEffect(() => {
    if (userProfile && hasRole(userProfile, "commission_agent") && !hasRole(userProfile, "user")) {
      router.replace("/dashboard/agent");
    }
  }, [userProfile, router]);

  const {
    data: inventoryData,
    loading: inventoryLoading,
  } = useCollection<InventoryItem>(
    userProfile ? `users/${userProfile.uid}/inventory` : ""
  );
  const {
    data: shippedData,
    loading: shippedLoading,
  } = useCollection<ShippedItem>(
    userProfile ? `users/${userProfile.uid}/shipped` : ""
  );
  const {
    data: invoices,
    loading: invoicesLoading,
  } = useCollection<Invoice>(
    userProfile ? `users/${userProfile.uid}/invoices` : ""
  );
  const { data: inventoryRequests } = useCollection<InventoryRequestLite>(
    userProfile ? `users/${userProfile.uid}/inventoryRequests` : ""
  );
  const { data: shipmentRequests } = useCollection<ShipmentRequestLite>(
    userProfile ? `users/${userProfile.uid}/shipmentRequests` : ""
  );
  const { data: shopifyConnections, loading: shopifyConnectionsLoading } = useCollection<Record<string, unknown>>(
    userProfile ? `users/${userProfile.uid}/shopifyConnections` : ""
  );
  const { data: ebayConnections, loading: ebayConnectionsLoading } = useCollection<Record<string, unknown>>(
    userProfile ? `users/${userProfile.uid}/ebayConnections` : ""
  );

  const hasDateRange = Boolean(dateRangeFrom && dateRangeTo);

  const shippedDataInRange = useMemo(() => {
    if (!hasDateRange) return shippedData;
    return shippedData.filter((row) => isDateInRange(normalizeDate(row.date), dateRangeFrom, dateRangeTo));
  }, [shippedData, hasDateRange, dateRangeFrom, dateRangeTo]);

  const shipmentRequestsInRange = useMemo(() => {
    if (!hasDateRange) return shipmentRequests;
    return shipmentRequests.filter((req) =>
      isDateInRange(normalizeRequestDate(req.requestedAt || req.date), dateRangeFrom, dateRangeTo)
    );
  }, [shipmentRequests, hasDateRange, dateRangeFrom, dateRangeTo]);

  const totalItemsInInventory = useMemo(() => {
    return inventoryData.reduce((sum, item) => sum + (item.quantity || 0), 0);
  }, [inventoryData]);

  const lowStockItems = useMemo(() => {
    return inventoryData
      .filter((item) => (item.quantity || 0) > 0 && (item.quantity || 0) <= 10)
      .sort((a, b) => (a.quantity || 0) - (b.quantity || 0));
  }, [inventoryData]);

  const totalPendingAmount = useMemo(() => {
    const pendingInvoices = invoices.filter((inv) => inv.status === "pending");
    return pendingInvoices.reduce((sum, inv) => sum + (inv.grandTotal || 0), 0);
  }, [invoices]);

  const pendingFulfillmentCount = useMemo(() => {
    return shipmentRequests.filter((r) => (r.status || "").toLowerCase() === "pending").length;
  }, [shipmentRequests]);

  const rejectedInventoryRequests = useMemo(() => {
    return inventoryRequests.filter((r) => (r.status || "").toLowerCase() === "rejected");
  }, [inventoryRequests]);

  const [currentDate, setCurrentDate] = useState(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate()
    ).padStart(2, "0")}`;
  });

  useEffect(() => {
    const updateDate = () => {
      const today = new Date();
      const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(
        2,
        "0"
      )}-${String(today.getDate()).padStart(2, "0")}`;
      setCurrentDate(todayString);
    };
    updateDate();
    const interval = setInterval(updateDate, 60000);
    return () => clearInterval(interval);
  }, []);

  const todaysShippedOrders = useMemo(() => {
    if (hasDateRange) return shippedDataInRange.length;
    return shippedData.filter((item) => {
      const itemDate = normalizeDate(item.date);
      if (!itemDate) return false;
      const itemDateString = `${itemDate.getFullYear()}-${String(itemDate.getMonth() + 1).padStart(
        2,
        "0"
      )}-${String(itemDate.getDate()).padStart(2, "0")}`;
      return itemDateString === currentDate;
    }).length;
  }, [shippedData, currentDate, hasDateRange, shippedDataInRange.length]);

  const integrationHealth = useMemo(() => {
    const hasShopify = shopifyConnections.length > 0;
    const hasEbay = ebayConnections.length > 0;
    if (hasShopify && hasEbay) return { label: "Healthy", pct: 100 };
    if (hasShopify || hasEbay) return { label: "Partial", pct: 70 };
    return { label: "Not Connected", pct: 20 };
  }, [shopifyConnections.length, ebayConnections.length]);

  const sourceSplit = useMemo(() => {
    const rows = inventoryData as InventoryItemWithSource[];
    const filtered =
      hasDateRange && dateRangeFrom && dateRangeTo
        ? rows.filter((r) =>
            isDateInRange(normalizeInventoryDate(r.dateAdded), dateRangeFrom, dateRangeTo)
          )
        : rows;
    const shopify = filtered.filter((r) => r.source === "shopify").length;
    const ebay = filtered.filter((r) => r.source === "ebay").length;
    const manual = filtered.length - shopify - ebay;
    return { shopify, ebay, manual };
  }, [inventoryData, hasDateRange, dateRangeFrom, dateRangeTo]);

  const inventoryAndShipmentTrend = useMemo(() => {
    const buckets = new Map<string, { label: string; shipped: number; added: number }>();

    if (hasDateRange && dateRangeFrom && dateRangeTo) {
      const start = startOfDay(dateRangeFrom);
      const end = endOfDay(dateRangeTo);
      for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
        const d = new Date(t);
        const key = d.toISOString().slice(0, 10);
        const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        buckets.set(key, { label, shipped: 0, added: 0 });
      }
    } else {
      const days = trendRange;
      const now = new Date();
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        buckets.set(key, { label, shipped: 0, added: 0 });
      }
    }

    for (const row of shippedDataInRange) {
      const d = normalizeDate(row.date);
      if (!d) continue;
      const key = d.toISOString().slice(0, 10);
      if (!buckets.has(key)) continue;
      const qty = Number(row.shippedQty ?? 0);
      buckets.get(key)!.shipped += Number.isFinite(qty) ? qty : 0;
    }

    const inventoryFiltered = hasDateRange && dateRangeFrom && dateRangeTo
      ? inventoryData.filter((row) =>
          isDateInRange(normalizeInventoryDate(row.dateAdded), dateRangeFrom, dateRangeTo)
        )
      : inventoryData;
    for (const row of inventoryFiltered) {
      const d = normalizeInventoryDate(row.dateAdded);
      if (!d) continue;
      const key = d.toISOString().slice(0, 10);
      if (!buckets.has(key)) continue;
      const qty = Number(row.quantity ?? 0);
      buckets.get(key)!.added += Number.isFinite(qty) ? qty : 0;
    }

    return Array.from(buckets.values());
  }, [inventoryData, shippedDataInRange, trendRange, hasDateRange, dateRangeFrom, dateRangeTo]);

  const orderStatusData = useMemo(() => {
    const statusCounts = {
      pending: 0,
      shipped: shippedDataInRange.length,
      rejected: 0,
      processing: 0,
    };

    for (const req of shipmentRequestsInRange) {
      const status = (req.status || "").toLowerCase();
      if (status === "pending") statusCounts.pending += 1;
      else if (status === "rejected") statusCounts.rejected += 1;
      else if (status === "approved" || status === "in_progress" || status === "confirmed") statusCounts.processing += 1;
    }

    return [
      { name: "Shipped", value: statusCounts.shipped, fill: "var(--color-shipped)" },
      { name: "Pending", value: statusCounts.pending, fill: "var(--color-pending)" },
      { name: "Processing", value: statusCounts.processing, fill: "var(--color-processing)" },
      { name: "Rejected", value: statusCounts.rejected, fill: "var(--color-rejected)" },
    ];
  }, [shipmentRequestsInRange, shippedDataInRange.length]);

  const sourceSplitData = useMemo(
    () => [
      { source: "Shopify", count: sourceSplit.shopify, fill: "var(--color-shopify)" },
      { source: "eBay", count: sourceSplit.ebay, fill: "var(--color-ebay)" },
      { source: "Manual", count: sourceSplit.manual, fill: "var(--color-manual)" },
    ],
    [sourceSplit]
  );

  const trendChartConfig = {
    shipped: { label: "Shipped Units", color: "#3b82f6" },
    added: { label: "Inventory Added", color: "#22c55e" },
  } satisfies ChartConfig;

  const orderStatusChartConfig = {
    shipped: { label: "Shipped", color: "#22c55e" },
    pending: { label: "Pending", color: "#f59e0b" },
    processing: { label: "Processing", color: "#3b82f6" },
    rejected: { label: "Rejected", color: "#ef4444" },
    // Capitalized for legend lookup (Pie sends name: "Shipped" etc.)
    Shipped: { label: "Shipped", color: "#22c55e" },
    Pending: { label: "Pending", color: "#f59e0b" },
    Processing: { label: "Processing", color: "#3b82f6" },
    Rejected: { label: "Rejected", color: "#ef4444" },
  } satisfies ChartConfig;

  const sourceSplitChartConfig = {
    shopify: { label: "Shopify", color: "#2563eb" },
    ebay: { label: "eBay", color: "#22c55e" },
    manual: { label: "Manual", color: "#f59e0b" },
  } satisfies ChartConfig;

  const topMovingProducts = useMemo(() => {
    const moved = new Map<string, number>();

    for (const row of shippedDataInRange) {
      if (Array.isArray(row.items) && row.items.length > 0) {
        for (const item of row.items) {
          const name = item.productName || "Unknown Product";
          const qty = Number(item.shippedQty ?? item.quantity ?? 0);
          moved.set(name, (moved.get(name) || 0) + (Number.isFinite(qty) ? qty : 0));
        }
      } else if (row.productName) {
        const qty = Number(row.shippedQty ?? 0);
        moved.set(row.productName, (moved.get(row.productName) || 0) + (Number.isFinite(qty) ? qty : 0));
      }
    }

    const inventoryMap = new Map(
      inventoryData.map((inv) => [inv.productName.toLowerCase(), inv.quantity || 0])
    );

    return Array.from(moved.entries())
      .map(([name, units]) => ({
        name,
        units,
        stockLeft: inventoryMap.get(name.toLowerCase()) ?? 0,
      }))
      .sort((a, b) => b.units - a.units)
      .slice(0, 8);
  }, [shippedDataInRange, inventoryData]);

  const kpiCards = [
    { title: "Total Inventory", value: String(totalItemsInInventory), hint: "Units across all products", icon: Boxes, iconBg: "bg-blue-500/10 text-blue-600", href: "/dashboard/inventory" },
    { title: "Low Stock SKUs", value: String(lowStockItems.length), hint: "Qty ≤ 10", icon: AlertTriangle, iconBg: "bg-amber-500/10 text-amber-600", href: "/dashboard/inventory?status=low-stock" },
    { title: "Pending Orders", value: String(pendingFulfillmentCount), hint: "Awaiting fulfillment", icon: Clock3, iconBg: "bg-orange-500/10 text-orange-600", href: "/dashboard/shipped-orders?status=pending" },
    { title: hasDateRange ? "Shipped in period" : "Today Shipped Orders", value: String(todaysShippedOrders), hint: hasDateRange ? "In selected date range" : "Shipments recorded", icon: Truck, iconBg: "bg-violet-500/10 text-violet-600", href: "/dashboard/shipped-orders?status=shipped" },
    { title: "Pending Invoice", value: invoicesLoading ? "..." : `$${Number(totalPendingAmount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, hint: "Outstanding balance", icon: DollarSign, iconBg: "bg-emerald-500/10 text-emerald-600", href: "/dashboard/invoices" },
    { title: "Integration Health", value: shopifyConnectionsLoading || ebayConnectionsLoading ? "..." : `${integrationHealth.pct}%`, hint: integrationHealth.label, icon: RefreshCw, iconBg: "bg-teal-500/10 text-teal-600" },
  ];

  return (
    <div className="min-h-full bg-neutral-50/80">
      <div className="mx-auto max-w-[1600px] space-y-8 px-4 py-6 md:px-6">
        {userProfile?.clientId && (
          <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 text-sm text-muted-foreground shadow-sm">
            <span>Your client ID:</span>
            <span className="font-mono font-semibold text-foreground">#{userProfile.clientId}</span>
          </div>
        )}
        {/* KPI cards - soft shadows, rounded-xl */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {kpiCards.map((kpi) => {
            const Icon = kpi.icon;
            const href = "href" in kpi ? kpi.href : undefined;
            const cardContent = (
              <Card
                className={cn(
                  "overflow-hidden rounded-xl border-neutral-200/80 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition-shadow hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]",
                  href && "cursor-pointer hover:border-neutral-300/80"
                )}
              >
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
            );
            if (href) {
              return (
                <Link key={kpi.title} href={href} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-xl">
                  {cardContent}
                </Link>
              );
            }
            return <span key={kpi.title} className="block">{cardContent}</span>;
          })}
        </section>

        {/* Date picker - filter analytics by range */}
        {nav && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-neutral-600">Date range:</span>
            <DateRangePicker
              fromDate={nav.dateRangeFrom}
              toDate={nav.dateRangeTo}
              setFromDate={nav.setDateRangeFrom}
              setToDate={nav.setDateRangeTo}
              className="h-9 w-full min-w-[240px] border-neutral-200 bg-white text-sm shadow-[0_1px_2px_rgba(0,0,0,0.05)] sm:w-[280px]"
            />
          </div>
        )}

        {/* Analytics: Line chart + Donut */}
        <section className="grid gap-6 xl:grid-cols-12">
          <Card className="xl:col-span-7 overflow-hidden rounded-xl border-neutral-200/80 bg-white/90 shadow-[0_1px_3px_rgba(0,0,0,0.08)] backdrop-blur-sm">
            <CardHeader className="pb-2 pt-6 px-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base font-semibold text-neutral-900">Inventory & Shipment Activity</CardTitle>
                  <CardDescription className="text-neutral-500">
                    {hasDateRange ? "Shipped vs added in selected date range" : "Shipped vs added inventory over time"}
                  </CardDescription>
                </div>
                {!hasDateRange && (
                  <div className="inline-flex rounded-lg border border-neutral-200 bg-neutral-50/80 p-1">
                    {([7, 14, 30] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setTrendRange(d)}
                        className={cn(
                          "rounded-md px-3 py-1.5 text-xs font-medium transition",
                          trendRange === d ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
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
              <ChartContainer config={trendChartConfig} className="h-[280px] w-full">
                <AreaChart data={inventoryAndShipmentTrend}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgb(229 231 235)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Area dataKey="added" type="monotone" fill="var(--color-added)" fillOpacity={0.2} stroke="var(--color-added)" strokeWidth={2} />
                  <Area dataKey="shipped" type="monotone" fill="var(--color-shipped)" fillOpacity={0.2} stroke="var(--color-shipped)" strokeWidth={2} />
                </AreaChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card className="xl:col-span-5 overflow-hidden rounded-xl border-neutral-200/80 bg-white/90 shadow-[0_1px_3px_rgba(0,0,0,0.08)] backdrop-blur-sm">
            <CardHeader className="pb-2 pt-6 px-6">
              <CardTitle className="text-base font-semibold text-neutral-900">Request Processing Status</CardTitle>
              <CardDescription className="text-neutral-500">Shipped, pending, processing, rejected</CardDescription>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              <ChartContainer config={orderStatusChartConfig} className="h-[280px] w-full">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent nameKey="name" className="grid grid-cols-2 gap-x-6 gap-y-2 justify-items-start" />} />
                  <Pie data={orderStatusData} dataKey="value" nameKey="name" innerRadius={56} outerRadius={88} paddingAngle={2}>
                    {orderStatusData.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </section>

        {/* Alerts — separate section after graph and donut */}
        <section>
          <Card className="overflow-hidden rounded-xl border-neutral-200/80 bg-white/90 shadow-[0_1px_3px_rgba(0,0,0,0.08)] backdrop-blur-sm">
            <CardHeader className="pb-2 pt-6 px-6">
              <CardTitle className="text-base font-semibold text-neutral-900">Alerts</CardTitle>
              <CardDescription className="text-neutral-500">Needs attention</CardDescription>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              <div className="grid grid-cols-2 gap-3">
                <Link href="/dashboard/inventory?status=low-stock" className="block min-w-0 rounded-lg border border-amber-200/80 bg-amber-50/60 p-3 transition-colors hover:bg-amber-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
                  <p className="text-sm font-medium text-amber-900">Low Stock ({lowStockItems.length})</p>
                  {lowStockItems.length === 0 ? (
                    <p className="mt-1 text-xs text-amber-700">All good</p>
                  ) : (
                    lowStockItems.slice(0, 3).map((item) => (
                      <p key={item.id} className="mt-1 text-xs text-amber-800">{item.productName}: {item.quantity} left</p>
                    ))
                  )}
                  {lowStockItems.length > 0 && (
                    <p className="mt-2 text-xs font-medium text-amber-700 underline-offset-2 hover:underline">View filtered inventory →</p>
                  )}
                </Link>
                <div className="min-w-0 rounded-lg border border-rose-200/80 bg-rose-50/60 p-3">
                  <p className="text-sm font-medium text-rose-900">Rejected Requests ({rejectedInventoryRequests.length})</p>
                  {rejectedInventoryRequests.length === 0 ? (
                    <p className="mt-1 text-xs text-rose-700">None</p>
                  ) : (
                    rejectedInventoryRequests.slice(0, 2).map((req, idx) => (
                      <p key={`${req.productName}-${idx}`} className="mt-1 text-xs text-rose-800">{req.productName || "Item"}: {req.rejectionReason || "Rejected"}</p>
                    ))
                  )}
                </div>
                <div className="min-w-0 rounded-lg border border-blue-200/80 bg-blue-50/60 p-3">
                  <p className="text-sm font-medium text-blue-900">Pending Fulfillment ({pendingFulfillmentCount})</p>
                  <p className="mt-1 text-xs text-blue-700">Shipment requests waiting</p>
                  <Link href="/dashboard/shipped-orders?status=pending" className="mt-2 inline-block text-xs font-medium text-blue-600 hover:underline">Review →</Link>
                </div>
                <div className="min-w-0 rounded-lg border border-emerald-200/80 bg-emerald-50/60 p-3">
                  <p className="text-sm font-medium text-emerald-900">Integrations</p>
                  <p className="mt-1 text-xs text-emerald-800">Shopify: {shopifyConnections.length > 0 ? "Connected" : "Not connected"}</p>
                  <p className="text-xs text-emerald-800">eBay: {ebayConnections.length > 0 ? "Connected" : "Not connected"}</p>
                  <Link href="/dashboard/integrations" className="mt-2 inline-block text-xs font-medium text-emerald-600 hover:underline">Settings →</Link>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Source split bar chart + Top moving products */}
        <section className="grid gap-6 xl:grid-cols-12 xl:items-stretch">
          <Card className="xl:col-span-5 flex flex-col overflow-hidden rounded-xl border-neutral-200/80 bg-white/90 shadow-[0_1px_3px_rgba(0,0,0,0.08)] backdrop-blur-sm xl:min-h-0">
            <CardHeader className="pb-2 pt-6 px-6 shrink-0">
              <CardTitle className="text-base font-semibold text-neutral-900">Inventory Sources</CardTitle>
              <CardDescription className="text-neutral-500">
                {hasDateRange ? "Inventory added in selected range by channel" : "Inventory by channel"}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col min-h-0 px-6 pb-6">
              <ChartContainer config={sourceSplitChartConfig} className="min-h-[260px] w-full flex-1">
                <BarChart data={sourceSplitData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgb(229 231 235)" />
                  <XAxis dataKey="source" tickLine={false} axisLine={false} tickMargin={8} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card className="xl:col-span-7 flex flex-col overflow-hidden rounded-xl border-neutral-200/80 bg-white/90 shadow-[0_1px_3px_rgba(0,0,0,0.08)] backdrop-blur-sm xl:min-h-0">
            <CardHeader className="pb-2 pt-6 px-6 shrink-0">
              <CardTitle className="text-base font-semibold text-neutral-900">Top Moving Products</CardTitle>
              <CardDescription className="text-neutral-500">Highest shipped volume</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col min-h-0 px-6 pb-6">
              {shippedLoading || inventoryLoading ? (
                <Skeleton className="h-40 w-full rounded-lg" />
              ) : (
                <div className="overflow-hidden rounded-xl border border-neutral-200/80">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-neutral-200 bg-neutral-50/80 hover:bg-neutral-50/80">
                        <TableHead className="font-medium text-neutral-600">Product</TableHead>
                        <TableHead className="text-right font-medium text-neutral-600">Shipped</TableHead>
                        <TableHead className="text-right font-medium text-neutral-600">Stock</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topMovingProducts.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="py-8 text-center text-sm text-neutral-500">No data yet</TableCell>
                        </TableRow>
                      ) : (
                        topMovingProducts.map((item) => (
                          <TableRow key={item.name} className="border-neutral-100">
                            <TableCell className="font-medium text-neutral-900">{item.name}</TableCell>
                            <TableCell className="text-right text-neutral-600">{item.units}</TableCell>
                            <TableCell className="text-right">
                              <Badge variant={item.stockLeft <= 10 ? "destructive" : "secondary"} className="font-medium">
                                {item.stockLeft}
                              </Badge>
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
