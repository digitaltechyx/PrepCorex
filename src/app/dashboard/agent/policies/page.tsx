"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertTriangle,
  Award,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Crown,
  FileText,
  Info,
  Lock,
  Mail,
  Medal,
  Repeat,
  ShieldCheck,
  Target,
  Trophy,
  TrendingDown,
  TrendingUp,
  XCircle,
} from "lucide-react";

const tiers = [
  {
    name: "Bronze Partner",
    rate: "5%",
    icon: Medal,
    color: "from-amber-500 to-orange-600",
    badge: "bg-amber-100 text-amber-800 border-amber-300",
    description: "Default starting tier for every newly approved commission agent.",
    requirements: [
      "Applies immediately after approval",
      "No minimum revenue requirement to maintain",
      "Can stay in this tier indefinitely",
    ],
  },
  {
    name: "Silver Partner",
    rate: "7%",
    icon: Trophy,
    color: "from-slate-400 to-slate-600",
    badge: "bg-slate-100 text-slate-800 border-slate-300",
    description: "Performance tier for agents who consistently generate qualifying revenue.",
    requirements: [
      "Generate at least $25,000 paid referred-client revenue per month",
      "Maintain this for 3 consecutive months",
      "Promotion applies to future invoices only (not retroactive)",
    ],
  },
  {
    name: "Gold Partner",
    rate: "8%",
    icon: Crown,
    color: "from-yellow-400 to-yellow-600",
    badge: "bg-yellow-100 text-yellow-800 border-yellow-300",
    description: "Top tier for the highest performing commission agents.",
    requirements: [
      "Continue generating at least $50,000 paid referred-client revenue per month",
      "Maintain this for 6 consecutive months total",
      "Promotion applies to future invoices only (not retroactive)",
    ],
  },
];

const strictRules = [
  {
    title: "Commission is paid for one year only per client",
    icon: CalendarDays,
    color: "text-blue-600 bg-blue-50",
    details: [
      "Every referred client has a 12-month commission window",
      "Commission starts when the client becomes a qualified referred customer",
      "Recommended start date: client's first paid invoice",
      "After 12 months, that client's future invoices generate zero commission",
      "When the window expires, the client is automatically removed from your Active Clients tab",
    ],
  },
  {
    title: "Only paid invoices count",
    icon: CircleDollarSign,
    color: "text-emerald-600 bg-emerald-50",
    details: [
      "Pending invoices do not count",
      "Unpaid invoices do not count",
      "Rejected, cancelled, or deleted accounts do not count",
    ],
  },
  {
    title: "Upgrades are not retroactive",
    icon: TrendingUp,
    color: "text-indigo-600 bg-indigo-50",
    details: [
      "Reaching Silver or Gold applies only to future qualifying invoices",
      "Past invoices stay at the rate active at that time",
    ],
  },
  {
    title: "Revenue target must be maintained monthly",
    icon: Target,
    color: "text-purple-600 bg-purple-50",
    details: [
      "Monthly revenue is measured each calendar month",
      "Sum of paid invoice revenue from referred clients whose 12-month commission window is still active",
    ],
  },
  {
    title: "Downgrade if performance drops",
    icon: TrendingDown,
    color: "text-rose-600 bg-rose-50",
    details: [
      "Silver or Gold agents who fall below required monthly target for 2 consecutive months are downgraded by one tier",
      "Bronze agents stay Bronze regardless of low performance",
      "Gold → Silver if Gold target missed for 2 months",
      "Silver → Bronze if Silver target missed for 2 months",
    ],
  },
  {
    title: "No permanent tier lock",
    icon: Lock,
    color: "text-amber-600 bg-amber-50",
    details: [
      "Tiers are performance privileges, not permanent entitlements",
      "Agents must continue earning their tier through real monthly production",
    ],
  },
  {
    title: "Only approved active clients are included",
    icon: ClipboardCheck,
    color: "text-cyan-600 bg-cyan-50",
    details: [
      "Client must be referred by the agent",
      "Client must be approved and active",
      "Client must be within 12-month commission window",
      "Client must be paying invoices successfully",
    ],
  },
];

