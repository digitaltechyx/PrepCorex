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
  ArrowDownToLine,
  ArrowUpFromLine,
  RotateCcw,
  Trash2,
  Boxes,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { buildClientReportCsv } from "@/lib/client-reports-csv";
import type { ClientReportSummary, ClientReportTab } from "@/lib/client-reports-types";
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
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

const activityChartConfig = {
  received: { label: "Received", color: "hsl(142 76% 36%)" },
  shipped: { label: "Shipped", color: "hsl(221 83% 53%)" },
} satisfies ChartConfig;

const savingsChartConfig = {
  amount: { label: "Amount", color: "hsl(221 83% 53%)" },
} satisfies ChartConfig;

function money(n: number): string {
  return `$${n.toFixed(2)}`;
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
  const [preset, setPreset] = useState<"this_month" | "last_30" | "last_month" | "custom" | "all">("this_month");
  const [fromDate, setFromDate] = useState<Date | undefined>(startOfMonth(new Date()));
  const [toDate, setToDate] = useState<Date | undefined>(endOfMonth(new Date()));
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
        params.set("from", fromDate.toISOString());
        params.set("to", toDate.toISOString());
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
    return [
      { name: "PrepCorex GOFO", amount: s.paidGofo },
      { name: "USPS (est.)", amount: s.estimatedUsps },
      { name: "UPS (est.)", amount: s.estimatedUps },
      { name: "FedEx (est.)", amount: s.estimatedFedex },
    ];
  }, [summary]);

  function handleExport() {
    if (!summary) return;
    const csv = buildClientReportCsv(summary, tab);
    const stamp = summary.period.allTime ? "all-time" : format(new Date(summary.period.from), "yyyy-MM-dd");
    downloadCsv(`prepcorex-report-${tab}-${stamp}.csv`, csv);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Period</p>
            <Select
              value={preset}
              onValueChange={(v) => setPreset(v as typeof preset)}
            >
              <SelectTrigger className="w-[180px]">
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
          {preset === "custom" ? (
            <div className="w-full sm:w-[280px]">
              <DateRangePicker
                fromDate={fromDate}
                toDate={toDate}
                setFromDate={setFromDate}
                setToDate={setToDate}
              />
            </div>
          ) : null}
        </div>
        <Button variant="outline" onClick={handleExport} disabled={!summary || loading}>
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Download CSV
        </Button>
      </div>

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
              <PiggyBank className="h-4 w-4" /> Label savings
            </TabsTrigger>
          </TabsList>

          <p className="text-sm text-muted-foreground">
            {summary.period.label}
            {loading ? (
              <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin" />
            ) : null}
          </p>

          <TabsContent value="overview" className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                title="Received"
                value={summary.overview.unitsReceived}
                icon={<ArrowDownToLine className="h-4 w-4" />}
              />
              <StatCard
                title="Shipped"
                value={summary.overview.unitsShipped}
                icon={<ArrowUpFromLine className="h-4 w-4" />}
              />
              <StatCard
                title="On hand"
                value={summary.overview.currentOnHand}
                hint={
                  summary.overview.currentDamaged
                    ? `${summary.overview.currentDamaged} damaged`
                    : "Current snapshot"
                }
                icon={<Boxes className="h-4 w-4" />}
              />
              <StatCard
                title="Invoices billed"
                value={money(summary.overview.invoicesBilled)}
                hint={`${summary.overview.pendingCount} pending · ${money(summary.overview.invoicesPending)}`}
                icon={<Receipt className="h-4 w-4" />}
              />
              <StatCard
                title="Returns"
                value={summary.overview.unitsReturned}
                hint={`${summary.overview.returnsHandled} closed`}
                icon={<RotateCcw className="h-4 w-4" />}
              />
              <StatCard
                title="Disposed"
                value={summary.overview.unitsDisposed}
                icon={<Trash2 className="h-4 w-4" />}
              />
              <StatCard
                title="Paid invoices"
                value={money(summary.overview.invoicesPaid)}
                hint={`${summary.overview.paidCount} paid`}
                icon={<Receipt className="h-4 w-4" />}
              />
              <StatCard
                title="Est. saved vs USPS"
                value={money(summary.savings.savedVsUsps)}
                hint={`${summary.savings.gofoLabelCount} GOFO labels`}
                icon={<PiggyBank className="h-4 w-4" />}
              />
            </div>
            {summary.charts.activityByDay.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Received vs shipped</CardTitle>
                  <CardDescription>Units in the selected period</CardDescription>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={activityChartConfig} className="h-[260px] w-full">
                    <BarChart data={summary.charts.activityByDay}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                      <YAxis tickLine={false} axisLine={false} fontSize={12} allowDecimals={false} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="received" fill="var(--color-received)" radius={4} />
                      <Bar dataKey="shipped" fill="var(--color-shipped)" radius={4} />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
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
            <Card className="border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20">
              <CardHeader>
                <CardTitle className="text-base">Estimated savings vs typical courier rates</CardTitle>
                <CardDescription>
                  PrepCorex GOFO paid vs approximate USPS / UPS / FedEx Ground-style rates (
                  {money(summary.savings.benchmarks.usps)} / {money(summary.savings.benchmarks.ups)} /{" "}
                  {money(summary.savings.benchmarks.fedex)} per label). These are estimates, not live quotes.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard title="GOFO labels" value={summary.savings.gofoLabelCount} icon={<Truck className="h-4 w-4" />} />
                <StatCard
                  title="You paid (GOFO)"
                  value={money(summary.savings.paidGofo)}
                  hint={`Avg ${money(summary.savings.averagePaidGofo)}`}
                  icon={<PiggyBank className="h-4 w-4" />}
                />
                <StatCard
                  title="Saved vs USPS"
                  value={money(summary.savings.savedVsUsps)}
                  hint={`Would be ~${money(summary.savings.estimatedUsps)}`}
                  icon={<PiggyBank className="h-4 w-4" />}
                />
                <StatCard
                  title="Saved vs UPS"
                  value={money(summary.savings.savedVsUps)}
                  hint={`Would be ~${money(summary.savings.estimatedUps)}`}
                  icon={<PiggyBank className="h-4 w-4" />}
                />
              </CardContent>
            </Card>

            {summary.savings.gofoLabelCount > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Paid vs estimated courier totals</CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={savingsChartConfig} className="h-[240px] w-full">
                    <BarChart data={savingsChartData}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                      <YAxis tickLine={false} axisLine={false} fontSize={12} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="amount" fill="var(--color-amount)" radius={4} />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Label detail</CardTitle>
                <CardDescription>
                  Savings apply to PrepCorex GOFO labels only. Shippo / other carriers show $0 saved.
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {summary.savings.rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No completed labels in this period. Buy a GOFO label to see estimated savings.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Tracking</TableHead>
                        <TableHead>Carrier</TableHead>
                        <TableHead className="text-right">Paid</TableHead>
                        <TableHead className="text-right">USPS est.</TableHead>
                        <TableHead className="text-right">Saved vs USPS</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {summary.savings.rows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>{format(new Date(row.purchasedAt), "PP")}</TableCell>
                          <TableCell className="font-mono text-xs">{row.trackingNumber || "—"}</TableCell>
                          <TableCell>
                            {row.carrier} · {row.service}
                            {row.isGofo ? (
                              <Badge variant="secondary" className="ml-2">
                                GOFO
                              </Badge>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right">{money(row.paid)}</TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {row.isGofo ? `~${money(row.estimatedUsps)}` : "—"}
                          </TableCell>
                          <TableCell className="text-right font-medium text-emerald-700">
                            {row.isGofo ? money(row.savedVsUsps) : money(0)}
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
    </div>
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
