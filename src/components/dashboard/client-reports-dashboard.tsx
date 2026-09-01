"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { endOfMonth, format, startOfMonth, subDays, subMonths } from "date-fns";
import {
  BarChart3,
  FileSpreadsheet,
  Loader2,
  Package,
  PiggyBank,
  Receipt,
  Truck,
  Scissors,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { buildClientReportCsv } from "@/lib/client-reports-csv";
import type { ClientReportLabelRow, ClientReportSummary, ClientReportTab } from "@/lib/client-reports-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";

const activityChartConfig = {
  received: { label: "Received", color: "hsl(142 76% 36%)" },
  shipped: { label: "Shipped", color: "hsl(221 83% 53%)" },
} satisfies ChartConfig;

const savingsChartConfig = {
  amount: { label: "Amount", color: "hsl(142 71% 35%)" },
} satisfies ChartConfig;

const shippingValueChartConfig = {
  paid: { label: "You paid", color: "hsl(215 16% 47%)" },
  save: { label: "Est. save", color: "hsl(24 95% 53%)" },
  market: { label: "Typical market", color: "hsl(24 70% 78%)" },
} satisfies ChartConfig;

const prepValueChartConfig = {
  paid: { label: "Your PrepCorex rate", color: "hsl(215 16% 47%)" },
  save: { label: "Est. save", color: "hsl(262 83% 58%)" },
  market: { label: "Typical 3PL", color: "hsl(262 60% 78%)" },
} satisfies ChartConfig;

const prepBenchmarkChartConfig = {
  fba: { label: "FBA prep", color: "hsl(262 83% 58%)" },
  fbm: { label: "FBM pick/pack", color: "hsl(221 83% 53%)" },
  crossdock: { label: "Cross-dock", color: "hsl(38 92% 50%)" },
  returns: { label: "Returns handling", color: "hsl(24 95% 53%)" },
} satisfies ChartConfig;

type ValueBarRow = { name: string; amount: number; fill: string; key: string };

function ValueComparisonBarChart({
  data,
  config,
  marketTotal,
}: {
  data: ValueBarRow[];
  config: ChartConfig;
  marketTotal: number;
}) {
  const maxAmount = Math.max(marketTotal, ...data.map((row) => row.amount), 1);
  return (
    <div className="space-y-3">
      <ChartContainer config={config} className="h-[220px] w-full">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={11} />
          <YAxis
            tickLine={false}
            axisLine={false}
            fontSize={11}
            width={56}
            tickFormatter={(v) => `$${Number(v).toFixed(0)}`}
            domain={[0, Math.ceil(maxAmount * 1.12)]}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value) => money(Number(value))}
              />
            }
          />
          <Bar dataKey="amount" radius={[6, 6, 0, 0]} maxBarSize={72}>
            {data.map((row) => (
              <Cell key={row.key} fill={row.fill} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
        <span>Typical market total ~{money(marketTotal)}</span>
        <div className="flex flex-wrap gap-3">
          {data.map((row) => (
            <span key={row.key} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: row.fill }}
              />
              {row.name} {money(row.amount)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

type RankedBarRow = { name: string; amount: number; fill: string };

function rankedBarFill(amount: number, amounts: number[]): string {
  const unique = [...new Set(amounts.map((n) => Math.round(n * 100) / 100))].sort((a, b) => a - b);
  const rounded = Math.round(amount * 100) / 100;
  if (unique.length <= 1) return "hsl(142 71% 35%)";
  const idx = Math.max(0, unique.indexOf(rounded));
  const t = idx / (unique.length - 1);
  if (t <= 0) return "hsl(142 71% 35%)";
  if (t >= 1) return "hsl(0 72% 51%)";
  if (t < 0.5) {
    const p = t / 0.5;
    return `hsl(${142 - 104 * p} 80% ${35 + 12 * p}%)`;
  }
  const p = (t - 0.5) / 0.5;
  return `hsl(${38 - 38 * p} 80% ${47 + 4 * p}%)`;
}

function withRankedBarFills(rows: Array<{ name: string; amount: number }>): RankedBarRow[] {
  const amounts = rows.map((row) => row.amount);
  return rows.map((row) => ({ ...row, fill: rankedBarFill(row.amount, amounts) }));
}

function RankedAmountBarChart({ data }: { data: RankedBarRow[] }) {
  return (
    <ChartContainer config={savingsChartConfig} className="h-[240px] w-full">
      <BarChart data={data}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
        <YAxis tickLine={false} axisLine={false} fontSize={12} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="amount" radius={4}>
          {data.map((row) => (
            <Cell key={row.name} fill={row.fill} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function carrierFamilyLabel(family: ClientReportLabelRow["carrierFamily"]): string {
  if (family === "gofo") return "GOFO";
  if (family === "usps") return "USPS";
  if (family === "ups") return "UPS";
  if (family === "fedex") return "FedEx";
  return "Other";
}

function paidBreakdown(savings: ClientReportSummary["savings"]): Array<{
  title: string;
  paid: number;
  count: number;
}> {
  const items = [
    { title: "Paid GOFO", paid: savings.paidGofo, count: savings.gofoLabelCount },
    {
      title: "Paid USPS",
      paid: savings.paidUsps,
      count: savings.rows.filter((r) => r.carrierFamily === "usps").length,
    },
    {
      title: "Paid UPS",
      paid: savings.paidUps,
      count: savings.rows.filter((r) => r.carrierFamily === "ups").length,
    },
    {
      title: "Paid FedEx",
      paid: savings.paidFedex,
      count: savings.rows.filter((r) => r.carrierFamily === "fedex").length,
    },
  ];
  return items.filter((item) => item.count > 0);
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ClientReportsDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [preset, setPreset] = useState<"this_month" | "last_30" | "last_month" | "custom" | "all">("all");
  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date | undefined>(undefined);
  const [tab, setTab] = useState<ClientReportTab>("overview");
  const [summary, setSummary] = useState<ClientReportSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const now = new Date();
    if (preset === "this_month") {
      setFromDate(startOfMonth(now));
      setToDate(endOfMonth(now));
    } else if (preset === "last_30") {
      setFromDate(subDays(now, 29));
      setToDate(now);
    } else if (preset === "last_month") {
      const d = subMonths(now, 1);
      setFromDate(startOfMonth(d));
      setToDate(endOfMonth(d));
    } else if (preset === "all") {
      setFromDate(undefined);
      setToDate(undefined);
    }
  }, [preset]);

  const fetchReport = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const params = new URLSearchParams();
      if (preset === "all") {
        params.set("preset", "all");
      } else if (fromDate && toDate) {
        params.set("from", format(fromDate, "yyyy-MM-dd"));
        params.set("to", format(toDate, "yyyy-MM-dd"));
      } else {
        params.set("preset", "this_month");
      }
      const res = await fetch(`/api/reports/client-summary?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load report");
      setSummary(data.summary as ClientReportSummary);
    } catch (e) {
      setSummary(null);
      toast({
        variant: "destructive",
        title: "Could not load report",
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setLoading(false);
    }
  }, [user, fromDate, toDate, preset, toast]);

  useEffect(() => {
    if (!user) return;
    if (preset === "custom" && (!fromDate || !toDate)) return;
    void fetchReport();
  }, [user, fetchReport, preset, fromDate, toDate]);

  const savingsChartData = useMemo(() => {
    if (!summary) return [];
    const s = summary.savings;
    return withRankedBarFills([
      { name: "You paid", amount: s.paidTotal },
      { name: "USPS (est.)", amount: s.estimatedUsps },
      { name: "UPS (est.)", amount: s.estimatedUps },
      { name: "FedEx (est.)", amount: s.estimatedFedex },
    ]);
  }, [summary]);

  const prepSummaryChartData = useMemo(() => {
    if (!summary) return [];
    const p = summary.savings.prep;
    return [
      {
        key: "paid",
        name: "Your PrepCorex rate",
        amount: p.paidTotal,
        fill: prepValueChartConfig.paid.color,
      },
      {
        key: "market",
        name: "Typical 3PL (est.)",
        amount: p.estimatedMarket,
        fill: prepValueChartConfig.market.color,
      },
      {
        key: "save",
        name: "Your est. save",
        amount: p.savedOnPrep,
        fill: prepValueChartConfig.save.color,
      },
    ] satisfies ValueBarRow[];
  }, [summary]);

  const prepBenchmarkChartData = useMemo(() => {
    if (!summary) return [];
    const p = summary.savings.prep;
    const rows: ValueBarRow[] = [];
    if (p.fbaUnitCount > 0) {
      rows.push({
        key: "fba",
        name: "Typical FBA (est.)",
        amount: p.estimatedFba,
        fill: prepBenchmarkChartConfig.fba.color,
      });
    }
    if (p.fbmUnitCount > 0) {
      rows.push({
        key: "fbm",
        name: "Typical FBM (est.)",
        amount: p.estimatedFbm,
        fill: prepBenchmarkChartConfig.fbm.color,
      });
    }
    if (p.crossdockUnitCount > 0) {
      rows.push({
        key: "crossdock",
        name: "Typical cross-dock (est.)",
        amount: p.estimatedCrossdock,
        fill: prepBenchmarkChartConfig.crossdock.color,
      });
    }
    if (p.returnsUnitCount > 0) {
      rows.push({
        key: "returns",
        name: "Typical returns (est.)",
        amount: p.estimatedReturns,
        fill: prepBenchmarkChartConfig.returns.color,
      });
    }
    return rows;
  }, [summary]);

  const prepSummaryMarketTotal = useMemo(() => {
    if (!summary) return 0;
    return summary.savings.prep.estimatedMarket;
  }, [summary]);

  const prepBenchmarkMarketTotal = useMemo(() => {
    if (prepBenchmarkChartData.length === 0) return 0;
    return Math.round(
      prepBenchmarkChartData.reduce((sum, row) => sum + row.amount, 0) * 100
    ) / 100;
  }, [prepBenchmarkChartData]);

  const valueOverview = useMemo(() => {
    if (!summary) return null;
    const shippingSaved = summary.savings.savedOnShipping;
    const prepSaved = summary.savings.prep.savedOnPrep;
    const shippingPaid = summary.savings.paidTotal;
    const prepPaid = summary.savings.prep.paidTotal;
    const totalSaved = Math.round((shippingSaved + prepSaved) * 100) / 100;
    const totalPaid = Math.round((shippingPaid + prepPaid) * 100) / 100;
    const marketTotal = Math.round((totalPaid + totalSaved) * 100) / 100;
    const savingsPercent =
      marketTotal > 0 ? Math.round((totalSaved / marketTotal) * 100) : 0;
    const valueMix = withRankedBarFills([
      { name: "Label save", amount: shippingSaved },
      { name: "Prep save", amount: prepSaved },
    ]);
    return {
      shippingSaved,
      prepSaved,
      shippingPaid,
      prepPaid,
      shippingMarket: Math.round((shippingPaid + shippingSaved) * 100) / 100,
      prepMarket: Math.round((prepPaid + prepSaved) * 100) / 100,
      totalSaved,
      totalPaid,
      marketTotal,
      savingsPercent,
      valueMix,
      labelCount: summary.savings.labelCount,
      prepUnits: summary.savings.prep.unitCount,
      unitsShipped: summary.overview.unitsShipped,
      unitsReceived: summary.overview.unitsReceived,
      shippingChartData: [
        {
          key: "paid",
          name: "You paid",
          amount: shippingPaid,
          fill: "hsl(215 16% 47%)",
        },
        {
          key: "save",
          name: "Est. save",
          amount: shippingSaved,
          fill: "hsl(24 95% 53%)",
        },
      ] satisfies ValueBarRow[],
      prepChartData: [
        {
          key: "paid",
          name: "Your PrepCorex rate",
          amount: prepPaid,
          fill: "hsl(215 16% 47%)",
        },
        {
          key: "save",
          name: "Est. save",
          amount: prepSaved,
          fill: "hsl(262 83% 58%)",
        },
      ] satisfies ValueBarRow[],
    };
  }, [summary]);

  function handleExport() {
    if (!summary) return;
    const csv = buildClientReportCsv(summary, tab);
    const stamp = summary.period.allTime ? "all-time" : format(new Date(summary.period.from), "yyyy-MM-dd");
    downloadCsv(`prepcorex-report-${tab}-${stamp}.csv`, csv);
  }

  return (
    <Card className="overflow-hidden border-2 shadow-xl">
      <CardHeader className="bg-gradient-to-r from-slate-800 via-slate-700 to-slate-900 pb-4 text-white">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-2xl font-bold text-white">
              <BarChart3 className="h-6 w-6" />
              Reports
            </CardTitle>
            <CardDescription className="mt-2 text-slate-200">
              See how much you save on labels and prep — plus inventory, invoices, and detailed
              savings breakdowns
            </CardDescription>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end shrink-0">
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-300">Period</p>
              <Select value={preset} onValueChange={(v) => setPreset(v as typeof preset)}>
                <SelectTrigger className="w-[180px] border-white/20 bg-white/10 text-white [&>svg]:text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="this_month">This month</SelectItem>
                  <SelectItem value="last_30">Last 30 days</SelectItem>
                  <SelectItem value="last_month">Last month</SelectItem>
                  <SelectItem value="custom">Custom range</SelectItem>
                  <SelectItem value="all">All time</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="secondary"
              className="bg-white text-slate-900 hover:bg-slate-100"
              onClick={handleExport}
              disabled={!summary || loading}
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              Download CSV
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 p-6">
      {preset === "custom" ? (
        <div className="w-full max-w-md">
          <DateRangePicker
            fromDate={fromDate}
            toDate={toDate}
            setFromDate={setFromDate}
            setToDate={setToDate}
          />
        </div>
      ) : null}

      {loading && !summary ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : !summary ? (
        <p className="text-sm text-muted-foreground">No report data yet.</p>
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as ClientReportTab)} className="space-y-4">
          <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-4">
            <TabsTrigger value="overview" className="gap-1.5">
              <BarChart3 className="h-4 w-4" /> Overview
            </TabsTrigger>
            <TabsTrigger value="inventory" className="gap-1.5">
              <Package className="h-4 w-4" /> Inventory
            </TabsTrigger>
            <TabsTrigger value="invoices" className="gap-1.5">
              <Receipt className="h-4 w-4" /> Invoices
            </TabsTrigger>
            <TabsTrigger value="savings" className="gap-1.5">
              <PiggyBank className="h-4 w-4" /> Savings
            </TabsTrigger>
          </TabsList>

          <p className="text-sm text-muted-foreground">
            {summary.period.allTime
              ? "All time"
              : fromDate && toDate
                ? `${format(fromDate, "MMM d, yyyy")} – ${format(toDate, "MMM d, yyyy")}`
                : summary.period.label}
            {loading ? (
              <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin" />
            ) : null}
          </p>

          <TabsContent value="overview" className="space-y-4">
            {valueOverview ? (
              <>
                <div className="overflow-hidden rounded-2xl border border-slate-800 bg-[#071a3d] text-white shadow-lg">
                  <div className="flex flex-col gap-6 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-7">
                    <div className="min-w-0 space-y-2">
                      <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-orange-300">
                        <TrendingDown className="h-3.5 w-3.5" />
                        Your estimated value
                      </p>
                      <p className="text-sm text-slate-300">
                        What you saved vs typical courier and 3PL prep rates in this period
                      </p>
                      <p className="font-headline text-4xl font-bold tabular-nums tracking-tight sm:text-5xl">
                        {money(valueOverview.totalSaved)}
                      </p>
                      <p className="text-sm text-emerald-300">
                        {valueOverview.marketTotal > 0
                          ? `About ${valueOverview.savingsPercent}% below typical market totals`
                          : "Buy labels and prep to start tracking savings here"}
                      </p>
                      <p className="text-xs text-slate-400">
                        Paid with PrepCorex {money(valueOverview.totalPaid)}
                        {valueOverview.marketTotal > 0
                          ? ` · Typical market ${money(valueOverview.marketTotal)}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex h-28 w-28 shrink-0 items-center justify-center self-start rounded-full border-[7px] border-orange-500 bg-white/5 text-center shadow-[0_0_35px_rgba(249,115,22,.25)] sm:self-center">
                      <span>
                        <span className="block text-2xl font-bold tabular-nums">
                          {valueOverview.savingsPercent}%
                        </span>
                        <span className="block text-[9px] uppercase tracking-wide text-slate-300">
                          saved
                        </span>
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  <Card className="border-orange-200/80 bg-orange-50/30 dark:border-orange-900 dark:bg-orange-950/15">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Truck className="h-4 w-4 text-orange-600" />
                        Label shipping value
                      </CardTitle>
                      <CardDescription>
                        {valueOverview.labelCount} label
                        {valueOverview.labelCount === 1 ? "" : "s"} vs typical USPS / UPS / FedEx
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ValueComparisonBarChart
                        data={valueOverview.shippingChartData}
                        config={shippingValueChartConfig}
                        marketTotal={valueOverview.shippingMarket}
                      />
                    </CardContent>
                  </Card>

                  <Card className="border-violet-200/80 bg-violet-50/30 dark:border-violet-900 dark:bg-violet-950/15">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Scissors className="h-4 w-4 text-violet-600" />
                        Prep value
                      </CardTitle>
                      <CardDescription>
                  {valueOverview.prepUnits} unit
                  {valueOverview.prepUnits === 1 ? "" : "s"} vs typical 3PL prep (FBA, FBM,
                  cross-dock, returns)
                </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ValueComparisonBarChart
                        data={valueOverview.prepChartData}
                        config={prepValueChartConfig}
                        marketTotal={valueOverview.prepMarket}
                      />
                    </CardContent>
                  </Card>
                </div>

                {valueOverview.totalSaved > 0 ? (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <PiggyBank className="h-4 w-4" />
                        Where your savings come from
                      </CardTitle>
                      <CardDescription>
                        Estimated dollars saved on labels vs prep in this period
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <RankedAmountBarChart data={valueOverview.valueMix} />
                    </CardContent>
                  </Card>
                ) : null}

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <TrendingUp className="h-4 w-4" />
                      Activity growth
                    </CardTitle>
                    <CardDescription>
                      Throughput in this period — full inventory and invoice lists are on their own
                      tabs
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-2 sm:grid-cols-4">
                      <div className="rounded-xl border bg-muted/30 px-3 py-2.5">
                        <p className="text-[11px] text-muted-foreground">Labels bought</p>
                        <p className="text-lg font-semibold tabular-nums">
                          {valueOverview.labelCount}
                        </p>
                      </div>
                      <div className="rounded-xl border bg-muted/30 px-3 py-2.5">
                        <p className="text-[11px] text-muted-foreground">Units prepped</p>
                        <p className="text-lg font-semibold tabular-nums">
                          {valueOverview.prepUnits}
                        </p>
                      </div>
                      <div className="rounded-xl border bg-muted/30 px-3 py-2.5">
                        <p className="text-[11px] text-muted-foreground">Received</p>
                        <p className="text-lg font-semibold tabular-nums">
                          {valueOverview.unitsReceived}
                        </p>
                      </div>
                      <div className="rounded-xl border bg-muted/30 px-3 py-2.5">
                        <p className="text-[11px] text-muted-foreground">Shipped</p>
                        <p className="text-lg font-semibold tabular-nums">
                          {valueOverview.unitsShipped}
                        </p>
                      </div>
                    </div>
                    {summary.charts.activityByDay.length > 0 ? (
                      <ChartContainer config={activityChartConfig} className="h-[240px] w-full">
                        <BarChart data={summary.charts.activityByDay}>
                          <CartesianGrid vertical={false} />
                          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                          <YAxis
                            tickLine={false}
                            axisLine={false}
                            fontSize={12}
                            allowDecimals={false}
                          />
                          <ChartTooltip content={<ChartTooltipContent />} />
                          <Bar dataKey="received" fill="var(--color-received)" radius={4} />
                          <Bar dataKey="shipped" fill="var(--color-shipped)" radius={4} />
                        </BarChart>
                      </ChartContainer>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No receive/ship activity in this period yet.
                      </p>
                    )}
                  </CardContent>
                </Card>

                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Savings are estimates vs approximate courier and typical 3PL prep benchmarks — not
                  live carrier quotes. Open the Savings tab for full rate cards and label detail.
                </p>
              </>
            ) : null}
          </TabsContent>

          <TabsContent value="inventory">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Inventory snapshot</CardTitle>
                <CardDescription>
                  Current on-hand by SKU (not filtered by date). {summary.inventory.length} product(s).
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {summary.inventory.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No inventory on file.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead className="text-right">On hand</TableHead>
                        <TableHead className="text-right">Damaged</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {summary.inventory.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium">{row.productName}</TableCell>
                          <TableCell className="font-mono text-xs">{row.sku || "—"}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{row.source}</Badge>
                          </TableCell>
                          <TableCell className="text-right">{row.quantity}</TableCell>
                          <TableCell className="text-right">{row.damagedQuantity}</TableCell>
                          <TableCell>{row.status}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="invoices">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Invoices in period</CardTitle>
                <CardDescription>
                  Billed {money(summary.overview.invoicesBilled)} · Paid{" "}
                  {money(summary.overview.invoicesPaid)} · Pending{" "}
                  {money(summary.overview.invoicesPending)}
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {summary.invoices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No invoices in this period.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {summary.invoices.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium">{row.invoiceNumber}</TableCell>
                          <TableCell>{format(new Date(row.date), "PP")}</TableCell>
                          <TableCell className="capitalize">{row.status}</TableCell>
                          <TableCell className="text-right">{money(row.grandTotal)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="savings" className="space-y-4">
            {summary.savings.prep.unitCount > 0 || summary.savings.prep.paidTotal > 0 ? (
              <div
                className={
                  prepBenchmarkChartData.length > 0
                    ? "grid gap-4 lg:grid-cols-2"
                    : "grid gap-4"
                }
              >
                <Card className="border-violet-200/80 bg-violet-50/30 shadow-sm dark:border-violet-900 dark:bg-violet-950/15">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Scissors className="h-4 w-4 text-violet-600" />
                      Your prep cost vs typical 3PL
                    </CardTitle>
                    <CardDescription>
                      Your estimated PrepCorex total, typical 3PL market pricing for the same
                      units, and your estimated savings. Uses your {summary.savings.prep.profileLabel}{" "}
                      pricing profile.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ValueComparisonBarChart
                      data={prepSummaryChartData}
                      config={prepValueChartConfig}
                      marketTotal={prepSummaryMarketTotal}
                    />
                  </CardContent>
                </Card>

                {prepBenchmarkChartData.length > 0 ? (
                  <Card className="border-slate-200 bg-slate-50/40 shadow-sm dark:border-slate-800 dark:bg-slate-950/20">
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Package className="h-4 w-4 text-slate-600 dark:text-slate-300" />
                        Typical 3PL benchmark by service
                      </CardTitle>
                      <CardDescription>
                        Estimated market cost for each prep service type in this period, based on
                        the same unit volumes and admin benchmark rates.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ValueComparisonBarChart
                        data={prepBenchmarkChartData}
                        config={prepBenchmarkChartConfig}
                        marketTotal={prepBenchmarkMarketTotal}
                      />
                    </CardContent>
                  </Card>
                ) : null}
              </div>
            ) : null}

            <Card className="border-violet-200 bg-violet-50/40 dark:border-violet-900 dark:bg-violet-950/20">
              <CardHeader>
                <CardTitle className="text-base">Estimated savings vs typical 3PL prep rates</CardTitle>
                <CardDescription>
                  Units prepped in this period × your assigned{" "}
                  {summary.savings.prep.profileLabel} pricing table, compared with typical 3PL
                  market rates. Invoice add-ons and extras are not included.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                  title="Units prepped"
                  value={summary.savings.prep.unitCount}
                  icon={<Scissors className="h-4 w-4" />}
                />
                <StatCard
                  title="Your PrepCorex rate (est.)"
                  value={money(summary.savings.prep.paidTotal)}
                  hint={`${summary.savings.prep.unitCount} unit${summary.savings.prep.unitCount === 1 ? "" : "s"} · ${summary.savings.prep.profileLabel} pricing table`}
                  icon={<Receipt className="h-4 w-4" />}
                />
                <StatCard
                  title="Typical 3PL (est.)"
                  value={money(summary.savings.prep.estimatedMarket)}
                  hint={`FBA $${summary.savings.prep.benchmarks.fbaPerUnit.toFixed(2)} · FBM $${summary.savings.prep.benchmarks.fbmPerUnit.toFixed(2)} · X-dock $${summary.savings.prep.benchmarks.crossdockPerUnit.toFixed(2)} · Ret $${summary.savings.prep.benchmarks.returnsPerUnit.toFixed(2)} / unit`}
                  icon={<Package className="h-4 w-4" />}
                />
                <StatCard
                  title="Your est. save on prep"
                  value={money(summary.savings.prep.savedOnPrep)}
                  hint="Estimated save"
                  icon={<PiggyBank className="h-4 w-4" />}
                />
              </CardContent>
            </Card>

            {summary.savings.prep.unitCount > 0 || summary.savings.prep.paidTotal > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {summary.savings.prep.fbaUnitCount > 0 ? (
                  <StatCard
                    title="FBA prep"
                    value={money(summary.savings.prep.paidFba)}
                    hint={`${summary.savings.prep.fbaUnitCount} units · typical ${money(summary.savings.prep.estimatedFba)}`}
                    icon={<Scissors className="h-4 w-4" />}
                  />
                ) : null}
                {summary.savings.prep.fbmUnitCount > 0 ? (
                  <StatCard
                    title="FBM pick/pack"
                    value={money(summary.savings.prep.paidFbm)}
                    hint={`${summary.savings.prep.fbmUnitCount} units · typical ${money(summary.savings.prep.estimatedFbm)}`}
                    icon={<Package className="h-4 w-4" />}
                  />
                ) : null}
                {summary.savings.prep.crossdockUnitCount > 0 ? (
                  <StatCard
                    title="Cross-dock"
                    value={money(summary.savings.prep.paidCrossdock)}
                    hint={`${summary.savings.prep.crossdockUnitCount} units · typical ${money(summary.savings.prep.estimatedCrossdock)}`}
                    icon={<Truck className="h-4 w-4" />}
                  />
                ) : null}
                {summary.savings.prep.returnsUnitCount > 0 ? (
                  <StatCard
                    title="Returns handling"
                    value={money(summary.savings.prep.paidReturns)}
                    hint={`${summary.savings.prep.returnsUnitCount} units · typical ${money(summary.savings.prep.estimatedReturns)}`}
                    icon={<Package className="h-4 w-4" />}
                  />
                ) : null}
              </div>
            ) : null}

            {summary.savings.labelCount > 0 ? (
              <Card className="border-emerald-200/80 bg-emerald-50/30 shadow-sm dark:border-emerald-900 dark:bg-emerald-950/15">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Truck className="h-4 w-4 text-emerald-600" />
                    Paid vs estimated courier totals
                  </CardTitle>
                  <CardDescription>
                    What you paid compared with estimated USPS, UPS, and FedEx totals for the same
                    labels. Lowest total is green, highest is red.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <RankedAmountBarChart data={savingsChartData} />
                </CardContent>
              </Card>
            ) : null}

            <Card className="border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20">
              <CardHeader>
                <CardTitle className="text-base">Estimated savings vs typical courier rates</CardTitle>
                <CardDescription>
                  What you paid in this period, plus estimated save vs approximate USPS / UPS / FedEx
                  prices for the same weight. Estimates, not live quotes.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard title="Labels" value={summary.savings.labelCount} icon={<Truck className="h-4 w-4" />} />
                <StatCard
                  title="You paid"
                  value={money(summary.savings.paidTotal)}
                  hint={`${summary.savings.labelCount} label${summary.savings.labelCount === 1 ? "" : "s"}`}
                  icon={<PiggyBank className="h-4 w-4" />}
                />
                <StatCard
                  title="Your est. save on shipping"
                  value={money(summary.savings.savedOnShipping)}
                  hint="Estimated save"
                  icon={<PiggyBank className="h-4 w-4" />}
                />
              </CardContent>
            </Card>

            {paidBreakdown(summary.savings).length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {paidBreakdown(summary.savings).map((item) => (
                  <StatCard
                    key={item.title}
                    title={item.title}
                    value={money(item.paid)}
                    hint={`${item.count} label${item.count === 1 ? "" : "s"}`}
                    icon={<Truck className="h-4 w-4" />}
                  />
                ))}
              </div>
            ) : null}

            {summary.savings.benchmarks.bands.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Estimated USPS / UPS / FedEx rate card</CardTitle>
                  <CardDescription>
                    Each GOFO label is compared to the band that matches its parcel weight.
                  </CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Weight</TableHead>
                        <TableHead className="text-right">USPS</TableHead>
                        <TableHead className="text-right">UPS</TableHead>
                        <TableHead className="text-right">FedEx</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {summary.savings.benchmarks.bands.map((band) => (
                        <TableRow key={band.label}>
                          <TableCell>{band.label}</TableCell>
                          <TableCell className="text-right">{money(band.usps)}</TableCell>
                          <TableCell className="text-right">{money(band.ups)}</TableCell>
                          <TableCell className="text-right">{money(band.fedex)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Label detail</CardTitle>
                <CardDescription>
                  Each row shows what you paid and the estimated USPS / UPS / FedEx price for that
                  weight, with savings on all three.
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {summary.savings.rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No completed labels in this period.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Tracking</TableHead>
                        <TableHead>Carrier</TableHead>
                        <TableHead className="text-right">Weight</TableHead>
                        <TableHead className="text-right">Paid</TableHead>
                        <TableHead className="text-right">USPS est.</TableHead>
                        <TableHead className="text-right">Saved vs USPS</TableHead>
                        <TableHead className="text-right">UPS est.</TableHead>
                        <TableHead className="text-right">Saved vs UPS</TableHead>
                        <TableHead className="text-right">FedEx est.</TableHead>
                        <TableHead className="text-right">Saved vs FedEx</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {summary.savings.rows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>{format(new Date(row.purchasedAt), "PP")}</TableCell>
                          <TableCell className="font-mono text-xs">{row.trackingNumber || "—"}</TableCell>
                          <TableCell>
                            {row.carrier} · {row.service}
                            <Badge variant="secondary" className="ml-2">
                              {carrierFamilyLabel(row.carrierFamily)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {row.weightLb} lb
                            <span className="block text-[11px]">{row.weightBand}</span>
                          </TableCell>
                          <TableCell className="text-right">{money(row.paid)}</TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            ~{money(row.estimatedUsps)}
                          </TableCell>
                          <TableCell className="text-right font-medium text-emerald-700">
                            {money(row.savedVsUsps)}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            ~{money(row.estimatedUps)}
                          </TableCell>
                          <TableCell className="text-right font-medium text-emerald-700">
                            {money(row.savedVsUps)}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            ~{money(row.estimatedFedex)}
                          </TableCell>
                          <TableCell className="text-right font-medium text-emerald-700">
                            {money(row.savedVsFedex)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
      </CardContent>
    </Card>
  );
}

function StatCard({
  title,
  value,
  hint,
  icon,
}: {
  title: string;
  value: string | number;
  hint?: string;
  icon: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <div className="text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
