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

type UseWarehouseOpsClientsOptions = {
  includeUnapproved?: boolean;
  /**
   * Reuse an existing `users` snapshot so Warehouse Ops does not open a second
   * full-collection listener for the same data.
   */
  users?: UserProfile[];
  usersLoading?: boolean;
};

/** Approved client users for warehouse floor queues (pick, pack, dispatch). */
export function useWarehouseOpsClients(options?: UseWarehouseOpsClientsOptions) {
  const includeUnapproved = options?.includeUnapproved ?? false;
  const reuseUsers = options?.users !== undefined;
  // Empty path skips the listener when the caller already owns a users snapshot.
  const own = useCollection<UserProfile>(reuseUsers ? "" : "users");
  const allUsers = reuseUsers ? (options.users ?? []) : own.data;
  const loading = reuseUsers ? Boolean(options?.usersLoading) : own.loading;
  const clients = useMemo(
    () => allUsers.filter((u) => isWarehouseOpsClient(u, includeUnapproved)),
    [allUsers, includeUnapproved]
  );
  return { clients, loading };
}
