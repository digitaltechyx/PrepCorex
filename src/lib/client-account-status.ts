import type { UserProfile } from "@/types";
import { getUserRoles } from "@/lib/permissions";

export const CLIENT_INACTIVITY_LOCK_DAYS = 30;
export const CLIENT_INACTIVITY_DISABLE_DAYS = 60;

const STAFF_ROLES = new Set(["admin", "sub_admin", "commission_agent", "warehouse_operator"]);

/** Client portal accounts only — not staff/agent roles. */
export function isClientPortalAccount(
  user: Pick<UserProfile, "role" | "roles"> | null | undefined
): boolean {
  if (!user) return false;
  const roles = getUserRoles(user as UserProfile);
  if (!roles.includes("user")) return false;
  return !roles.some((role) => STAFF_ROLES.has(role));
}

export function isAccountLocked(user: Pick<UserProfile, "status"> | null | undefined): boolean {
  return user?.status === "locked";
}

export function isAccountDisabled(user: Pick<UserProfile, "status"> | null | undefined): boolean {
  return user?.status === "disabled";
}

export function isAccountRestricted(user: Pick<UserProfile, "status"> | null | undefined): boolean {
  return isAccountLocked(user) || isAccountDisabled(user);
}

export function getClientAccountRestrictionMessage(
  status: UserProfile["status"] | undefined
): string {
  if (status === "disabled") {
    return "Your account has been disabled due to inactivity. Please contact the administrator.";
  }
  if (status === "locked") {
    return "You haven't logged into your account for 30 days. Your account is now locked. Please contact the administrator.";
  }
  return "";
}

export function asDateValue(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  if (typeof value === "object" && value !== null && "seconds" in value) {
    const seconds = Number((value as { seconds: number }).seconds);
    if (!Number.isFinite(seconds)) return null;
    return new Date(seconds * 1000);
  }
  return null;
}

export function getInactivityAnchorDate(user: Pick<UserProfile, "lastLoginAt" | "approvedAt" | "createdAt">): Date | null {
  return (
    asDateValue(user.lastLoginAt) ||
    asDateValue(user.approvedAt) ||
    asDateValue(user.createdAt) ||
    null
  );
}

export function getDaysSinceDate(date: Date, now = new Date()): number {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  return Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
}
