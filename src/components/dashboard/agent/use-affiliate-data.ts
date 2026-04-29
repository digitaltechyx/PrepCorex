"use client";

import { useMemo } from "react";
import { collection, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import type { Commission, Invoice, UserProfile } from "@/types";

export function useAffiliateData() {
  const { userProfile } = useAuth();

  const { data: allUsers, loading: usersLoading } = useCollection<UserProfile>("users");

  const commissionsQuery = useMemo(() => {
    if (!userProfile?.uid) return undefined;
    return query(collection(db, "commissions"), where("agentId", "==", userProfile.uid));
  }, [userProfile?.uid]);

  const { data: commissions, loading: commissionsLoading } = useCollection<Commission>(
    userProfile?.uid ? "commissions" : "",
    commissionsQuery
  );

  const referredClients = useMemo(() => {
    if (!userProfile?.uid) return [];
    return allUsers.filter((u) => u.role === "user" && u.referredByAgentId === userProfile.uid);
  }, [allUsers, userProfile?.uid]);

  const activeClients = useMemo(
    () => referredClients.filter((c) => c.status === "approved" || !c.status),
    [referredClients]
  );
  const pendingClients = useMemo(
    () => referredClients.filter((c) => c.status === "pending"),
    [referredClients]
  );
  const rejectedClients = useMemo(
    () => referredClients.filter((c) => c.status === "deleted"),
    [referredClients]
  );

  const paidInvoices = useMemo(() => {
    if (!userProfile?.uid) return [] as (Invoice & { commissionStatus?: string })[];
    return commissions
      .filter((c) => c.agentId === userProfile.uid)
      .map((c) => ({
        id: c.invoiceId,
        invoiceNumber: c.invoiceNumber,
        grandTotal: c.invoiceAmount,
        status: "paid" as const,
        date: c.createdAt,
        userId: c.clientId,
        commissionStatus: c.status,
      }));
  }, [commissions, userProfile?.uid]);

  const pendingCommissionTotal = useMemo(
    () => commissions.filter((c) => c.status === "pending").reduce((sum, c) => sum + (c.commissionAmount || 0), 0),
    [commissions]
  );

  const paidCommissionTotal = useMemo(
    () => commissions.filter((c) => c.status === "paid").reduce((sum, c) => sum + (c.commissionAmount || 0), 0),
    [commissions]
  );

  return {
    userProfile,
    loading: usersLoading || commissionsLoading,
    referredClients,
    activeClients,
    pendingClients,
    rejectedClients,
    commissions,
    paidInvoices,
    pendingCommissionTotal,
    paidCommissionTotal,
  };
}

