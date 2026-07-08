"use client";

import { useMemo } from "react";
import { format } from "date-fns";
import type { Commission, UserProfile } from "@/types";
import { getUserRoles } from "@/lib/permissions";
import {
  computeAgentTier,
  getClientCommissionWindow,
  parseCommissionDate,
} from "@/lib/affiliate-tier-utils";

export type AgentSummary = {
  agent: UserProfile;
  tier: ReturnType<typeof computeAgentTier>["tier"];
  rate: number;
  referredClients: UserProfile[];
  activeClients: UserProfile[];
  pendingClients: UserProfile[];
  commissions: Commission[];
  pendingTotal: number;
  paidTotal: number;
  totalEarned: number;
  currentMonthEarned: number;
  currentMonthRevenue: number;
};

export function useAdminAffiliateData(
  users: UserProfile[],
  commissions: Commission[]
) {
  const commissionAgents = useMemo(() => {
    return users.filter((user) => getUserRoles(user).includes("commission_agent"));
  }, [users]);

  const referredClientsByAgent = useMemo(() => {
    const map = new Map<string, UserProfile[]>();
    for (const user of users) {
      if (!user.referredByAgentId) continue;
      const list = map.get(user.referredByAgentId) || [];
      list.push(user);
      map.set(user.referredByAgentId, list);
    }
    return map;
  }, [users]);

  const commissionsByAgent = useMemo(() => {
    const map = new Map<string, Commission[]>();
    for (const commission of commissions) {
      const list = map.get(commission.agentId) || [];
      list.push(commission);
      map.set(commission.agentId, list);
    }
    return map;
  }, [commissions]);

  const agentSummaries = useMemo((): AgentSummary[] => {
    const currentMonthKey = format(new Date(), "yyyy-MM");

    return commissionAgents.map((agent) => {
      const agentCommissions = commissionsByAgent.get(agent.uid) || [];
      const referredClients = referredClientsByAgent.get(agent.uid) || [];
      const tierInfo = computeAgentTier(agentCommissions);

      const pendingTotal = agentCommissions
        .filter((c) => c.status === "pending")
        .reduce((sum, c) => sum + (c.commissionAmount || 0), 0);
      const paidTotal = agentCommissions
        .filter((c) => c.status === "paid")
        .reduce((sum, c) => sum + (c.commissionAmount || 0), 0);

      const currentMonthCommissions = agentCommissions.filter((c) => {
        const date = parseCommissionDate(c.createdAt);
        return date ? format(date, "yyyy-MM") === currentMonthKey : false;
      });

      return {
        agent,
        tier: tierInfo.tier,
        rate: tierInfo.rate,
        referredClients,
        activeClients: referredClients.filter((c) => c.status === "approved" || !c.status),
        pendingClients: referredClients.filter((c) => c.status === "pending"),
        commissions: agentCommissions.sort((a, b) => {
          const da = parseCommissionDate(a.createdAt)?.getTime() || 0;
          const db = parseCommissionDate(b.createdAt)?.getTime() || 0;
          return db - da;
        }),
        pendingTotal,
        paidTotal,
        totalEarned: pendingTotal + paidTotal,
        currentMonthEarned: currentMonthCommissions.reduce(
          (sum, c) => sum + (c.commissionAmount || 0),
          0
        ),
        currentMonthRevenue: tierInfo.currentMonthRevenue,
      };
    });
  }, [commissionAgents, commissionsByAgent, referredClientsByAgent]);

  const networkStats = useMemo(() => {
    const approvedAgents = commissionAgents.filter(
      (a) => a.status === "approved" || !a.status
    );
    const pendingAgents = commissionAgents.filter((a) => a.status === "pending");
    const totalPending = commissions
      .filter((c) => c.status === "pending")
      .reduce((sum, c) => sum + (c.commissionAmount || 0), 0);
    const totalPaid = commissions
      .filter((c) => c.status === "paid")
      .reduce((sum, c) => sum + (c.commissionAmount || 0), 0);
    const referredClients = users.filter((u) => !!u.referredByAgentId);

    return {
      totalAgents: commissionAgents.length,
      approvedAgents: approvedAgents.length,
      pendingAgents: pendingAgents.length,
      totalReferredClients: referredClients.length,
      totalPendingCommission: totalPending,
      totalPaidCommission: totalPaid,
      totalCommission: totalPending + totalPaid,
    };
  }, [commissionAgents, commissions, users]);

  return {
    commissionAgents,
    agentSummaries,
    networkStats,
    getClientWindow: (agentId: string, clientId: string) => {
      const clientCommissions = (commissionsByAgent.get(agentId) || []).filter(
        (c) => c.clientId === clientId
      );
      return getClientCommissionWindow(clientCommissions);
    },
  };
}
