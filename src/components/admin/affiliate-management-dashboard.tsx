"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format, subMonths, startOfMonth } from "date-fns";
import {
  Award,
  BarChart3,
  ChevronRight,
  Coins,
  Copy,
  Check,
  ExternalLink,
  Landmark,
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
import {
  computeAgentTier,
  getTierBadgeClass,
  parseCommissionDate,
} from "@/lib/affiliate-tier-utils";

interface AffiliateManagementDashboardProps {
  users: UserProfile[];
}

export function AffiliateManagementDashboard({ users }: AffiliateManagementDashboardProps) {
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "approved" | "pending" | "deleted">("all");
  const [agentPage, setAgentPage] = useState(1);
  const [selectedAgent, setSelectedAgent] = useState<AgentSummary | null>(null);
  const [monthFilter, setMonthFilter] = useState("all");
  const [commissionPage, setCommissionPage] = useState(1);
  const [clientPage, setClientPage] = useState(1);
  const [copiedCode, setCopiedCode] = useState(false);

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

  const monthOptions = useMemo(() => {
    const options = [{ value: "all", label: "All months" }];
    const today = new Date();
    for (let i = 0; i < 12; i++) {
      const d = startOfMonth(subMonths(today, i));
      options.push({
        value: format(d, "yyyy-MM"),
        label: format(d, "MMMM yyyy"),
      });
    }
    return options;
  }, []);

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
      if (monthFilter === "all") return true;
      const date = parseCommissionDate(c.createdAt);
      return date ? format(date, "yyyy-MM") === monthFilter : false;
    });
  }, [selectedAgent, monthFilter]);

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

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Users className="h-5 w-5" />}
          iconClass="bg-violet-100 text-violet-600"
          label="Commission Agents"
          value={networkStats.totalAgents.toString()}
          helper={`${networkStats.approvedAgents} approved · ${networkStats.pendingAgents} pending`}
        />
        <StatCard
          icon={<UserCheck className="h-5 w-5" />}
          iconClass="bg-blue-100 text-blue-600"
          label="Referred Clients"
          value={networkStats.totalReferredClients.toString()}
          helper="Clients linked to an agent"
        />
        <StatCard
          icon={<Coins className="h-5 w-5" />}
          iconClass="bg-amber-100 text-amber-600"
          label="Pending Payouts"
          value={`$${networkStats.totalPendingCommission.toFixed(2)}`}
          helper="Mark as paid in Invoices → Commissions"
        />
        <StatCard
          icon={<Landmark className="h-5 w-5" />}
          iconClass="bg-emerald-100 text-emerald-600"
          label="Total Paid Out"
          value={`$${networkStats.totalPaidCommission.toFixed(2)}`}
          helper={`$${networkStats.totalCommission.toFixed(2)} lifetime commission`}
        />
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Affiliate Agents</h3>
              <p className="text-sm text-muted-foreground">
                View earnings, referred clients, and commission breakdown per agent.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative min-w-[220px]">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search agents..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setAgentPage(1);
                  }}
                  className="pl-9"
                />
              </div>
              <Select
                value={statusFilter}
                onValueChange={(v) => {
                  setStatusFilter(v as typeof statusFilter);
                  setAgentPage(1);
                }}
              >
                <SelectTrigger className="w-[160px]">
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

          <div className="rounded-md border overflow-x-auto">
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
                {paginatedAgents.items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                      No commission agents found.
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedAgents.items.map((summary) => (
                    <TableRow key={summary.agent.uid}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{summary.agent.name || "Unnamed"}</p>
                          <p className="text-xs text-muted-foreground">{summary.agent.email}</p>
                          {summary.agent.referralCode && (
                            <p className="text-xs font-mono text-violet-600 mt-0.5">
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
                      <TableCell className="text-amber-700 font-medium">
                        ${summary.pendingTotal.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-emerald-700 font-medium">
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
                          onClick={() => {
                            setSelectedAgent(summary);
                            setMonthFilter("all");
                            setCommissionPage(1);
                            setClientPage(1);
                          }}
                        >
                          View details
                          <ChevronRight className="ml-1 h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <ListPagination
            page={agentPage}
            totalItems={paginatedAgents.totalItems}
            onPageChange={setAgentPage}
            itemLabel="agents"
          />
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-5">
          <AffiliateAuditTrailPanel />
        </CardContent>
      </Card>

      <Sheet open={!!selectedAgent} onOpenChange={(open) => !open && setSelectedAgent(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          {selectedAgent && (
            <>
              <SheetHeader className="space-y-3 pb-4 border-b">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <SheetTitle className="text-xl">{selectedAgent.agent.name}</SheetTitle>
                    <SheetDescription>{selectedAgent.agent.email}</SheetDescription>
                  </div>
                  <Badge variant="outline" className={getTierBadgeClass(selectedAgent.tier)}>
                    <Award className="h-3 w-3 mr-1" />
                    {selectedAgent.tier} · {selectedAgent.rate}%
                  </Badge>
                </div>
                {selectedAgent.agent.referralCode && (
                  <div className="flex items-center gap-2 rounded-lg border bg-slate-50 px-3 py-2">
                    <span className="text-xs text-muted-foreground">Referral code</span>
                    <code className="font-mono font-semibold">{selectedAgent.agent.referralCode}</code>
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
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <MiniStat label="Clients" value={selectedAgent.referredClients.length.toString()} />
                  <MiniStat label="This month" value={`$${selectedAgent.currentMonthEarned.toFixed(2)}`} />
                  <MiniStat label="Pending" value={`$${selectedAgent.pendingTotal.toFixed(2)}`} accent="text-amber-700" />
                  <MiniStat label="Paid" value={`$${selectedAgent.paidTotal.toFixed(2)}`} accent="text-emerald-700" />
                </div>
              </SheetHeader>

              <Tabs defaultValue="overview" className="mt-4">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="clients">Clients</TabsTrigger>
                  <TabsTrigger value="commissions">Commissions</TabsTrigger>
                  <TabsTrigger value="audit">Audit</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4 mt-4">
                  <Card className="border-slate-200">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <BarChart3 className="h-4 w-4 text-blue-600" />
                        <h4 className="font-semibold text-sm">12-Month Performance</h4>
                      </div>
                      <ChartContainer config={chartConfig} className="h-[220px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={selectedChartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} />
                            <ChartTooltip content={<ChartTooltipContent />} />
                            <Bar dataKey="revenue" fill="#2563eb" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="commission" fill="#22c55e" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </ChartContainer>
                    </CardContent>
                  </Card>

                  <div className="rounded-lg border bg-slate-50 p-4 text-sm space-y-2">
                    <p className="font-medium flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" />
                      Tier rules
                    </p>
                    <ul className="text-muted-foreground space-y-1 text-xs">
                      <li>Bronze 5% — default tier</li>
                      <li>Silver 7% — $25,000/mo for 3 consecutive months</li>
                      <li>Gold 8% — $50,000/mo for 6 consecutive months</li>
                      <li>12-month commission window per referred client</li>
                    </ul>
                    <Link
                      href="/admin/dashboard/users?tab=commission_agents"
                      className="inline-flex items-center text-xs text-blue-600 hover:underline mt-2"
                    >
                      Manage agent approvals
                      <ExternalLink className="ml-1 h-3 w-3" />
                    </Link>
                  </div>
                </TabsContent>

                <TabsContent value="clients" className="mt-4 space-y-3">
                  <div className="rounded-md border overflow-x-auto">
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
                        {paginatedClients.items.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                              No referred clients yet.
                            </TableCell>
                          </TableRow>
                        ) : (
                          paginatedClients.items.map((client) => {
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
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  <ListPagination
                    page={clientPage}
                    totalItems={paginatedClients.totalItems}
                    onPageChange={setClientPage}
                    itemLabel="clients"
                  />
                </TabsContent>

                <TabsContent value="commissions" className="mt-4 space-y-3">
                  <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                    <Select value={monthFilter} onValueChange={(v) => { setMonthFilter(v); setCommissionPage(1); }}>
                      <SelectTrigger className="w-[200px]">
                        <SelectValue placeholder="Filter by month" />
                      </SelectTrigger>
                      <SelectContent>
                        {monthOptions.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Payouts are processed in{" "}
                      <Link href="/admin/dashboard/invoices" className="text-blue-600 hover:underline">
                        Invoices → Commissions
                      </Link>
                    </p>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <MiniStat label="Invoices" value={selectedMonthTotals.count.toString()} />
                    <MiniStat label="Revenue" value={`$${selectedMonthTotals.revenue.toFixed(2)}`} />
                    <MiniStat label="Earned" value={`$${selectedMonthTotals.earned.toFixed(2)}`} accent="text-emerald-700" />
                    <MiniStat label="Pending" value={`$${selectedMonthTotals.pending.toFixed(2)}`} accent="text-amber-700" />
                  </div>

                  <div className="rounded-md border overflow-x-auto">
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
                        {paginatedCommissions.items.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                              No commissions for this period.
                            </TableCell>
                          </TableRow>
                        ) : (
                          paginatedCommissions.items.map((commission) => {
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
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                  <ListPagination
                    page={commissionPage}
                    totalItems={paginatedCommissions.totalItems}
                    onPageChange={setCommissionPage}
                    itemLabel="commissions"
                  />
                </TabsContent>

                <TabsContent value="audit" className="mt-4">
                  <AffiliateAuditTrailPanel
                    agentId={selectedAgent.agent.uid}
                    agentName={selectedAgent.agent.name}
                  />
                </TabsContent>
              </Tabs>
            </>
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
    <Card className="border-slate-200 shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <div className={`flex h-11 w-11 items-center justify-center rounded-full ${iconClass}`}>
            {icon}
          </div>
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
            <p className="text-2xl font-bold text-slate-900">{value}</p>
            <p className="text-xs text-muted-foreground">{helper}</p>
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
    <div className="rounded-lg border bg-white px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold ${accent || "text-slate-900"}`}>{value}</p>
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
