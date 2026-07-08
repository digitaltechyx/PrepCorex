import { format, subDays, differenceInCalendarDays } from "date-fns";
import { adminDb } from "@/lib/firebase-admin";
import { computeAgentTier } from "@/lib/affiliate-tier-utils";
import type { Commission, UserProfile } from "@/types";
import type { AdminReportCommissionRow, AgentStatementSummary } from "@/lib/admin-reports-types";
import {
  isInReportRange,
  pctChange,
  reportEndOfDay,
  reportStartOfDay,
  reportToMs,
} from "@/lib/admin-reports-utils";

export type BuildAgentStatementInput = {
  agentId: string;
  from: Date;
  to: Date;
  allTime?: boolean;
};

async function loadAllCommissionsForAgent(agentId: string): Promise<AdminReportCommissionRow[]> {
  const snap = await adminDb().collection("commissions").where("agentId", "==", agentId).get();
  return snap.docs.map((doc) => {
    const data = doc.data() as Commission;
    return {
      id: doc.id,
      agentId: data.agentId,
      agentName: data.agentName,
      clientId: data.clientId,
      clientName: data.clientName,
      invoiceNumber: data.invoiceNumber,
      invoiceAmount: data.invoiceAmount || 0,
      commissionAmount: data.commissionAmount || 0,
      commissionRate: data.commissionRate,
      tier: data.tier,
      status: data.status,
      createdAt: new Date(reportToMs(data.createdAt) || Date.now()).toISOString(),
      paidAt: data.paidAt ? new Date(reportToMs(data.paidAt)).toISOString() : undefined,
    };
  });
}

export async function buildAgentStatement(input: BuildAgentStatementInput): Promise<AgentStatementSummary | null> {
  const allTime = input.allTime ?? false;
  const from = reportStartOfDay(input.from);
  const to = reportEndOfDay(input.to);

  const agentSnap = await adminDb().collection("users").doc(input.agentId).get();
  if (!agentSnap.exists) return null;
  const agent = { ...(agentSnap.data() as UserProfile), uid: agentSnap.id };

  const allCommissions = await loadAllCommissionsForAgent(input.agentId);
  const tierInfo = computeAgentTier(allCommissions);

  const periodCommissions = allCommissions.filter((c) =>
    isInReportRange(new Date(reportToMs(c.createdAt)), from, to, allTime)
  );

  const periodDays = allTime ? 0 : differenceInCalendarDays(to, from) + 1;
  const priorTo = subDays(from, 1);
  const priorFrom = subDays(from, periodDays);
  const priorCommissions = allTime
    ? []
    : allCommissions.filter((c) =>
        isInReportRange(new Date(reportToMs(c.createdAt)), priorFrom, priorTo, false)
      );

  const totalPending = periodCommissions.filter((c) => c.status === "pending").reduce((s, c) => s + c.commissionAmount, 0);
  const totalPaid = periodCommissions.filter((c) => c.status === "paid").reduce((s, c) => s + c.commissionAmount, 0);
  const totalEarned = totalPending + totalPaid;
  const priorEarnings = priorCommissions.reduce((s, c) => s + c.commissionAmount, 0);
  const qualifiedRevenue = periodCommissions.reduce((s, c) => s + c.invoiceAmount, 0);

  const usersSnap = await adminDb().collection("users").where("referredByAgentId", "==", input.agentId).get();
  const referredClients = usersSnap.docs.map((d) => {
    const data = d.data() as UserProfile;
    return {
      id: d.id,
      name: data.name || "Unknown",
      email: data.email || "",
      status: data.status,
    };
  });

  const activeClientIds = new Set(periodCommissions.map((c) => c.clientId));

  const chartFrom = allTime ? subDays(new Date(), 365) : from;
  const chartTo = allTime ? new Date() : to;
  const buckets = new Map<string, { label: string; value: number }>();
  for (let t = chartFrom.getTime(); t <= chartTo.getTime(); t += 86400000) {
    const d = new Date(t);
    const key = format(d, allTime ? "yyyy-MM" : "yyyy-MM-dd");
    if (!buckets.has(key)) {
      buckets.set(key, { label: format(d, allTime ? "MMM yyyy" : "MMM d"), value: 0 });
    }
  }
  for (const c of periodCommissions) {
    const key = format(new Date(c.createdAt), allTime ? "yyyy-MM" : "yyyy-MM-dd");
    const b = buckets.get(key);
    if (b) b.value += c.commissionAmount;
  }

  const revenueByClient = new Map<string, number>();
  for (const c of periodCommissions) {
    revenueByClient.set(c.clientName, (revenueByClient.get(c.clientName) || 0) + c.invoiceAmount);
  }

  return {
    period: {
      from: from.toISOString(),
      to: to.toISOString(),
      label: allTime ? "All time" : `${format(from, "MMM d, yyyy")} – ${format(to, "MMM d, yyyy")}`,
      allTime,
    },
    agent: {
      id: input.agentId,
      name: agent.name || "Commission Agent",
      email: agent.email || "",
      referralCode: agent.referralCode,
      tier: tierInfo.tier,
      rate: tierInfo.rate,
    },
    earnings: {
      totalEarned,
      totalPending,
      totalPaid,
      commissionCount: periodCommissions.length,
      qualifiedRevenue,
    },
    clients: {
      totalReferred: referredClients.length,
      activeInPeriod: activeClientIds.size,
    },
    growth: {
      earningsChangePct: allTime ? null : pctChange(totalEarned, priorEarnings),
      priorEarnings,
      revenueChangePct: allTime
        ? null
        : pctChange(
            qualifiedRevenue,
            priorCommissions.reduce((s, c) => s + c.invoiceAmount, 0)
          ),
    },
    charts: {
      earningsByDay: Array.from(buckets.values()),
      revenueByClient: Array.from(revenueByClient.entries())
        .map(([client, revenue]) => ({ client, revenue }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 8),
    },
    rows: {
      commissions: periodCommissions.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
      referredClients,
    },
  };
}
