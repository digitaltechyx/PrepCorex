"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import {
  BarChart3,
  FileSpreadsheet,
  FileText,
  Loader2,
  TrendingDown,
  TrendingUp,
  Wallet,
  Package,
  Coins,
  ScrollText,
  Activity,
  Handshake,
  Send,
  ArrowDownToLine,
  ArrowUpFromLine,
  RotateCcw,
  Trash2,
  GitCompare,
  Layers,
} from "lucide-react";
import { auth } from "@/lib/firebase";
import type { UserProfile } from "@/types";
import type {
  AdminReportComparisonSummary,
  AdminReportSummary,
  AdminReportType,
  AgentStatementSummary,
} from "@/lib/admin-reports-types";
import { filterActivitiesByReportType, moduleLabel } from "@/lib/admin-reports-modules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getUserRoles } from "@/lib/permissions";

const REPORT_TABS: { value: AdminReportType; label: string; icon: React.ReactNode }[] = [
  { value: "full", label: "Full Report", icon: <Layers className="h-4 w-4" /> },
  { value: "overview", label: "Overview", icon: <BarChart3 className="h-4 w-4" /> },
  { value: "inbound", label: "Inbound", icon: <ArrowDownToLine className="h-4 w-4" /> },
  { value: "outbound", label: "Outbound", icon: <ArrowUpFromLine className="h-4 w-4" /> },
  { value: "returns", label: "Returns", icon: <RotateCcw className="h-4 w-4" /> },
  { value: "dispose", label: "Dispose", icon: <Trash2 className="h-4 w-4" /> },
  { value: "financial", label: "Financial", icon: <Wallet className="h-4 w-4" /> },
  { value: "commission", label: "Commission", icon: <Coins className="h-4 w-4" /> },
  { value: "client_activity", label: "Client Activity", icon: <Activity className="h-4 w-4" /> },
  { value: "operations", label: "Operations", icon: <Package className="h-4 w-4" /> },
  { value: "comparison", label: "Compare", icon: <GitCompare className="h-4 w-4" /> },
  { value: "audit", label: "Audit", icon: <ScrollText className="h-4 w-4" /> },
];

interface ReportsDashboardProps {
  users: UserProfile[];
}

