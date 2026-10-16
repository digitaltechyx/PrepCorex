"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  Award,
  BarChart3,
  Calendar,
  ChevronRight,
  Coins,
  Copy,
  Check,
  Download,
  ExternalLink,
  Landmark,
  Loader2,
  Search,
  TrendingUp,
  Users,
  UserCheck,
} from "lucide-react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Commission, UserProfile } from "@/types";
import { useAdminAffiliateData, type AgentSummary } from "./use-admin-affiliate-data";
import { AffiliateAuditTrailPanel } from "./affiliate-audit-trail-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { ListPagination, paginateList } from "@/components/ui/list-pagination";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { useToast } from "@/hooks/use-toast";
import {
  affiliateDateRangeLabel,
  isInAffiliateDateRange,
} from "@/lib/affiliate-date-filter";
import {
  computeAgentTier,
  getTierBadgeClass,
  parseCommissionDate,
} from "@/lib/affiliate-tier-utils";

function commissionsToCsv(commissions: Commission[], agentName: string): string {
  const header = ["Agent", "Invoice", "Client", "Invoice Amount", "Rate", "Commission", "Status", "Date"];
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const rows = commissions.map((commission) => {
    const date = parseCommissionDate(commission.createdAt);
    const rate = commission.commissionRate ?? "";
    return [
      agentName,
      commission.invoiceNumber || "",
      commission.clientName || "",
      String(commission.invoiceAmount ?? 0),
      rate ? `${rate}%` : "",
      String(commission.commissionAmount ?? 0),
      commission.status || "",
      date ? format(date, "yyyy-MM-dd") : "",
    ];
  });
  return [header, ...rows].map((row) => row.map((cell) => escape(String(cell))).join(",")).join("\n");
}

interface AffiliateManagementDashboardProps {
  users: UserProfile[];
}

