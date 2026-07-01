import type { UserAuditEvent, UserAuditEventType } from "@/types";

export const USER_AUDIT_EVENT_LABELS: Record<UserAuditEventType, string> = {
  account_created: "Account Created",
  sign_in: "Sign In",
  sign_out: "Sign Out",
  account_approved: "Account Approved",
  profile_completed: "Profile Completed",
  account_activated: "Account Activated",
  user_action: "User Action",
};

export function formatSessionDuration(ms: number | null | undefined): string {
  if (ms == null || ms < 0 || !Number.isFinite(ms)) return "—";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function getAuditEventDisplayLabel(event: UserAuditEvent): string {
  if (event.type === "user_action" && event.action) return event.action;
  return USER_AUDIT_EVENT_LABELS[event.type] ?? event.type;
}
