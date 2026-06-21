"use client";

import { useMemo } from "react";
import { useCollection } from "@/hooks/use-collection";
import type { UserProfile } from "@/types";

export function isWarehouseOpsClient(user: UserProfile, includeUnapproved = false): boolean {
  const isClient = user.role === "user" || (user.roles ?? []).includes("user");
  if (!isClient) return false;
  if (!includeUnapproved && user.status !== "approved") return false;
  return true;
}

/** Approved client users for warehouse floor queues (pick, pack, dispatch). */
export function useWarehouseOpsClients(options?: { includeUnapproved?: boolean }) {
  const includeUnapproved = options?.includeUnapproved ?? false;
  const { data: allUsers, loading } = useCollection<UserProfile>("users");
  const clients = useMemo(
    () => allUsers.filter((u) => isWarehouseOpsClient(u, includeUnapproved)),
    [allUsers, includeUnapproved]
  );
  return { clients, loading };
}