export function AffiliateManagementDashboard({ users }: AffiliateManagementDashboardProps) {
  const { toast } = useToast();
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "approved" | "pending" | "deleted">("all");
  const [agentPage, setAgentPage] = useState(1);
  const [selectedAgent, setSelectedAgent] = useState<AgentSummary | null>(null);
  const [agentDateFrom, setAgentDateFrom] = useState<Date | undefined>();
  const [agentDateTo, setAgentDateTo] = useState<Date | undefined>();
  const [commissionPage, setCommissionPage] = useState(1);
  const [commissionDownloading, setCommissionDownloading] = useState(false);
  const [clientPage, setClientPage] = useState(1);
  const [copiedCode, setCopiedCode] = useState(false);

  const hasAgentDateRange = Boolean(agentDateFrom && agentDateTo);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const snap = await getDocs(
          query(collection(db, "commissions"), orderBy("createdAt", "desc"))
        );
        setCommissions(
          snap.docs.map((docSnap) => ({
            ...(docSnap.data() as Commission),
            id: docSnap.id,
          }))
        );
      } catch (error) {
        console.error("Failed to load commissions:", error);
        setCommissions([]);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const { agentSummaries, networkStats, getClientWindow } = useAdminAffiliateData(users, commissions);

  const filteredAgents = useMemo(() => {
    return agentSummaries
      .filter((summary) => {
        if (statusFilter === "all") return true;
        const status = summary.agent.status || "approved";
        if (statusFilter === "approved") return status === "approved" || !summary.agent.status;
        return status === statusFilter;
      })
      .filter((summary) => {
        if (!search.trim()) return true;
        const term = search.toLowerCase();
        return (
          summary.agent.name?.toLowerCase().includes(term) ||
          summary.agent.email?.toLowerCase().includes(term) ||
          summary.agent.referralCode?.toLowerCase().includes(term)
        );
      })
      .sort((a, b) => (b.totalEarned || 0) - (a.totalEarned || 0));
  }, [agentSummaries, search, statusFilter]);

  const paginatedAgents = paginateList(filteredAgents, agentPage, 10);

  const selectedCommissions = useMemo(() => {
    if (!selectedAgent) return [];
    return selectedAgent.commissions.filter((c) => {
      const date = parseCommissionDate(c.createdAt);
      return isInAffiliateDateRange(date, agentDateFrom, agentDateTo);
    });
  }, [selectedAgent, agentDateFrom, agentDateTo]);

  const selectedMonthTotals = useMemo(() => {
    const revenue = selectedCommissions.reduce((sum, c) => sum + (c.invoiceAmount || 0), 0);
    const earned = selectedCommissions.reduce((sum, c) => sum + (c.commissionAmount || 0), 0);
    const pending = selectedCommissions
      .filter((c) => c.status === "pending")
      .reduce((sum, c) => sum + (c.commissionAmount || 0), 0);
    const paid = selectedCommissions
      .filter((c) => c.status === "paid")
      .reduce((sum, c) => sum + (c.commissionAmount || 0), 0);
    return { revenue, earned, pending, paid, count: selectedCommissions.length };
  }, [selectedCommissions]);

  const selectedChartData = useMemo(() => {
    if (!selectedAgent) return [];
    const tierInfo = computeAgentTier(selectedAgent.commissions);
    return tierInfo.monthSeries.map((row) => ({
      month: row.month,
      revenue: row.revenue,
      commission: row.revenue * (selectedAgent.rate / 100),
    }));
  }, [selectedAgent]);

  const paginatedCommissions = paginateList(selectedCommissions, commissionPage, 10);
  const paginatedClients = paginateList(selectedAgent?.referredClients || [], clientPage, 10);

  const chartConfig = {
    revenue: { label: "Qualified Revenue", color: "#2563eb" },
    commission: { label: "Commission", color: "#22c55e" },
  } satisfies ChartConfig;

  const copyReferralCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 1800);
  };

  const openAgentDetails = (summary: AgentSummary) => {
    setAgentDateFrom(undefined);
    setAgentDateTo(undefined);
    setCommissionPage(1);
    setClientPage(1);
    setSelectedAgent(summary);
  };

  const downloadCommissionsCsv = () => {
    if (!selectedAgent) return;
    setCommissionDownloading(true);
    try {
      const csv = commissionsToCsv(selectedCommissions, selectedAgent.agent.name || "Agent");
      const rangeLabel = affiliateDateRangeLabel(agentDateFrom, agentDateTo);
      const filename = `affiliate-commissions_${selectedAgent.agent.uid}_${rangeLabel}.csv`;
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({
        title: "Commissions downloaded",
        description: hasAgentDateRange
          ? "CSV export for the selected date range saved."
          : "All-time CSV export saved.",
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Download failed",
        description: "Could not export commissions.",
      });
    } finally {
      setCommissionDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-w-0 space-y-3">
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-20 w-full sm:h-24" />
          ))}
        </div>
        <Skeleton className="h-48 w-full sm:h-72" />
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-3 sm:space-y-6">
      <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        <StatCard
          icon={<Users className="h-4 w-4 sm:h-5 sm:w-5" />}
          iconClass="bg-violet-100 text-violet-600"
          label="Agents"
          value={networkStats.totalAgents.toString()}
          helper={`${networkStats.approvedAgents} ok · ${networkStats.pendingAgents} pend`}
        />
        <StatCard
          icon={<UserCheck className="h-4 w-4 sm:h-5 sm:w-5" />}
          iconClass="bg-blue-100 text-blue-600"
          label="Clients"
          value={networkStats.totalReferredClients.toString()}
          helper="Linked to agents"
        />
        <StatCard
          icon={<Coins className="h-4 w-4 sm:h-5 sm:w-5" />}
          iconClass="bg-amber-100 text-amber-600"
          label="Pending"
          value={`$${networkStats.totalPendingCommission.toFixed(2)}`}
          helper="Invoices → Commissions"
        />
        <StatCard
          icon={<Landmark className="h-4 w-4 sm:h-5 sm:w-5" />}
          iconClass="bg-emerald-100 text-emerald-600"
          label="Paid out"
          value={`$${networkStats.totalPaidCommission.toFixed(2)}`}
          helper={`$${networkStats.totalCommission.toFixed(2)} lifetime`}
        />
      </div>

      <Card className="min-w-0 overflow-hidden border-slate-200 shadow-sm">
        <CardContent className="space-y-3 p-3 sm:space-y-4 sm:p-5">
          <div className="flex flex-col gap-2 sm:gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-slate-900 sm:text-lg">Affiliate Agents</h3>
              <p className="text-xs text-muted-foreground sm:text-sm">
                Earnings, referred clients, and commission breakdown.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative min-w-0 flex-1 sm:min-w-[200px]">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search agents…"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setAgentPage(1);
                  }}
                  className="h-9 pl-9"
                />
              </div>
              <Select
                value={statusFilter}
                onValueChange={(v) => {
                  setStatusFilter(v as typeof statusFilter);
                  setAgentPage(1);
                }}
              >
                <SelectTrigger className="h-9 w-full sm:w-[150px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="deleted">Deleted</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {paginatedAgents.items.length === 0 ? (
            <div className="rounded-md border py-8 text-center text-sm text-muted-foreground">
              No commission agents found.
            </div>
          ) : (
            <>
              <div className="space-y-1.5 md:hidden">
                {paginatedAgents.items.map((summary) => (
                  <button
                    key={summary.agent.uid}
                    type="button"
                    onClick={() => openAgentDetails(summary)}
                    className="flex w-full flex-col gap-1.5 rounded-md border bg-card px-2.5 py-2 text-left hover:bg-muted/40"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold sm:text-sm">
                          {summary.agent.name || "Unnamed"}
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">{summary.agent.email}</p>
                      </div>
                      <AgentStatusBadge status={summary.agent.status} />
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className={`h-5 px-1.5 text-[10px] ${getTierBadgeClass(summary.tier)}`}>
                        {summary.tier} · {summary.rate}%
                      </Badge>
                      {summary.agent.referralCode && (
                        <span className="font-mono text-[10px] text-violet-600">{summary.agent.referralCode}</span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-1 text-[10px] text-muted-foreground">
                      <span>
                        <span className="font-medium text-foreground">{summary.referredClients.length}</span> clients
                      </span>
                      <span className="text-amber-700">
                        Pend ${summary.pendingTotal.toFixed(0)}
                      </span>
                      <span className="text-right font-semibold text-foreground">
                        ${summary.totalEarned.toFixed(2)}
                      </span>
                    </div>
                    <span className="inline-flex items-center text-[11px] font-medium text-violet-700">
                      View details
                      <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
                    </span>
                  </button>
                ))}
              </div>

              <div className="hidden overflow-x-auto rounded-md border md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agent</TableHead>
                      <TableHead>Tier</TableHead>
                      <TableHead>Clients</TableHead>
                      <TableHead>This Month</TableHead>
                      <TableHead>Pending</TableHead>
                      <TableHead>Paid</TableHead>
                      <TableHead>Total Earned</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedAgents.items.map((summary) => (
                      <TableRow key={summary.agent.uid}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{summary.agent.name || "Unnamed"}</p>
                            <p className="text-xs text-muted-foreground">{summary.agent.email}</p>
                            {summary.agent.referralCode && (
                              <p className="mt-0.5 font-mono text-xs text-violet-600">
                                {summary.agent.referralCode}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={getTierBadgeClass(summary.tier)}>
                            {summary.tier} · {summary.rate}%
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            <span className="font-medium">{summary.referredClients.length}</span>
                            <span className="text-muted-foreground"> total</span>
                            <p className="text-xs text-muted-foreground">
                              {summary.activeClients.length} active
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">${summary.currentMonthEarned.toFixed(2)}</p>
                            <p className="text-xs text-muted-foreground">
                              ${summary.currentMonthRevenue.toFixed(0)} revenue
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="font-medium text-amber-700">
                          ${summary.pendingTotal.toFixed(2)}
                        </TableCell>
                        <TableCell className="font-medium text-emerald-700">
                          ${summary.paidTotal.toFixed(2)}
                        </TableCell>
                        <TableCell className="font-semibold">${summary.totalEarned.toFixed(2)}</TableCell>
                        <TableCell>
                          <AgentStatusBadge status={summary.agent.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openAgentDetails(summary)}
                          >
                            View details
                            <ChevronRight className="ml-1 h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}

          <ListPagination
            page={agentPage}
            totalItems={paginatedAgents.totalItems}
            onPageChange={setAgentPage}
            itemLabel="agents"
          />
        </CardContent>
      </Card>

      <Card className="min-w-0 overflow-hidden border-slate-200 shadow-sm">
        <CardContent className="p-3 sm:p-5">
          <AffiliateAuditTrailPanel />
        </CardContent>
      </Card>

      <Sheet
        open={!!selectedAgent}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedAgent(null);
            setAgentDateFrom(undefined);
            setAgentDateTo(undefined);
          }
        }}
      >
        <SheetContent className="flex h-[100dvh] w-full max-w-full flex-col gap-0 overflow-hidden p-0 sm:h-full sm:max-w-2xl">
          {selectedAgent && (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 pb-8 pt-12 sm:p-6 sm:pt-6">
              <SheetHeader className="space-y-2 border-b pb-3 text-left sm:space-y-3 sm:pb-4">
                <div className="flex flex-col gap-2 pr-8 sm:flex-row sm:items-start sm:justify-between sm:gap-3 sm:pr-6">
                  <div className="min-w-0">
                    <SheetTitle className="break-words text-base sm:text-xl">
                      {selectedAgent.agent.name}
                    </SheetTitle>
                    <SheetDescription className="break-all text-xs sm:text-sm">
                      {selectedAgent.agent.email}
                    </SheetDescription>
                  </div>
                  <Badge variant="outline" className={`w-fit shrink-0 ${getTierBadgeClass(selectedAgent.tier)}`}>
                    <Award className="mr-1 h-3 w-3" />
                    {selectedAgent.tier} · {selectedAgent.rate}%
                  </Badge>
                </div>
                {selectedAgent.agent.referralCode && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-slate-50 px-2.5 py-1.5 sm:px-3 sm:py-2">
                    <span className="text-[10px] text-muted-foreground sm:text-xs">Referral code</span>
                    <code className="font-mono text-sm font-semibold">{selectedAgent.agent.referralCode}</code>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => copyReferralCode(selectedAgent.agent.referralCode!)}
                    >
                      {copiedCode ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 sm:gap-2">
                  <MiniStat label="Clients" value={selectedAgent.referredClients.length.toString()} />
                  <MiniStat label="This month" value={`$${selectedAgent.currentMonthEarned.toFixed(2)}`} />
                  <MiniStat label="Pending" value={`$${selectedAgent.pendingTotal.toFixed(2)}`} accent="text-amber-700" />
                  <MiniStat label="Paid" value={`$${selectedAgent.paidTotal.toFixed(2)}`} accent="text-emerald-700" />
                </div>
              </SheetHeader>

              <div className="mt-3 flex flex-col gap-2 rounded-lg border bg-slate-50/80 px-2.5 py-2.5 sm:mt-4 sm:flex-row sm:items-center sm:justify-between sm:px-3 sm:py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                    <Calendar className="h-3.5 w-3.5 shrink-0" />
                    Date filter
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Empty = all time. Applies to commissions &amp; audit.
                  </p>
                </div>
                <DateRangePicker
                  fromDate={agentDateFrom}
                  toDate={agentDateTo}
                  setFromDate={(d) => {
                    setAgentDateFrom(d);
                    setCommissionPage(1);
                  }}
                  setToDate={(d) => {
                    setAgentDateTo(d);
                    setCommissionPage(1);
                  }}
                  className="h-9 w-full min-w-0 bg-white text-sm sm:min-w-[220px] sm:w-auto"
                />
              </div>

              <Tabs defaultValue="overview" className="mt-3 min-w-0 sm:mt-4">
                <TabsList className="grid h-auto w-full grid-cols-4 gap-0.5 p-1">
                  <TabsTrigger value="overview" className="px-1 py-1.5 text-[10px] sm:px-3 sm:text-sm">
                    Overview
                  </TabsTrigger>
                  <TabsTrigger value="clients" className="px-1 py-1.5 text-[10px] sm:px-3 sm:text-sm">
                    Clients
                  </TabsTrigger>
                  <TabsTrigger value="commissions" className="px-1 py-1.5 text-[10px] sm:px-3 sm:text-sm">
                    <span className="sm:hidden">Comm.</span>
                    <span className="hidden sm:inline">Commissions</span>
                  </TabsTrigger>
                  <TabsTrigger value="audit" className="px-1 py-1.5 text-[10px] sm:px-3 sm:text-sm">
                    Audit
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="mt-3 space-y-3 sm:mt-4 sm:space-y-4">
                  <Card className="border-slate-200">
                    <CardContent className="space-y-2 p-3 sm:space-y-3 sm:p-4">
                      <div className="flex items-center gap-2">
                        <BarChart3 className="h-4 w-4 text-blue-600" />
                        <h4 className="text-sm font-semibold">12-Month Performance</h4>
                      </div>
                      <ChartContainer config={chartConfig} className="h-[180px] w-full min-w-0 sm:h-[220px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={selectedChartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                            <YAxis width={36} tick={{ fontSize: 10 }} />
                            <ChartTooltip content={<ChartTooltipContent />} />
                            <Bar dataKey="revenue" fill="#2563eb" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="commission" fill="#22c55e" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </ChartContainer>
                    </CardContent>
                  </Card>

                  <div className="space-y-2 rounded-lg border bg-slate-50 p-3 text-sm sm:p-4">
                    <p className="flex items-center gap-2 font-medium">
                      <TrendingUp className="h-4 w-4" />
                      Tier rules
                    </p>
                    <ul className="space-y-1 text-[11px] text-muted-foreground sm:text-xs">
                      <li>Bronze 5% — default tier</li>
                      <li>Silver 7% — $25k/mo × 3 months</li>
                      <li>Gold 8% — $50k/mo × 6 months</li>
                      <li>12-month commission window per client</li>
                    </ul>
                    <Link
                      href="/admin/dashboard/users?tab=commission_agents"
                      className="mt-2 inline-flex items-center text-xs text-blue-600 hover:underline"
                    >
                      Manage agent approvals
                      <ExternalLink className="ml-1 h-3 w-3" />
                    </Link>
                  </div>
                </TabsContent>

                <TabsContent value="clients" className="mt-3 space-y-3 sm:mt-4">
                  {paginatedClients.items.length === 0 ? (
                    <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
                      No referred clients yet.
                    </div>
                  ) : (
                    <>
                      <div className="space-y-1.5 sm:hidden">
                        {paginatedClients.items.map((client) => {
                          const window = getClientWindow(selectedAgent.agent.uid, client.uid);
                          return (
                            <div key={client.uid} className="rounded-md border px-2.5 py-2">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-semibold">{client.name || "Unnamed"}</p>
                                  <p className="truncate text-[11px] text-muted-foreground">{client.email}</p>
                                </div>
                                <AgentStatusBadge status={client.status || "approved"} />
                              </div>
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                {window.firstPaid
                                  ? `${window.active ? "Active" : "Expired"} until ${
                                      window.expiresOn ? format(window.expiresOn, "MMM dd, yyyy") : "—"
                                    }`
                                  : "No paid invoices yet"}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                      <div className="hidden overflow-x-auto rounded-md border sm:block">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Client</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Window</TableHead>
                              <TableHead>Joined</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {paginatedClients.items.map((client) => {
                              const window = getClientWindow(selectedAgent.agent.uid, client.uid);
                              return (
                                <TableRow key={client.uid}>
                                  <TableCell>
                                    <p className="font-medium">{client.name || "Unnamed"}</p>
                                    <p className="text-xs text-muted-foreground">{client.email}</p>
                                  </TableCell>
                                  <TableCell>
                                    <AgentStatusBadge status={client.status || "approved"} />
                                  </TableCell>
                                  <TableCell className="text-xs">
                                    {window.firstPaid ? (
                                      <div>
                                        <p>{window.active ? "Active" : "Expired"}</p>
                                        <p className="text-muted-foreground">
                                          until {window.expiresOn ? format(window.expiresOn, "MMM dd, yyyy") : "—"}
                                        </p>
                                      </div>
                                    ) : (
                                      <span className="text-muted-foreground">No paid invoices yet</span>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-xs text-muted-foreground">
                                    {client.createdAt
                                      ? format(
                                          typeof client.createdAt === "object" && "seconds" in client.createdAt
                                            ? new Date(client.createdAt.seconds * 1000)
                                            : new Date(client.createdAt as string),
                                          "MMM dd, yyyy"
                                        )
                                      : "—"}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </>
                  )}
                  <ListPagination
                    page={clientPage}
                    totalItems={paginatedClients.totalItems}
                    onPageChange={setClientPage}
                    itemLabel="clients"
                  />
                </TabsContent>

                <TabsContent value="commissions" className="mt-3 space-y-3 sm:mt-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[11px] text-muted-foreground sm:text-xs">
                      {hasAgentDateRange && agentDateFrom && agentDateTo
                        ? `${format(agentDateFrom, "MMM d, yyyy")} – ${format(agentDateTo, "MMM d, yyyy")}`
                        : "All time"}
                      {" · "}
                      <Link href="/admin/dashboard/invoices" className="text-blue-600 hover:underline">
                        Invoices → Commissions
                      </Link>
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 w-full sm:w-auto"
                      onClick={downloadCommissionsCsv}
                      disabled={commissionDownloading || selectedCommissions.length === 0}
                    >
                      {commissionDownloading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      <span className="ml-2">Download CSV</span>
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 sm:gap-2">
                    <MiniStat label="Invoices" value={selectedMonthTotals.count.toString()} />
                    <MiniStat label="Revenue" value={`$${selectedMonthTotals.revenue.toFixed(2)}`} />
                    <MiniStat label="Earned" value={`$${selectedMonthTotals.earned.toFixed(2)}`} accent="text-emerald-700" />
                    <MiniStat label="Pending" value={`$${selectedMonthTotals.pending.toFixed(2)}`} accent="text-amber-700" />
                  </div>

                  {paginatedCommissions.items.length === 0 ? (
                    <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
                      No commissions for this period.
                    </div>
                  ) : (
                    <>
                      <div className="space-y-1.5 sm:hidden">
                        {paginatedCommissions.items.map((commission) => {
                          const date = parseCommissionDate(commission.createdAt);
                          const rate = commission.commissionRate ?? selectedAgent.rate;
                          return (
                            <div key={commission.id} className="rounded-md border px-2.5 py-2">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="font-mono text-xs font-semibold">{commission.invoiceNumber}</p>
                                  <p className="truncate text-[11px] text-muted-foreground">
                                    {commission.clientName}
                                  </p>
                                </div>
                                <Badge
                                  variant={commission.status === "paid" ? "default" : "secondary"}
                                  className={
                                    commission.status === "paid"
                                      ? "h-5 shrink-0 bg-emerald-100 px-1.5 text-[10px] text-emerald-800 hover:bg-emerald-100"
                                      : "h-5 shrink-0 bg-amber-100 px-1.5 text-[10px] text-amber-800 hover:bg-amber-100"
                                  }
                                >
                                  {commission.status}
                                </Badge>
                              </div>
                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
                                <span>Inv ${(commission.invoiceAmount || 0).toFixed(2)}</span>
                                <span>{rate}%</span>
                                <span className="font-semibold text-emerald-700">
                                  ${(commission.commissionAmount || 0).toFixed(2)}
                                </span>
                                <span className="text-muted-foreground">
                                  {date ? format(date, "MMM dd, yyyy") : "—"}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="hidden overflow-x-auto rounded-md border sm:block">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Invoice</TableHead>
                              <TableHead>Client</TableHead>
                              <TableHead>Invoice Amt</TableHead>
                              <TableHead>Rate</TableHead>
                              <TableHead>Commission</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Date</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {paginatedCommissions.items.map((commission) => {
                              const date = parseCommissionDate(commission.createdAt);
                              const rate = commission.commissionRate ?? selectedAgent.rate;
                              return (
                                <TableRow key={commission.id}>
                                  <TableCell className="font-mono text-sm">
                                    {commission.invoiceNumber}
                                  </TableCell>
                                  <TableCell>
                                    <p className="text-sm">{commission.clientName}</p>
                                  </TableCell>
                                  <TableCell>${(commission.invoiceAmount || 0).toFixed(2)}</TableCell>
                                  <TableCell>
                                    <Badge variant="outline" className="text-xs">
                                      {rate}% {commission.tier ? `(${commission.tier})` : ""}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="font-medium text-emerald-700">
                                    ${(commission.commissionAmount || 0).toFixed(2)}
                                  </TableCell>
                                  <TableCell>
                                    <Badge
                                      variant={commission.status === "paid" ? "default" : "secondary"}
                                      className={
                                        commission.status === "paid"
                                          ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100"
                                          : "bg-amber-100 text-amber-800 hover:bg-amber-100"
                                      }
                                    >
                                      {commission.status}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-xs text-muted-foreground">
                                    {date ? format(date, "MMM dd, yyyy") : "—"}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </>
                  )}
                  <ListPagination
                    page={commissionPage}
                    totalItems={paginatedCommissions.totalItems}
                    onPageChange={setCommissionPage}
                    itemLabel="commissions"
                  />
                </TabsContent>

                <TabsContent value="audit" className="mt-3 sm:mt-4">
                  <AffiliateAuditTrailPanel
                    agentId={selectedAgent.agent.uid}
                    agentName={selectedAgent.agent.name}
                    fromDate={agentDateFrom}
                    toDate={agentDateTo}
                    onFromDateChange={setAgentDateFrom}
                    onToDateChange={setAgentDateTo}
                    showDatePicker={false}
                  />
                </TabsContent>
              </Tabs>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StatCard({
  icon,
  iconClass,
  label,
  value,
  helper,
}: {
  icon: React.ReactNode;
  iconClass: string;
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <Card className="min-w-0 border-slate-200 shadow-sm">
      <CardContent className="p-2.5 sm:p-5">
        <div className="flex items-start gap-2 sm:gap-3">
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full sm:h-11 sm:w-11 ${iconClass}`}>
            {icon}
          </div>
          <div className="min-w-0 space-y-0.5 sm:space-y-1">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-500 sm:text-[11px]">
              {label}
            </p>
            <p className="truncate text-base font-bold text-slate-900 sm:text-2xl">{value}</p>
            <p className="line-clamp-2 text-[10px] text-muted-foreground sm:text-xs">{helper}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
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
    <div className="rounded-md border bg-white px-2 py-1.5 sm:rounded-lg sm:px-3 sm:py-2">
      <p className="text-[9px] uppercase tracking-wide text-muted-foreground sm:text-[10px]">{label}</p>
      <p className={`truncate text-sm font-bold sm:text-lg ${accent || "text-slate-900"}`}>{value}</p>
    </div>
  );
}

function AgentStatusBadge({ status }: { status?: string }) {
  if (status === "pending") {
    return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Pending</Badge>;
  }
  if (status === "deleted") {
    return <Badge variant="destructive">Deleted</Badge>;
  }
  return <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">Approved</Badge>;
}