export function ReportsDashboard({ users }: ReportsDashboardProps) {
  const { toast } = useToast();
  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date | undefined>(undefined);
  const [compareFromDate, setCompareFromDate] = useState<Date | undefined>(undefined);
  const [compareToDate, setCompareToDate] = useState<Date | undefined>(undefined);
  const [clientId, setClientId] = useState<string>("all");
  const [agentId, setAgentId] = useState<string>("none");
  const [reportTab, setReportTab] = useState<AdminReportType>("full");
  const [summary, setSummary] = useState<AdminReportSummary | null>(null);
  const [comparison, setComparison] = useState<AdminReportComparisonSummary | null>(null);
  const [agentStatement, setAgentStatement] = useState<AgentStatementSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingClientPdf, setExportingClientPdf] = useState(false);
  const [exportingClientCsv, setExportingClientCsv] = useState(false);
  const [exportingAgentPdf, setExportingAgentPdf] = useState(false);
  const [exportingAgentCsv, setExportingAgentCsv] = useState(false);

  const clientOptions = useMemo(() => {
    return users
      .filter((u) => {
        if (!u.uid || u.status === "deleted") return false;
        const roles = getUserRoles(u);
        if (roles.includes("admin") || roles.includes("sub_admin")) return false;
        if (roles.includes("commission_agent") && !roles.includes("user")) return false;
        return true;
      })
      .sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || ""));
  }, [users]);

  const agentOptions = useMemo(() => {
    return users
      .filter((u) => {
        if (!u.uid || u.status === "deleted") return false;
        return getUserRoles(u).includes("commission_agent");
      })
      .sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || ""));
  }, [users]);

  const hasDateRange = Boolean(fromDate && toDate);
  const hasCompareRange = Boolean(compareFromDate && compareToDate);
  const canCompare = hasDateRange && hasCompareRange;

  const buildQuery = useCallback(
    (extra?: Record<string, string>) => {
      const params = new URLSearchParams();
      if (fromDate && toDate) {
        params.set("from", fromDate.toISOString());
        params.set("to", toDate.toISOString());
      }
      if (compareFromDate && compareToDate) {
        params.set("compareFrom", compareFromDate.toISOString());
        params.set("compareTo", compareToDate.toISOString());
      }
      if (clientId !== "all") params.set("clientId", clientId);
      if (agentId !== "none") params.set("agentId", agentId);
      params.set("reportType", reportTab);
      if (extra) Object.entries(extra).forEach(([k, v]) => params.set(k, v));
      return params.toString();
    },
    [agentId, clientId, compareFromDate, compareToDate, fromDate, reportTab, toDate]
  );

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated");
      const res = await fetch(`/api/admin/reports/summary?${buildQuery()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load report");
      setSummary(data.summary);
      setAgentStatement(data.agentStatement || null);

      if (canCompare) {
        const compareParams = new URLSearchParams();
        compareParams.set("from", fromDate!.toISOString());
        compareParams.set("to", toDate!.toISOString());
        compareParams.set("compareFrom", compareFromDate!.toISOString());
        compareParams.set("compareTo", compareToDate!.toISOString());
        if (clientId !== "all") compareParams.set("clientId", clientId);
        const compareRes = await fetch(`/api/admin/reports/compare?${compareParams}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const compareData = await compareRes.json();
        setComparison(compareRes.ok ? compareData.comparison : null);
      } else {
        setComparison(null);
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not load report",
        description: err instanceof Error ? err.message : "Unknown error",
      });
      setSummary(null);
      setComparison(null);
      setAgentStatement(null);
    } finally {
      setLoading(false);
    }
  }, [buildQuery, canCompare, clientId, compareFromDate, compareToDate, fromDate, toDate, toast]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    if (clientId === "all") {
      setAgentId("none");
    }
  }, [clientId]);

  useEffect(() => {
    if (clientId !== "all" && summary?.referringAgent?.agentId) {
      setAgentId(summary.referringAgent.agentId);
    }
  }, [clientId, summary?.referringAgent?.agentId]);

  const handleExport = async (type: "csv" | "pdf", exportReportType: AdminReportType = reportTab) => {
    if (exportReportType === "comparison" && !canCompare) {
      toast({
        variant: "destructive",
        title: "Comparison export unavailable",
        description: "Select Period A and Period B date ranges to export a comparison report.",
      });
      return;
    }
    const setBusy = type === "csv" ? setExportingCsv : setExportingPdf;
    setBusy(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated");
      const path = type === "csv" ? "/api/admin/reports/export/csv" : "/api/admin/reports/export/pdf";
      const params = new URLSearchParams(buildQuery());
      params.set("reportType", exportReportType);
      const res = await fetch(`${path}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || data.error || "Export failed");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] || `report.${type}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({
        title: type === "csv" ? "CSV downloaded" : "PDF downloaded",
        description: `${moduleLabel(exportReportType)} report`,
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Export failed",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleStatementExport = async (
    kind: "client" | "agent",
    format: "csv" | "pdf"
  ) => {
    const setBusy =
      kind === "client"
        ? format === "csv"
          ? setExportingClientCsv
          : setExportingClientPdf
        : format === "csv"
          ? setExportingAgentCsv
          : setExportingAgentPdf;

    if (kind === "client" && clientId === "all") {
      toast({
        variant: "destructive",
        title: "Select a client",
        description: "Choose one client before exporting a client statement.",
      });
      return;
    }
    if (kind === "agent" && agentId === "none") {
      toast({
        variant: "destructive",
        title: "Select an agent",
        description: "Choose a commission agent before exporting an agent statement.",
      });
      return;
    }

    setBusy(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated");
      const params = new URLSearchParams();
      if (fromDate && toDate) {
        params.set("from", fromDate.toISOString());
        params.set("to", toDate.toISOString());
      }
      params.set("format", format);
      if (kind === "client") params.set("clientId", clientId);
      else params.set("agentId", agentId);

      const path =
        kind === "client"
          ? "/api/admin/reports/export/client-statement"
          : "/api/admin/reports/export/agent-statement";

      const res = await fetch(`${path}?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || data.error || "Export failed");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] || `${kind}-statement.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({
        title:
          kind === "client"
            ? "Client statement ready to share"
            : "Agent statement downloaded",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Export failed",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setBusy(false);
    }
  };

  const applyPreset = (preset: "this_month" | "last_month") => {
    if (preset === "this_month") {
      setFromDate(startOfMonth(new Date()));
      setToDate(endOfMonth(new Date()));
    } else {
      const d = subMonths(new Date(), 1);
      setFromDate(startOfMonth(d));
      setToDate(endOfMonth(d));
    }
  };

  const revenueChartConfig = {
    value: { label: "Revenue", color: "#4f46e5" },
  } satisfies ChartConfig;

  const activityChartConfig = {
    shipped: { label: "Shipped", color: "#3b82f6" },
    received: { label: "Inbound Received", color: "#a855f7" },
    requests: { label: "Requests", color: "#22c55e" },
  } satisfies ChartConfig;

  return (
    <div className="space-y-6">
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-5 space-y-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-1">
              <h3 className="text-lg font-semibold">Report Filters</h3>
              <p className="text-sm text-muted-foreground">
                Pick a date range to filter by period, or leave dates empty for all-time totals. Select one client for a custom client report. Use Period B below for side-by-side comparison.
              </p>
              {!hasDateRange && (
                <p className="text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md px-3 py-2">
                  No date range selected — stat cards and tables show <span className="font-semibold">all-time</span> totals.
                </p>
              )}
              {hasDateRange && summary && (
                <p className="text-xs text-muted-foreground">
                  Filtered period: <span className="font-medium text-foreground">{summary.period.label}</span>
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => applyPreset("this_month")}>
                This month
              </Button>
              <Button variant="outline" size="sm" onClick={() => applyPreset("last_month")}>
                Last month
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setFromDate(undefined);
                  setToDate(undefined);
                }}
              >
                All time
              </Button>
              <Button variant="outline" size="sm" onClick={() => void loadSummary()} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleExport("csv", reportTab)}
                disabled={exportingCsv || loading}
                title={`Export ${moduleLabel(reportTab)} as CSV`}
              >
                {exportingCsv ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FileSpreadsheet className="h-4 w-4 mr-1" />}
                {moduleLabel(reportTab)} CSV
              </Button>
              <Button
                size="sm"
                onClick={() => void handleExport("pdf", reportTab)}
                disabled={exportingPdf || loading}
                title={`Export ${moduleLabel(reportTab)} as PDF`}
              >
                {exportingPdf ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FileText className="h-4 w-4 mr-1" />}
                {moduleLabel(reportTab)} PDF
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Period A (primary)</p>
              <DateRangePicker
                fromDate={fromDate}
                toDate={toDate}
                setFromDate={setFromDate}
                setToDate={setToDate}
                className="w-full lg:w-auto"
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Period B (compare)</p>
              <DateRangePicker
                fromDate={compareFromDate}
                toDate={compareToDate}
                setFromDate={setCompareFromDate}
                setToDate={setCompareToDate}
                className="w-full lg:w-auto"
              />
            </div>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger className="w-full lg:w-[280px]">
                <SelectValue placeholder="All clients" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All clients</SelectItem>
                {clientOptions.map((c) => (
                  <SelectItem key={c.uid} value={c.uid!}>
                    {c.name || c.email} {c.clientId ? `(${c.clientId})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger className="w-full lg:w-[280px]">
                <SelectValue placeholder="Commission agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No agent selected</SelectItem>
                {agentOptions.map((a) => (
                  <SelectItem key={a.uid} value={a.uid!}>
                    {a.name || a.email} {a.referralCode ? `· ${a.referralCode}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {canCompare && (
            <p className="text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md px-3 py-2">
              Comparison ready: <span className="font-medium">{comparison?.periodA.label}</span> vs{" "}
              <span className="font-medium">{comparison?.periodB.label}</span>
              {clientId !== "all" && summary?.scope.clientName ? ` · ${summary.scope.clientName}` : ""}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50/50 to-white">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Send className="h-5 w-5 text-emerald-600" />
              <h4 className="font-semibold">Client Statement</h4>
              <Badge variant="outline" className="text-xs">Share with client</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Client-safe PDF or CSV: what they invested, services PrepCorex delivered, invoices, and activity — no internal audit or commission data.
            </p>
            {clientId === "all" ? (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                Select one client above to enable client statement export.
              </p>
            ) : (
              <p className="text-xs text-emerald-700">
                Ready for: <span className="font-medium">{summary?.scope.clientName || "selected client"}</span>
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={clientId === "all" || exportingClientCsv}
                onClick={() => void handleStatementExport("client", "csv")}
              >
                {exportingClientCsv ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FileSpreadsheet className="h-4 w-4 mr-1" />}
                Client CSV
              </Button>
              <Button
                size="sm"
                disabled={clientId === "all" || exportingClientPdf}
                onClick={() => void handleStatementExport("client", "pdf")}
              >
                {exportingClientPdf ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FileText className="h-4 w-4 mr-1" />}
                Client PDF
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-violet-200 bg-gradient-to-br from-violet-50/50 to-white">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Handshake className="h-5 w-5 text-violet-600" />
              <h4 className="font-semibold">Commission Agent Statement</h4>
              <Badge variant="outline" className="text-xs">Share with agent</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Partner statement with tier, earnings, referred clients, and commission breakdown per invoice.
            </p>
            {summary?.referringAgent && clientId !== "all" && (
              <p className="text-xs text-violet-700 bg-violet-50 border border-violet-200 rounded-md px-3 py-2">
                This client was referred by{" "}
                <span className="font-medium">{summary.referringAgent.agentName}</span>
                {summary.referringAgent.referralCode ? ` (${summary.referringAgent.referralCode})` : ""}.
              </p>
            )}
            {agentId === "none" ? (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                Select a commission agent above to export their partner statement.
              </p>
            ) : agentStatement ? (
              <p className="text-xs text-violet-700">
                {agentStatement.agent.name} · {agentStatement.agent.tier} ({agentStatement.agent.rate}%) ·{" "}
                ${agentStatement.earnings.totalEarned.toFixed(2)} earned this period
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={agentId === "none" || exportingAgentCsv}
                onClick={() => void handleStatementExport("agent", "csv")}
              >
                {exportingAgentCsv ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FileSpreadsheet className="h-4 w-4 mr-1" />}
                Agent CSV
              </Button>
              <Button
                size="sm"
                disabled={agentId === "none" || exportingAgentPdf}
                onClick={() => void handleStatementExport("agent", "pdf")}
              >
                {exportingAgentPdf ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FileText className="h-4 w-4 mr-1" />}
                Agent PDF
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {agentStatement && agentId !== "none" && (
        <Card className="border-violet-100">
          <CardContent className="p-5">
            <h4 className="font-semibold mb-3 flex items-center gap-2">
              <Handshake className="h-4 w-4 text-violet-600" />
              Agent Preview — {agentStatement.agent.name}
            </h4>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <MiniStat label="Tier" value={`${agentStatement.agent.tier} · ${agentStatement.agent.rate}%`} />
              <MiniStat label="Earned" value={`$${agentStatement.earnings.totalEarned.toFixed(2)}`} accent="text-violet-700" />
              <MiniStat label="Pending" value={`$${agentStatement.earnings.totalPending.toFixed(2)}`} accent="text-amber-700" />
              <MiniStat label="Referred clients" value={String(agentStatement.clients.totalReferred)} />
              <MiniStat label="Active this period" value={String(agentStatement.clients.activeInPeriod)} />
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
          <Skeleton className="h-72" />
        </div>
      ) : summary ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
            <KpiCard
              icon={<ArrowDownToLine className="h-5 w-5" />}
              label="Lifetime Inbound"
              value={String(summary.clientActivity.lifetimeInboundReceived)}
              sub={`${summary.clientActivity.inventoryRequests} inbound requests · approved receipts`}
              accent="text-purple-700"
            />
            <KpiCard
              icon={<Package className="h-5 w-5" />}
              label="Stock On Hand"
              value={String(summary.clientActivity.currentStockOnHand)}
              sub="Current warehouse inventory (live snapshot)"
              accent="text-violet-700"
            />
            <KpiCard
              icon={<ArrowUpFromLine className="h-5 w-5" />}
              label="Units Shipped"
              value={String(summary.clientActivity.unitsShipped)}
              sub={`${summary.clientActivity.shipmentRequests} outbound requests · lifetime shipped`}
              accent="text-blue-700"
            />
            <KpiCard
              icon={<Trash2 className="h-5 w-5" />}
              label="Units Disposed"
              value={String(summary.clientActivity.unitsDisposed)}
              sub={`${summary.clientActivity.disposeRequests} dispose requests`}
              accent="text-rose-700"
            />
            <KpiCard
              icon={<RotateCcw className="h-5 w-5" />}
              label="Returns Handled"
              value={String(summary.clientActivity.returnsHandled)}
              sub={`${summary.clientActivity.unitsReturned} units returned`}
              accent="text-amber-700"
            />
            <KpiCard
              icon={<Wallet className="h-5 w-5" />}
              label="Financial"
              value={`$${summary.financial.totalBilled.toFixed(2)}`}
              sub={`$${summary.financial.totalPaid.toFixed(2)} paid · ${summary.financial.invoiceCount} invoices`}
              growth={summary.period.allTime ? undefined : summary.growth.revenueChangePct}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              icon={<Coins className="h-5 w-5" />}
              label="Commissions"
              value={`$${summary.commission.totalEarned.toFixed(2)}`}
              sub={`${summary.commission.commissionCount} records`}
              accent="text-violet-700"
            />
            <KpiCard
              icon={<Activity className="h-5 w-5" />}
              label="Active Clients"
              value={String(summary.clientActivity.activeClients)}
              sub={summary.scope.allClients ? "All clients in scope" : summary.scope.clientName || "Selected client"}
            />
            <KpiCard
              icon={<TrendingUp className="h-5 w-5" />}
              label="Pending Revenue"
              value={`$${summary.financial.totalPending.toFixed(2)}`}
              sub="Unpaid invoices"
              accent="text-emerald-700"
            />
            <KpiCard
              icon={<Package className="h-5 w-5" />}
              label="Return Requests"
              value={String(summary.clientActivity.returns)}
              sub="All return requests in period"
            />
          </div>

          <Card className="border-indigo-100 bg-gradient-to-br from-indigo-50/80 to-violet-50/50">
            <CardContent className="p-5">
              <h4 className="font-semibold text-slate-900 mb-1">Client Value Exchange</h4>
              <p className="text-sm text-muted-foreground mb-4">
                What the client gives PrepCorex vs. what we fulfill — use this view when reviewing client growth and partnership value.
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <ValueTile title="They give us" items={[
                  { label: "Billed", value: `$${summary.financial.totalBilled.toFixed(2)}` },
                  { label: "Paid", value: `$${summary.financial.totalPaid.toFixed(2)}` },
                ]} />
                <ValueTile title="We fulfill" items={[
                  { label: "Lifetime inbound", value: String(summary.clientActivity.lifetimeInboundReceived) },
                  { label: "Stock on hand", value: String(summary.clientActivity.currentStockOnHand) },
                  { label: "Units shipped", value: String(summary.clientActivity.unitsShipped) },
                  { label: "Units disposed", value: String(summary.clientActivity.unitsDisposed) },
                  { label: "Returns handled", value: String(summary.clientActivity.returnsHandled) },
                ]} />
                <ValueTile title="They request" items={[
                  { label: "Shipments", value: String(summary.clientActivity.shipmentRequests) },
                  { label: "Inventory", value: String(summary.clientActivity.inventoryRequests) },
                  { label: "Returns", value: String(summary.clientActivity.returns) },
                ]} />
                <ValueTile title="Growth signals" items={[
                  { label: "Revenue vs prior", value: formatGrowth(summary.growth.revenueChangePct) },
                  { label: "Clients active", value: String(summary.clientActivity.activeClients) },
                ]} />
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardContent className="p-5">
                <h4 className="font-semibold mb-3">
                  {summary.period.allTime ? "Monthly Revenue Trend (last 24 months)" : "Revenue Trend"}
                </h4>
                <ChartContainer config={revenueChartConfig} className="h-[240px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={summary.charts.revenueByDay}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="value" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <h4 className="font-semibold mb-3">
                  {summary.period.allTime ? "Monthly Activity Trend (last 24 months)" : "Activity Trend"}
                </h4>
                <ChartContainer config={activityChartConfig} className="h-[240px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={summary.charts.activityByDay}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Legend />
                      <Bar dataKey="shipped" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="received" fill="#a855f7" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="requests" fill="#22c55e" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>

          <Tabs value={reportTab} onValueChange={(v) => setReportTab(v as AdminReportType)}>
            <TabsList className="flex flex-wrap h-auto gap-1">
              {REPORT_TABS.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5">
                  {tab.icon}
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="full" className="mt-4 space-y-4">
              <ReportExportBar
                reportType="full"
                onExportCsv={() => void handleExport("csv", "full")}
                onExportPdf={() => void handleExport("pdf", "full")}
                exportingCsv={exportingCsv}
                exportingPdf={exportingPdf}
              />
              <Card className="border-slate-200">
                <CardContent className="p-5">
                  <h4 className="font-semibold mb-3">Full Report Summary</h4>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                    <MiniStat label="Lifetime Inbound" value={String(summary.clientActivity.lifetimeInboundReceived)} accent="text-purple-700" />
                    <MiniStat label="Stock On Hand" value={String(summary.clientActivity.currentStockOnHand)} accent="text-violet-700" />
                    <MiniStat label="Units Shipped" value={String(summary.clientActivity.unitsShipped)} accent="text-blue-700" />
                    <MiniStat label="Units Disposed" value={String(summary.clientActivity.unitsDisposed)} accent="text-rose-700" />
                    <MiniStat label="Returns Handled" value={String(summary.clientActivity.returnsHandled)} accent="text-amber-700" />
                    <MiniStat label="Total Billed" value={`$${summary.financial.totalBilled.toFixed(2)}`} accent="text-indigo-700" />
                  </div>
                </CardContent>
              </Card>
              <DetailTable
                title="All Activity"
                headers={["Client", "Type", "Description", "Qty", "Status", "Date"]}
                rows={summary.rows.activities.slice(0, 150).map((r) => [
                  r.clientName,
                  r.type,
                  r.description,
                  r.quantity?.toString() || "—",
                  r.status || "—",
                  format(new Date(r.occurredAt), "MMM d, yyyy"),
                ])}
              />
              <DetailTable
                title="Invoices"
                headers={["Client", "Invoice", "Date", "Status", "Amount"]}
                rows={summary.rows.invoices.map((r) => [
                  r.clientName,
                  r.invoiceNumber,
                  r.date,
                  r.status,
                  `$${r.grandTotal.toFixed(2)}`,
                ])}
              />
            </TabsContent>

            <TabsContent value="overview" className="mt-4 space-y-4">
              <ReportExportBar
                reportType="overview"
                onExportCsv={() => void handleExport("csv", "overview")}
                onExportPdf={() => void handleExport("pdf", "overview")}
                exportingCsv={exportingCsv}
                exportingPdf={exportingPdf}
              />
              <DetailTable
                title="Recent Invoices"
                headers={["Client", "Invoice", "Date", "Status", "Amount"]}
                rows={summary.rows.invoices.slice(0, 15).map((r) => [
                  r.clientName,
                  r.invoiceNumber,
                  r.date,
                  r.status,
                  `$${r.grandTotal.toFixed(2)}`,
                ])}
              />
            </TabsContent>

            <TabsContent value="inbound" className="mt-4">
              <ModuleReportPanel
                title="Inbound Report"
                reportType="inbound"
                onExportCsv={() => void handleExport("csv", "inbound")}
                onExportPdf={() => void handleExport("pdf", "inbound")}
                exportingCsv={exportingCsv}
                exportingPdf={exportingPdf}
                stats={[
                  { label: "Lifetime Inbound", value: String(summary.clientActivity.lifetimeInboundReceived) },
                  { label: "Stock On Hand", value: String(summary.clientActivity.currentStockOnHand) },
                  { label: "Inventory Requests", value: String(summary.clientActivity.inventoryRequests) },
                ]}
                activities={filterActivitiesByReportType(summary.rows.activities, "inbound")}
              />
            </TabsContent>

            <TabsContent value="outbound" className="mt-4">
              <ModuleReportPanel
                title="Outbound Report"
                reportType="outbound"
                onExportCsv={() => void handleExport("csv", "outbound")}
                onExportPdf={() => void handleExport("pdf", "outbound")}
                exportingCsv={exportingCsv}
                exportingPdf={exportingPdf}
                stats={[
                  { label: "Units Shipped", value: String(summary.clientActivity.unitsShipped) },
                  { label: "Shipment Requests", value: String(summary.clientActivity.shipmentRequests) },
                ]}
                activities={filterActivitiesByReportType(summary.rows.activities, "outbound")}
              />
            </TabsContent>

            <TabsContent value="returns" className="mt-4">
              <ModuleReportPanel
                title="Product Returns Report"
                reportType="returns"
                onExportCsv={() => void handleExport("csv", "returns")}
                onExportPdf={() => void handleExport("pdf", "returns")}
                exportingCsv={exportingCsv}
                exportingPdf={exportingPdf}
                stats={[
                  { label: "Returns Handled", value: String(summary.clientActivity.returnsHandled) },
                  { label: "Units Returned", value: String(summary.clientActivity.unitsReturned) },
                  { label: "Return Requests", value: String(summary.clientActivity.returns) },
                ]}
                activities={filterActivitiesByReportType(summary.rows.activities, "returns")}
              />
            </TabsContent>

            <TabsContent value="dispose" className="mt-4">
              <ModuleReportPanel
                title="Dispose Report"
                reportType="dispose"
                onExportCsv={() => void handleExport("csv", "dispose")}
                onExportPdf={() => void handleExport("pdf", "dispose")}
                exportingCsv={exportingCsv}
                exportingPdf={exportingPdf}
                stats={[
                  { label: "Units Disposed", value: String(summary.clientActivity.unitsDisposed) },
                  { label: "Dispose Requests", value: String(summary.clientActivity.disposeRequests) },
                ]}
                activities={filterActivitiesByReportType(summary.rows.activities, "dispose")}
              />
            </TabsContent>

            <TabsContent value="financial" className="mt-4 space-y-4">
              <ReportExportBar
                reportType="financial"
                onExportCsv={() => void handleExport("csv", "financial")}
                onExportPdf={() => void handleExport("pdf", "financial")}
                exportingCsv={exportingCsv}
                exportingPdf={exportingPdf}
              />
              <DetailTable
                title="Invoice Detail (CSV export includes full list)"
                headers={["Client", "Invoice", "Date", "Status", "Subtotal", "Total"]}
                rows={summary.rows.invoices.map((r) => [
                  r.clientName,
                  r.invoiceNumber,
                  r.date,
                  r.status,
                  `$${r.subtotal.toFixed(2)}`,
                  `$${r.grandTotal.toFixed(2)}`,
                ])}
              />
            </TabsContent>

            <TabsContent value="commission" className="mt-4 space-y-4">
              <ReportExportBar
                reportType="commission"
                onExportCsv={() => void handleExport("csv", "commission")}
                onExportPdf={() => void handleExport("pdf", "commission")}
                exportingCsv={exportingCsv}
                exportingPdf={exportingPdf}
              />
              <DetailTable
                title="Commission Detail"
                headers={["Agent", "Client", "Invoice", "Rate", "Commission", "Status"]}
                rows={summary.rows.commissions.map((r) => [
                  r.agentName,
                  r.clientName,
                  r.invoiceNumber,
                  r.commissionRate ? `${r.commissionRate}%` : "—",
                  `$${r.commissionAmount.toFixed(2)}`,
                  r.status,
                ])}
              />
            </TabsContent>

            <TabsContent value="client_activity" className="mt-4 space-y-4">
              <ReportExportBar
                reportType="client_activity"
                onExportCsv={() => void handleExport("csv", "client_activity")}
                onExportPdf={() => void handleExport("pdf", "client_activity")}
                exportingCsv={exportingCsv}
                exportingPdf={exportingPdf}
              />
              <DetailTable
                title="Client Activity Log"
                headers={["Client", "Type", "Description", "Qty", "Date"]}
                rows={summary.rows.activities.slice(0, 100).map((r) => [
                  r.clientName,
                  r.type,
                  r.description,
                  r.quantity?.toString() || "—",
                  format(new Date(r.occurredAt), "MMM d, yyyy"),
                ])}
              />
            </TabsContent>

            <TabsContent value="operations" className="mt-4 space-y-4">
              <ReportExportBar
                reportType="operations"
                onExportCsv={() => void handleExport("csv", "operations")}
                onExportPdf={() => void handleExport("pdf", "operations")}
                exportingCsv={exportingCsv}
                exportingPdf={exportingPdf}
              />
              <div className="grid gap-3 sm:grid-cols-4 mb-4">
                {summary.charts.requestMix.map((m) => (
                  <Card key={m.type}>
                    <CardContent className="p-4 text-center">
                      <p className="text-2xl font-bold">{m.count}</p>
                      <p className="text-xs text-muted-foreground">{m.type}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <DetailTable
                title="Operations Activity"
                headers={["Client", "Type", "Status", "Date"]}
                rows={summary.rows.activities.map((r) => [
                  r.clientName,
                  r.type,
                  r.status || "—",
                  format(new Date(r.occurredAt), "MMM d, yyyy"),
                ])}
              />
            </TabsContent>

            <TabsContent value="comparison" className="mt-4 space-y-4">
              {canCompare ? (
                <ReportExportBar
                  reportType="comparison"
                  onExportCsv={() => void handleExport("csv", "comparison")}
                  onExportPdf={() => void handleExport("pdf", "comparison")}
                  exportingCsv={exportingCsv}
                  exportingPdf={exportingPdf}
                />
              ) : null}
              {!canCompare ? (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground space-y-2">
                    <GitCompare className="h-8 w-8 mx-auto text-slate-400" />
                    <p className="font-medium">Set both date ranges to compare periods</p>
                    <p className="text-sm">
                      Period A (primary) and Period B (compare) are required — e.g. Jan vs Feb, or Q1 vs Q2.
                    </p>
                  </CardContent>
                </Card>
              ) : comparison ? (
                <ComparisonPanel comparison={comparison} />
              ) : (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground">
                    Loading comparison…
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="audit" className="mt-4 space-y-4">
              <ReportExportBar
                reportType="audit"
                onExportCsv={() => void handleExport("csv", "audit")}
                onExportPdf={() => void handleExport("pdf", "audit")}
                exportingCsv={exportingCsv}
                exportingPdf={exportingPdf}
              />
              <DetailTable
                title="Audit Trail"
                headers={["Module", "Event", "Description", "Client/Agent", "Date"]}
                rows={summary.rows.audit.map((r) => [
                  r.module,
                  r.eventType,
                  r.description,
                  r.clientName || r.agentName || "—",
                  format(new Date(r.occurredAt), "MMM d, yyyy HH:mm"),
                ])}
              />
            </TabsContent>
          </Tabs>
        </>
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No report data available for the selected filters.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ReportExportBar({
  reportType,
  onExportCsv,
  onExportPdf,
  exportingCsv,
  exportingPdf,
}: {
  reportType: AdminReportType;
  onExportCsv: () => void;
  onExportPdf: () => void;
  exportingCsv: boolean;
  exportingPdf: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-3">
      <p className="text-sm text-muted-foreground">
        Download <span className="font-medium text-foreground">{moduleLabel(reportType)}</span> only — not the full
        combined report.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onExportCsv} disabled={exportingCsv || exportingPdf}>
          {exportingCsv ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FileSpreadsheet className="h-4 w-4 mr-1" />}
          {moduleLabel(reportType)} CSV
        </Button>
        <Button size="sm" onClick={onExportPdf} disabled={exportingCsv || exportingPdf}>
          {exportingPdf ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <FileText className="h-4 w-4 mr-1" />}
          {moduleLabel(reportType)} PDF
        </Button>
      </div>
    </div>
  );
}

function ModuleReportPanel({
  title,
  stats,
  activities,
  reportType,
  onExportCsv,
  onExportPdf,
  exportingCsv,
  exportingPdf,
}: {
  title: string;
  stats: { label: string; value: string }[];
  activities: AdminReportSummary["rows"]["activities"];
  reportType: AdminReportType;
  onExportCsv: () => void;
  onExportPdf: () => void;
  exportingCsv: boolean;
  exportingPdf: boolean;
}) {
  return (
    <div className="space-y-4">
      <ReportExportBar
        reportType={reportType}
        onExportCsv={onExportCsv}
        onExportPdf={onExportPdf}
        exportingCsv={exportingCsv}
        exportingPdf={exportingPdf}
      />
      <Card>
        <CardContent className="p-5">
          <h4 className="font-semibold mb-3">{title}</h4>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((stat) => (
              <MiniStat key={stat.label} label={stat.label} value={stat.value} />
            ))}
          </div>
        </CardContent>
      </Card>
      <DetailTable
        title={`${title} — Activity Detail`}
        headers={["Client", "Type", "Description", "Qty", "Status", "Date"]}
        rows={activities.map((r) => [
          r.clientName,
          r.type,
          r.description,
          r.quantity?.toString() || "—",
          r.status || "—",
          format(new Date(r.occurredAt), "MMM d, yyyy"),
        ])}
      />
    </div>
  );
}

function ComparisonPanel({ comparison }: { comparison: AdminReportComparisonSummary }) {
  return (
    <div className="space-y-4">
      <Card className="border-indigo-100">
        <CardContent className="p-5">
          <h4 className="font-semibold mb-1 flex items-center gap-2">
            <GitCompare className="h-4 w-4 text-indigo-600" />
            Period Comparison
          </h4>
          <p className="text-sm text-muted-foreground mb-4">
            {comparison.scope.allClients
              ? "All clients"
              : comparison.scope.clientName || comparison.scope.clientId}{" "}
            · Period A: <span className="font-medium text-foreground">{comparison.periodA.label}</span> vs Period B:{" "}
            <span className="font-medium text-foreground">{comparison.periodB.label}</span>
          </p>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metric</TableHead>
                  <TableHead>Period A</TableHead>
                  <TableHead>Period B</TableHead>
                  <TableHead>Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comparison.metrics.map((m) => (
                  <TableRow key={m.label}>
                    <TableCell className="font-medium">{m.label}</TableCell>
                    <TableCell>
                      {m.format === "currency" ? `$${m.periodA.toFixed(2)}` : m.periodA.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {m.format === "currency" ? `$${m.periodB.toFixed(2)}` : m.periodB.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <span className={m.delta >= 0 ? "text-emerald-700" : "text-red-600"}>
                        {m.format === "currency"
                          ? `${m.delta >= 0 ? "+" : ""}$${m.delta.toFixed(2)}`
                          : `${m.delta >= 0 ? "+" : ""}${m.delta.toLocaleString()}`}
                        {m.deltaPct !== null ? ` (${formatGrowth(m.deltaPct)})` : ""}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  sub,
  growth,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  growth?: number | null;
  accent?: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="rounded-full bg-slate-100 p-2 text-slate-600">{icon}</div>
          {growth !== undefined && growth !== null && (
            <Badge variant="outline" className={growth >= 0 ? "text-emerald-700" : "text-red-600"}>
              {growth >= 0 ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}
              {formatGrowth(growth)}
            </Badge>
          )}
        </div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground mt-3">{label}</p>
        <p className={`text-2xl font-bold ${accent || ""}`}>{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{sub}</p>
      </CardContent>
    </Card>
  );
}

function ValueTile({
  title,
  items,
}: {
  title: string;
  items: { label: string; value: string }[];
}) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700 mb-2">{title}</p>
      {items.map((item) => (
        <div key={item.label} className="flex justify-between text-sm py-0.5">
          <span className="text-muted-foreground">{item.label}</span>
          <span className="font-medium">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function DetailTable({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: string[];
  rows: string[][];
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <h4 className="font-semibold mb-3">{title}</h4>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No records in this period.</p>
        ) : (
          <div className="rounded-md border overflow-x-auto max-h-[420px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {headers.map((h) => (
                    <TableHead key={h}>{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, i) => (
                  <TableRow key={i}>
                    {row.map((cell, j) => (
                      <TableCell key={j} className="text-sm">
                        {cell}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatGrowth(pct: number | null): string {
  if (pct === null) return "—";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function MiniStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border bg-white px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-sm font-bold ${accent || "text-slate-900"}`}>{value}</p>
    </div>
  );
}
