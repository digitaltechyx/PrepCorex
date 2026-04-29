"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAffiliateData } from "@/components/dashboard/agent/use-affiliate-data";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Progress } from "@/components/ui/progress";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis, Legend } from "recharts";
import { format } from "date-fns";
import {
  ArrowRight,
  Award,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleDollarSign,
  ChevronRight,
  Coins,
  Copy,
  Info,
  Landmark,
  Percent,
  Shield,
  ShieldCheck,
  TrendingUp,
  TrendingDown,
  Users,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function AgentDashboardPage() {
  const {
    userProfile,
    loading,
    activeClients,
    paidInvoices,
    pendingCommissionTotal,
    paidCommissionTotal,
  } = useAffiliateData();

  const [copiedCode, setCopiedCode] = useState(false);
  const copyReferralCode = () => {
    if (!userProfile?.referralCode) return;
    navigator.clipboard.writeText(userProfile.referralCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 1800);
  };

  const monthlyRevenueMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const invoice of paidInvoices) {
      const rawDate = (invoice as any).date;
      let d: Date | null = null;
      if (rawDate?.seconds) d = new Date(rawDate.seconds * 1000);
      else if (rawDate) {
        const parsed = new Date(rawDate);
        d = Number.isNaN(parsed.getTime()) ? null : parsed;
      }
      if (!d) continue;
      const key = format(d, "yyyy-MM");
      map.set(key, (map.get(key) || 0) + (invoice.grandTotal || 0));
    }
    return map;
  }, [paidInvoices]);

  const monthSeries = useMemo(() => {
    const list: { key: string; month: string; revenue: number; commission: number }[] = [];
    const today = new Date();
    for (let i = 4; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const key = format(d, "yyyy-MM");
      const revenue = monthlyRevenueMap.get(key) || 0;
      list.push({
        key,
        month: format(d, "MMM"),
        revenue,
        commission: revenue * 0.05,
      });
    }
    return list;
  }, [monthlyRevenueMap]);

  // Determine starting tier based on Silver-level streak (Bronze is default)
  const silverStreak = useMemo(() => {
    let streak = 0;
    for (let i = monthSeries.length - 1; i >= 0; i--) {
      if ((monthSeries[i]?.revenue || 0) >= 25000) streak += 1;
      else break;
    }
    return streak;
  }, [monthSeries]);

  const goldStreak = useMemo(() => {
    let streak = 0;
    for (let i = monthSeries.length - 1; i >= 0; i--) {
      if ((monthSeries[i]?.revenue || 0) >= 50000) streak += 1;
      else break;
    }
    return streak;
  }, [monthSeries]);

  const tier: "Bronze" | "Silver" | "Gold" =
    goldStreak >= 6 ? "Gold" : silverStreak >= 3 ? "Silver" : "Bronze";
  const tierRate = tier === "Gold" ? 8 : tier === "Silver" ? 7 : 5;
  const currentMonthRevenue = monthSeries[monthSeries.length - 1]?.revenue || 0;
  const currentMonthCommission = currentMonthRevenue * (tierRate / 100);

  const nextTier = tier === "Bronze" ? "Silver" : tier === "Silver" ? "Gold" : "Gold";
  const nextTierRate = tier === "Bronze" ? 7 : tier === "Silver" ? 8 : 8;
  const nextTierMonthlyRevenue = tier === "Bronze" ? 25000 : 50000;
  const nextTierStreakTarget = tier === "Bronze" ? 3 : 6;
  const qualifyingStreak = tier === "Gold" ? goldStreak : tier === "Silver" ? goldStreak : silverStreak;
  const monthlyTarget = nextTierMonthlyRevenue;
  const targetProgress = Math.min(100, (currentMonthRevenue / monthlyTarget) * 100);

  const eligibleClientRows = useMemo(() => {
    const now = new Date();
    return activeClients
      .map((client) => {
        const clientInvoices = paidInvoices
          .filter((inv) => inv.userId === client.uid)
          .map((inv) => {
            const d: any = (inv as any).date;
            if (d?.seconds) return new Date(d.seconds * 1000);
            const parsed = new Date(d);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
          })
          .filter(Boolean) as Date[];

        if (clientInvoices.length === 0) return null;
        clientInvoices.sort((a, b) => a.getTime() - b.getTime());
        const firstPaid = clientInvoices[0];
        const expiresOn = new Date(firstPaid);
        expiresOn.setFullYear(expiresOn.getFullYear() + 1);
        const monthsLeft = Math.max(
          0,
          Math.ceil((expiresOn.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30))
        );

        return {
          id: client.uid,
          name: client.name || client.email || "Unknown",
          firstPaid,
          expiresOn,
          monthsLeft,
          active: expiresOn > now,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (a as any).monthsLeft - (b as any).monthsLeft) as Array<{
      id: string;
      name: string;
      firstPaid: Date;
      expiresOn: Date;
      monthsLeft: number;
      active: boolean;
    }>;
  }, [activeClients, paidInvoices]);

  const trendChartConfig = {
    revenue: { label: "Qualified Revenue (USD)", color: "#2563eb" },
    commission: { label: "Commission Earned (USD)", color: "#22c55e" },
  } satisfies ChartConfig;

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-12">
          <Skeleton className="h-[360px] w-full lg:col-span-5" />
          <Skeleton className="h-[360px] w-full lg:col-span-7" />
        </div>
      </div>
    );
  }

  // ===== Top tier strip =====
  const TierStrip = (
    <div className="grid gap-4 lg:grid-cols-4">
      {/* Current Tier */}
      <Card className="overflow-hidden border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 shadow-sm">
        <CardContent className="space-y-3 p-5">
          <div className="flex items-start justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Current Tier</span>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow">
              <Award className="h-6 w-6" />
            </div>
          </div>
          <div className="space-y-1">
            <h3 className="text-2xl font-bold text-slate-900">{tier} Partner</h3>
            <p className="text-xs text-slate-500">Current Rate</p>
            <p className="text-3xl font-bold text-amber-700">{tierRate}%</p>
          </div>
          <Link
            href="/dashboard/agent/policies"
            className="inline-flex items-center rounded-full bg-amber-100/80 px-3 py-1 text-xs font-medium text-amber-800 transition hover:bg-amber-200"
          >
            Learn more about tiers <ChevronRight className="ml-1 h-3 w-3" />
          </Link>
        </CardContent>
      </Card>

      {/* Qualified revenue this month */}
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="space-y-3 p-5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Qualified Revenue This Month</span>
          <div className="flex items-baseline gap-2">
            <p className="text-3xl font-bold text-slate-900">${currentMonthRevenue.toFixed(0)}</p>
            <p className="text-sm text-slate-500">/ ${monthlyTarget.toLocaleString()}</p>
          </div>
          <Progress value={targetProgress} className="h-2.5" />
          <p className="text-xs text-slate-500">{targetProgress.toFixed(0)}% of {nextTier} monthly target</p>
          <div className="flex items-center gap-1 border-t pt-2 text-[11px] text-slate-500">
            <Info className="h-3 w-3" /> {nextTier} target: ${monthlyTarget.toLocaleString()} / month
          </div>
        </CardContent>
      </Card>

      {/* Consecutive months */}
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="space-y-3 p-5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Consecutive Qualifying Months</span>
          <div className="flex items-baseline gap-1">
            <p className="text-3xl font-bold text-blue-700">{qualifyingStreak}</p>
            <p className="text-base text-slate-400">/ {nextTierStreakTarget}</p>
          </div>
          <p className="text-[11px] text-slate-500">
            {qualifyingStreak >= nextTierStreakTarget
              ? `Eligible for ${nextTier}!`
              : `${nextTierStreakTarget - qualifyingStreak} more month${
                  nextTierStreakTarget - qualifyingStreak === 1 ? "" : "s"
                } to reach ${nextTier}`}
          </p>
          <div className="flex gap-2 pt-1">
            {Array.from({ length: nextTierStreakTarget }).map((_, idx) => {
              const filled = idx < qualifyingStreak;
              return (
                <div
                  key={idx}
                  className={`flex h-7 w-7 items-center justify-center rounded-full border-2 ${
                    filled
                      ? "border-blue-500 bg-blue-500 text-white"
                      : "border-slate-300 bg-slate-100 text-slate-400"
                  }`}
                >
                  {filled ? <CheckCircle2 className="h-4 w-4" /> : null}
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-1 border-t pt-2 text-[11px] text-slate-500">
            <Info className="h-3 w-3" /> Need {nextTierStreakTarget} consecutive months
          </div>
        </CardContent>
      </Card>

      {/* Next tier target */}
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="space-y-3 p-5">
          <div className="flex items-start justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Next Tier Target</span>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-slate-300 to-slate-500 text-white shadow">
              <Shield className="h-6 w-6" />
            </div>
          </div>
          <div className="space-y-1">
            <h3 className="text-2xl font-bold text-slate-900">{nextTier} Partner</h3>
            <p className="text-3xl font-bold text-slate-700">{nextTierRate}%</p>
          </div>
          <p className="text-xs text-slate-500">
            Target: <span className="font-semibold text-slate-700">${nextTierMonthlyRevenue.toLocaleString()} / month</span>
          </p>
          <p className="text-[11px] text-slate-500">Maintain for {nextTierStreakTarget} consecutive months</p>
        </CardContent>
      </Card>
    </div>
  );

  // ===== KPI strip =====
  const KpiStrip = (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        icon={<Users className="h-5 w-5" />}
        iconBg="bg-blue-100 text-blue-600"
        label="Active Eligible Clients"
        value={eligibleClientRows.filter((r) => r.active).length.toString()}
        link="/dashboard/agent/active-clients"
        linkLabel="View clients"
        helper="Clients with 12-month window"
      />
      <KpiCard
        icon={<Coins className="h-5 w-5" />}
        iconBg="bg-emerald-100 text-emerald-600"
        label="Pending Commission"
        value={`$${pendingCommissionTotal.toFixed(2)}`}
        link="/dashboard/agent/paid-invoices"
        linkLabel="View breakdown"
        helper="Not yet paid"
      />
      <KpiCard
        icon={<Landmark className="h-5 w-5" />}
        iconBg="bg-violet-100 text-violet-600"
        label="Total Paid Commission"
        value={`$${paidCommissionTotal.toFixed(2)}`}
        link="/dashboard/agent/paid-invoices"
        linkLabel="View history"
        helper="All time paid"
      />
      <KpiCard
        icon={<Percent className="h-5 w-5" />}
        iconBg="bg-amber-100 text-amber-600"
        label="Avg. Commission Rate"
        value={`${tierRate}%`}
        link="/dashboard/agent/policies"
        linkLabel="Your current rate"
        helper={`${tier} Partner`}
      />
    </div>
  );

  // ===== Mid section =====
  const MidSection = (
    <div className="grid gap-4 lg:grid-cols-12">
      {/* Client commission windows */}
      <Card className="border-slate-200 shadow-sm lg:col-span-5">
        <CardContent className="space-y-3 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900">Client Commission Windows</h3>
            <Link
              href="/dashboard/agent/active-clients"
              className="inline-flex items-center text-xs font-medium text-blue-600 hover:underline"
            >
              View all clients <ChevronRight className="h-3 w-3" />
            </Link>
          </div>

          {eligibleClientRows.length > 0 ? (
            <Table containerClassName="overflow-x-auto mouse-h-scroll">
              <TableHeader>
                <TableRow className="border-slate-200">
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Client Name</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">First Paid Invoice</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Expires On</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Months Left</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {eligibleClientRows.slice(0, 6).map((row) => (
                  <TableRow key={row.id} className="border-slate-100">
                    <TableCell className="font-medium text-slate-900">{row.name}</TableCell>
                    <TableCell className="text-slate-700">{format(row.firstPaid, "MMM dd, yyyy")}</TableCell>
                    <TableCell className="text-slate-700">{format(row.expiresOn, "MMM dd, yyyy")}</TableCell>
                    <TableCell className="text-slate-700">
                      <div className="flex items-center gap-2">
                        <span className="w-4">{row.monthsLeft}</span>
                        <Progress value={(row.monthsLeft / 12) * 100} className="h-2 w-20" />
                      </div>
                    </TableCell>
                    <TableCell>
                      {row.active ? (
                        <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Active</Badge>
                      ) : (
                        <Badge variant="outline" className="text-slate-500">Expired</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">No eligible client windows yet.</p>
          )}

          <div className="flex items-center gap-1 border-t pt-2 text-[11px] text-slate-500">
            <Info className="h-3 w-3" /> Commission is payable for 12 months from the client&apos;s first paid invoice date.
          </div>
        </CardContent>
      </Card>

      {/* Commission overview */}
      <Card className="border-slate-200 shadow-sm lg:col-span-7">
        <CardContent className="space-y-4 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900">Commission Overview</h3>
            <span className="rounded-md border bg-white px-3 py-1 text-xs text-slate-600">This Month</span>
          </div>

          <div className="grid gap-3 rounded-lg border bg-slate-50/60 p-3 sm:grid-cols-3">
            <OverviewStat label="Qualified Revenue" value={`$${currentMonthRevenue.toFixed(2)}`} />
            <OverviewStat label="Commission Rate" value={`${tierRate}%`} />
            <OverviewStat label="Earned Commission" value={`$${currentMonthCommission.toFixed(2)}`} accent="text-emerald-700" />
          </div>

          <ChartContainer config={trendChartConfig} className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthSeries} margin={{ left: 8, right: 12, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="month" stroke="#64748b" />
                <YAxis stroke="#64748b" />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Legend
                  wrapperStyle={{ fontSize: 12 }}
                  formatter={(value) =>
                    value === "revenue" ? "Qualified Revenue (USD)" : "Commission Earned (USD)"
                  }
                />
                <Bar dataKey="revenue" fill="#2563eb" radius={[6, 6, 0, 0]} />
                <Bar dataKey="commission" fill="#22c55e" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>

          <div className="flex items-center gap-1 border-t pt-2 text-[11px] text-slate-500">
            <Info className="h-3 w-3" /> Only paid invoices from eligible clients within 12-month window are counted.
          </div>
        </CardContent>
      </Card>
    </div>
  );

  // ===== Program rules row =====
  const RulesRow = (
    <Card className="border-slate-200 shadow-sm">
      <CardContent className="p-5">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-700">Program Rules at a Glance</h3>
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
          <RuleTile icon={<CalendarDays className="h-5 w-5" />} color="bg-blue-50 text-blue-600" text="12-Month Window Per Client" />
          <RuleTile icon={<CircleDollarSign className="h-5 w-5" />} color="bg-emerald-50 text-emerald-600" text="Only Paid Invoices Count" />
          <RuleTile icon={<TrendingUp className="h-5 w-5" />} color="bg-indigo-50 text-indigo-600" text="Upgrades Not Retroactive" />
          <RuleTile icon={<TrendingDown className="h-5 w-5" />} color="bg-amber-50 text-amber-600" text="Downgrade After 2 Consecutive Underperforming Months" />
          <RuleTile icon={<ShieldCheck className="h-5 w-5" />} color="bg-cyan-50 text-cyan-600" text="No Lifetime Commission" />
          <RuleTile icon={<Users className="h-5 w-5" />} color="bg-purple-50 text-purple-600" text="Only Active, Approved, Referred Clients Are Included" />
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden border-0 bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-700 text-white shadow-xl">
        <CardContent className="p-6 sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <Badge className="bg-white/15 text-white hover:bg-white/20">Affiliate Workspace</Badge>
              <h1 className="text-2xl font-bold sm:text-4xl sm:leading-tight">Commission Agent Dashboard</h1>
              <p className="max-w-2xl text-sm text-violet-100 sm:text-base">
                Track referred clients, paid invoices, and commission performance in one place.
              </p>
            </div>
            {userProfile?.referralCode && (
              <div className="rounded-xl border border-white/30 bg-white/10 p-4 backdrop-blur-sm">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-violet-100">Referral Code</p>
                <div className="flex items-center gap-2">
                  <code className="text-xl font-bold tracking-wider">{userProfile.referralCode}</code>
                  <Button size="icon" variant="secondary" className="h-8 w-8" onClick={copyReferralCode}>
                    {copiedCode ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {TierStrip}
      {KpiStrip}
      {MidSection}
      {RulesRow}

      <div className="flex flex-col gap-2 border-t pt-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <p>
          Questions? Contact{" "}
          <a href="mailto:support@prepcorex.com" className="font-medium text-rose-500 hover:underline">
            support@prepcorex.com
          </a>
        </p>
        <p className="font-medium text-slate-600">PrepCorex Affiliate Program</p>
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  iconBg,
  label,
  value,
  link,
  linkLabel,
  helper,
}: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: string;
  link: string;
  linkLabel: string;
  helper: string;
}) {
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <div className={`flex h-11 w-11 items-center justify-center rounded-full ${iconBg}`}>
            {icon}
          </div>
          <div className="flex-1 space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
            <p className="text-2xl font-bold text-slate-900">{value}</p>
            <Link href={link} className="inline-flex items-center text-xs font-medium text-blue-600 hover:underline">
              {linkLabel} <ArrowRight className="ml-1 h-3 w-3" />
            </Link>
          </div>
        </div>
        <p className="mt-3 border-t pt-2 text-[11px] text-slate-500">{helper}</p>
      </CardContent>
    </Card>
  );
}

function OverviewStat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="text-center">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-2xl font-bold ${accent ?? "text-slate-900"}`}>{value}</p>
    </div>
  );
}

function RuleTile({
  icon,
  color,
  text,
}: {
  icon: React.ReactNode;
  color: string;
  text: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-white p-3 transition hover:shadow-sm">
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${color}`}>{icon}</div>
      <p className="text-xs font-medium leading-snug text-slate-700">{text}</p>
    </div>
  );
}