const examples = [
  {
    title: "Example 1: Bronze to Silver",
    icon: TrendingUp,
    color: "border-blue-200 bg-blue-50/40",
    text: [
      "Agent starts at Bronze = 5%",
      "Jan: referred clients generate $26,500 paid revenue",
      "Feb: referred clients generate $25,800 paid revenue",
      "Mar: referred clients generate $27,200 paid revenue",
      "Agent qualifies for Silver",
      "From April onward, future eligible invoices pay 7%",
    ],
  },
  {
    title: "Example 2: Silver to Gold",
    icon: Crown,
    color: "border-yellow-200 bg-yellow-50/40",
    text: [
      "Agent continues hitting monthly Silver target",
      "By the 6th consecutive qualifying month at $50,000+ revenue, agent reaches Gold",
      "From the next month onward, future eligible invoices pay 8%",
    ],
  },
  {
    title: "Example 3: Downgrade",
    icon: TrendingDown,
    color: "border-rose-200 bg-rose-50/40",
    text: [
      "Gold agent falls below $50,000 in July",
      "Again falls below $50,000 in August",
      "Agent is downgraded to Silver for September",
    ],
  },
  {
    title: "Example 4: One-year client cap",
    icon: CalendarDays,
    color: "border-emerald-200 bg-emerald-50/40",
    text: [
      "Client A first pays on March 10, 2026",
      "Agent earns commission on Client A's eligible paid invoices until March 9, 2027",
      "From March 10, 2027 onward, Client A generates zero commission",
      "Client A is automatically removed from the agent's Active Clients tab after the window expires",
    ],
  },
];

const dashboardItems = [
  "Current tier badge",
  "Current commission rate",
  "This month's qualified revenue with progress bar",
  "Number of active commission-eligible clients",
  "Consecutive qualifying months streak",
  "Next tier target",
  "Countdown until each client's commission expires",
  "Automatic removal from Active Clients when a client's 12-month window ends",
  "Pending commission balance",
  "Paid commission history",
];

export default function AffiliatePoliciesPage() {
  return (
    <div className="space-y-6">
      {/* HERO */}
      <Card className="overflow-hidden border-0 bg-gradient-to-r from-slate-900 via-indigo-900 to-violet-900 text-white shadow-lg">
        <CardContent className="p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
              <ShieldCheck className="h-7 w-7" />
            </div>
            <div>
              <Badge className="mb-2 bg-white/15 text-white hover:bg-white/20">Affiliate Agreement</Badge>
              <h1 className="text-2xl font-bold sm:text-3xl">Affiliate Policies & Rules</h1>
              <p className="mt-1 max-w-3xl text-sm text-slate-200 sm:text-base">
                Full details of the PrepCorex Affiliate Commission Program — tier structure, qualification rules,
                commission window, and downgrade policies. This is the official commercial agreement between PrepCorex
                and its commission agents.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 12-MONTH COMMISSION DISCLAIMER */}
      <Card className="border-amber-300 bg-gradient-to-br from-amber-50 via-orange-50/40 to-white shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-amber-950">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            Important Disclaimer — 12-Month Commission Period
          </CardTitle>
          <CardDescription className="text-amber-900/80">
            Please read this carefully. It explains how long you earn commission on each referred client and what happens
            when that period ends.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-amber-950">
          <p>
            Under the PrepCorex Affiliate Commission Program, you may earn commission on each referred client for a
            fixed period of <span className="font-semibold">one year (12 months) only</span>. This is not a lifetime
            commission arrangement.
          </p>

          <div className="rounded-lg border border-amber-200 bg-white/70 p-4 space-y-3">
            <h4 className="font-semibold text-slate-900">How the 12-month window works</h4>
            <ul className="space-y-2 text-slate-700">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span>
                  The 12-month commission period begins on the date of the referred client&apos;s{" "}
                  <span className="font-semibold">first paid invoice</span>.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span>
                  While inside this window, you earn commission on eligible <span className="font-semibold">paid
                  invoices</span> from that client, at your current Bronze, Silver, or Gold tier rate.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                <span>
                  When the 12-month period ends, that client&apos;s <span className="font-semibold">future invoices
                  no longer generate any commission</span> for you — even if the client continues using PrepCorex.
                </span>
              </li>
            </ul>
          </div>

          <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-4 space-y-2">
            <h4 className="font-semibold text-slate-900">What happens on your dashboard</h4>
            <p className="text-slate-700">
              Once a client&apos;s 12-month commission window expires, that client is{" "}
              <span className="font-semibold">automatically removed from your Active Clients tab</span> in the affiliate
              dashboard. They are no longer counted as a commission-eligible active client because the program pays
              commission on each referral for one year only.
            </p>
            <p className="text-slate-600 text-xs">
              Your past commission records and payout history for that client remain available. Only forward-looking
              commission eligibility ends. To grow ongoing earnings, continue referring new clients — each new referral
              starts its own independent 12-month commission window.
            </p>
          </div>

          <p className="text-xs text-amber-900/90 italic border-t border-amber-200 pt-3">
            By participating in the affiliate program, you acknowledge that commission is limited to twelve (12) months
            per referred client and that expired clients will no longer appear in your Active Clients list.
          </p>
        </CardContent>
      </Card>

      {/* EXECUTIVE SUMMARY */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-5 w-5 text-slate-500" /> Executive Summary
          </CardTitle>
          <CardDescription>
            The PrepCorex commission agent program is designed to be simple, transparent, and performance-based, while
            protecting the company's margin.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-700">
          <p>
            We use a <span className="font-semibold">tiered percentage commission</span> instead of flat-dollar payouts.
            Every approved commission agent starts at <span className="font-semibold">Bronze = 5%</span> and can be
            upgraded to <span className="font-semibold">Silver = 7%</span> or
            <span className="font-semibold"> Gold = 8%</span> based on monthly performance.
          </p>
          <p>
            Commission is payable on each referred client for a maximum of <span className="font-semibold">12 months</span>{" "}
            from that client's first paid invoice. After this 12-month window expires, the client no longer generates any
            commission for the agent.
          </p>
          <p>
            The program uses a <span className="font-semibold">strict performance model</span>: no retroactive upgrades,
            no permanent tier lock, downgrades after 2 consecutive underperforming months, and only paid invoices from
            active referred clients are counted.
          </p>
        </CardContent>
      </Card>

      {/* TIER MODEL */}
      <div className="grid gap-4 lg:grid-cols-3">
        {tiers.map((tier) => {
          const Icon = tier.icon;
          return (
            <Card key={tier.name} className="overflow-hidden border-slate-200 shadow-sm">
              <div className={`bg-gradient-to-r ${tier.color} p-4 text-white`}>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/15">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold">{tier.name}</h3>
                    <p className="text-sm opacity-90">Commission rate: {tier.rate}</p>
                  </div>
                </div>
              </div>
              <CardContent className="space-y-3 p-4">
                <p className="text-sm text-slate-700">{tier.description}</p>
                <ul className="space-y-2 text-sm">
                  {tier.requirements.map((req, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                      <span className="text-slate-700">{req}</span>
                    </li>
                  ))}
                </ul>
                <Badge variant="outline" className={tier.badge}>{tier.rate} commission rate</Badge>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* QUALIFICATION LOGIC */}
      <Card className="border-blue-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Target className="h-5 w-5 text-blue-600" /> Qualification Logic
          </CardTitle>
          <CardDescription>How qualifying revenue and consecutive months are measured.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h4 className="mb-1 text-sm font-semibold text-slate-900">Qualified Revenue Definition</h4>
            <p className="text-sm text-slate-700">
              Qualified revenue for an agent in a given month is the sum of all <span className="font-semibold">paid
              invoices</span> from clients <span className="font-semibold">referred by that agent</span>, where the
              client is still inside the 12-month commission eligibility period.
            </p>
          </div>

          <Table containerClassName="overflow-x-auto mouse-h-scroll">
            <TableHeader>
              <TableRow>
                <TableHead>Promotion Path</TableHead>
                <TableHead>Required Monthly Revenue</TableHead>
                <TableHead>Consecutive Qualifying Months</TableHead>
                <TableHead>Resulting Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Bronze → Silver</TableCell>
                <TableCell>$25,000 / month</TableCell>
                <TableCell>3 consecutive months</TableCell>
                <TableCell>
                  <Badge className="bg-slate-100 text-slate-800">7%</Badge>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Silver → Gold</TableCell>
                <TableCell>$50,000 / month</TableCell>
                <TableCell>6 consecutive months</TableCell>
                <TableCell>
                  <Badge className="bg-yellow-100 text-yellow-800">8%</Badge>
                </TableCell>
              </TableRow>
              <TableRow className="bg-rose-50/40">
                <TableCell className="font-medium">Gold → Silver</TableCell>
                <TableCell>Below $50,000 / month</TableCell>
                <TableCell>2 consecutive non-qualifying months</TableCell>
                <TableCell>
                  <Badge className="bg-slate-100 text-slate-800">7%</Badge>
                </TableCell>
              </TableRow>
              <TableRow className="bg-rose-50/40">
                <TableCell className="font-medium">Silver → Bronze</TableCell>
                <TableCell>Below $25,000 / month</TableCell>
                <TableCell>2 consecutive non-qualifying months</TableCell>
                <TableCell>
                  <Badge className="bg-amber-100 text-amber-800">5%</Badge>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>

          <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50/60 p-3 text-xs text-blue-800">
            <Info className="mt-0.5 h-4 w-4" />
            <p>Missing the monthly revenue threshold breaks the qualifying-month streak.</p>
          </div>
        </CardContent>
      </Card>

      {/* COMMISSION WINDOW */}
      <Card className="border-emerald-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="h-5 w-5 text-emerald-600" /> Commission Window Per Client
          </CardTitle>
          <CardDescription>The 12-month rule that limits commission to one year per client.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-slate-700">
          <p>
            Commission is payable on eligible paid invoices from referred clients for a maximum period of{" "}
            <span className="font-semibold">twelve (12) months per referred client</span>, beginning from the date of
            the referred client's <span className="font-semibold">first paid invoice</span>.
          </p>
          <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-3 italic text-emerald-900">
            "Commission is payable on eligible paid invoices from referred clients for a maximum period of twelve (12)
            months per referred client, beginning from the date of the referred client's first paid invoice."
          </div>
          <ul className="space-y-1.5 text-sm">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>Prevents indefinite commission leakage</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>Keeps acquisition economics under control</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>Rewards the agent for winning the client, not owning the client forever</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>Creates a fair but disciplined model</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                After expiry, the client is automatically removed from your Active Clients tab because they are no
                longer commission-eligible
              </span>
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* STRICT RULES */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-5 w-5 text-rose-600" /> Strict Commercial Rules
          </CardTitle>
          <CardDescription>The seven program rules that protect program integrity.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-2">
          {strictRules.map((rule) => {
            const Icon = rule.icon;
            return (
              <div
                key={rule.title}
                className="flex items-start gap-3 rounded-lg border bg-white p-4 transition hover:shadow-sm"
              >
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${rule.color}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-slate-900">{rule.title}</h4>
                  <ul className="space-y-1 text-xs text-slate-600">
                    {rule.details.map((d, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <span className="text-slate-400">•</span>
                        <span>{d}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* EXAMPLES */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Award className="h-5 w-5 text-amber-600" /> Example Scenarios
          </CardTitle>
          <CardDescription>
            Real-world examples to help you understand how the commission program works.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-2">
          {examples.map((ex) => {
            const Icon = ex.icon;
            return (
              <div key={ex.title} className={`rounded-lg border p-4 ${ex.color}`}>
                <div className="mb-2 flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  <h4 className="text-sm font-semibold">{ex.title}</h4>
                </div>
                <ul className="space-y-1 text-xs text-slate-700">
                  {ex.text.map((line, idx) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      <span className="text-slate-400">•</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* DASHBOARD CONTENT */}
      <Card className="border-violet-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Repeat className="h-5 w-5 text-violet-600" /> What's Tracked on Your Dashboard
          </CardTitle>
          <CardDescription>Live performance metrics shown to every commission agent.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {dashboardItems.map((item) => (
            <div key={item} className="flex items-start gap-2 rounded-md border bg-violet-50/40 p-3 text-sm">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
              <span className="text-slate-700">{item}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* WARNING */}
      <Card className="border-rose-200 bg-rose-50/40">
        <CardContent className="flex items-start gap-3 p-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-rose-900">Important Notice</h4>
            <p className="text-xs text-rose-800">
              Tier upgrades and downgrades are evaluated automatically. Any attempt to manipulate referrals or invoices
              may result in disqualification from the program. Final commission decisions remain with PrepCorex.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* CONTACT */}
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Mail className="mt-0.5 h-5 w-5 text-blue-600" />
            <div>
              <h4 className="text-sm font-semibold text-slate-900">Have questions about the program?</h4>
              <p className="text-xs text-slate-600">
                Contact our affiliate support team for clarifications about your tier, payouts, or referrals.
              </p>
            </div>
          </div>
          <a
            href="mailto:support@prepcorex.com"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
          >
            <Mail className="h-4 w-4" />
            support@prepcorex.com
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
