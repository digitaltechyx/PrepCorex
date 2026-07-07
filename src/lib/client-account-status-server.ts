import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  buildAccountDeletedEmail,
  buildAccountDisabledEmail,
  buildAccountEnabledEmail,
  buildAccountLockedEmail,
  buildAccountRestoredEmail,
  buildAccountUnlockedEmail,
} from "@/lib/account-email-templates";
import { isClientPortalAccount } from "@/lib/client-account-status";
import { adminDb } from "@/lib/firebase-admin";
import { getUserRoles } from "@/lib/permissions";
import { friendlySmtpErrorMessage, getAppLoginUrl, sendTransactionalEmail } from "@/lib/smtp-send";
import type { AuditRequestMeta } from "@/lib/user-audit-request-meta";
import { appendUserAuditEvent } from "@/lib/user-audit-trail-server";
import type { UserProfile, UserRole, UserStatus } from "@/types";

export type ClientAccountStatusAction =
  | "lock"
  | "unlock"
  | "disable"
  | "enable"
  | "delete"
  | "restore";

export type ApplyClientAccountStatusResult = {
  success: true;
  status: UserStatus;
  emailSent: boolean;
  emailError?: string;
};

export type ApplyClientAccountStatusContext = {
  reason?: "inactivity" | "manual";
  meta?: AuditRequestMeta;
  performedByUid?: string | null;
  skipClientOnlyCheck?: boolean;
};

function normalizeRoles(data: FirebaseFirestore.DocumentData): UserRole[] {
  const normalize = (v: unknown): UserRole | null => {
    const s = String(v || "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    if (s === "admin") return "admin";
    if (s === "sub_admin" || s === "subadmin") return "sub_admin";
    if (s === "commission_agent" || s === "commissionagent") return "commission_agent";
    if (s === "user") return "user";
    if (s === "warehouse_operator" || s === "warehouseoperator") return "warehouse_operator";
    return null;
  };

  if (Array.isArray(data.roles)) {
    return data.roles.map(normalize).filter(Boolean) as UserRole[];
  }
  const single = normalize(data.role);
  return single ? [single] : ["user"];
}

function isClientUserData(data: FirebaseFirestore.DocumentData): boolean {
  return isClientPortalAccount({
    role: data.role as UserProfile["role"],
    roles: normalizeRoles(data),
  });
}

async function sendStatusEmail(
  user: FirebaseFirestore.DocumentData,
  action: ClientAccountStatusAction
): Promise<{ emailSent: boolean; emailError?: string }> {
  const to = String(user.email || "").trim();
  if (!to) {
    return { emailSent: false, emailError: "User has no email address on file." };
  }

  const loginUrl = getAppLoginUrl();
  const contactName = String(user.name || "there");
  const mailBuilders = {
    lock: () => buildAccountLockedEmail({ contactName, loginUrl }),
    unlock: () => buildAccountUnlockedEmail({ contactName, loginUrl }),
    disable: () => buildAccountDisabledEmail({ contactName, loginUrl }),
    enable: () => buildAccountEnabledEmail({ contactName, loginUrl }),
    delete: () => buildAccountDeletedEmail({ contactName, loginUrl }),
    restore: () => buildAccountRestoredEmail({ contactName, loginUrl }),
  } as const;

  try {
    const mail = mailBuilders[action]();
    await sendTransactionalEmail({ to, ...mail });
    return { emailSent: true };
  } catch (error) {
    const message = friendlySmtpErrorMessage(error);
    console.error(`[applyClientAccountStatusAction] ${action} email failed:`, message);
    return { emailSent: false, emailError: message };
  }
}

const AUDIT_TYPES: Record<ClientAccountStatusAction, string> = {
  lock: "account_locked",
  unlock: "account_unlocked",
  disable: "account_disabled",
  enable: "account_enabled",
  delete: "account_deleted",
  restore: "account_restored",
};

export async function applyClientAccountStatusAction(
  uid: string,
  action: ClientAccountStatusAction,
  context: ApplyClientAccountStatusContext = {}
): Promise<ApplyClientAccountStatusResult> {
  const ref = adminDb().collection("users").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error("User not found.");
  }

  const user = snap.data()!;
  const status = String(user.status || "approved") as UserStatus;

  if (!context.skipClientOnlyCheck && !isClientUserData(user)) {
    const clientOnlyActions: ClientAccountStatusAction[] = ["lock", "unlock", "disable", "enable"];
    if (clientOnlyActions.includes(action)) {
      throw new Error("Lock and disable actions only apply to client portal users.");
    }
  }

  const reason = context.reason || "manual";
  const now = FieldValue.serverTimestamp();
  const loginReset = Timestamp.now();
  let nextStatus: UserStatus = status;
  const update: Record<string, unknown> = { updatedAt: now };

  switch (action) {
    case "lock":
      if (status === "locked") throw new Error("User is already locked.");
      if (status === "disabled") throw new Error("Re-enable the user instead of locking.");
      if (status === "deleted") throw new Error("Restore the user before locking.");
      if (status === "pending") throw new Error("Approve the user before locking.");
      nextStatus = "locked";
      update.status = "locked";
      update.lockedAt = now;
      update.accountStatusReason = reason;
      update.disabledAt = FieldValue.delete();
      break;
    case "unlock":
      if (status !== "locked") throw new Error("User is not locked.");
      nextStatus = "approved";
      update.status = "approved";
      update.lockedAt = FieldValue.delete();
      update.accountStatusReason = FieldValue.delete();
      update.lastLoginAt = loginReset;
      break;
    case "disable":
      if (status === "disabled") throw new Error("User is already disabled.");
      if (status === "deleted") throw new Error("Restore the user before disabling.");
      if (status === "pending") throw new Error("Approve the user before disabling.");
      nextStatus = "disabled";
      update.status = "disabled";
      update.disabledAt = now;
      update.accountStatusReason = reason;
      update.lockedAt = FieldValue.delete();
      break;
    case "enable":
      if (status !== "disabled") throw new Error("User is not disabled.");
      nextStatus = "approved";
      update.status = "approved";
      update.disabledAt = FieldValue.delete();
      update.accountStatusReason = FieldValue.delete();
      update.lastLoginAt = loginReset;
      break;
    case "delete":
      if (status === "deleted") throw new Error("User is already deleted.");
      nextStatus = "deleted";
      update.status = "deleted";
      update.deletedAt = now;
      break;
    case "restore":
      if (status !== "deleted") throw new Error("User is not deleted.");
      nextStatus = "approved";
      update.status = "approved";
      update.approvedAt = now;
      update.deletedAt = FieldValue.delete();
      update.lastLoginAt = loginReset;
      break;
    default:
      throw new Error("Unsupported account action.");
  }

  await ref.set(update, { merge: true });

  try {
    await appendUserAuditEvent(uid, {
      type: AUDIT_TYPES[action],
      description: `Account ${action} ${context.performedByUid ? "by administrator" : "by system"}.`,
      meta: context.meta,
      performedByUid: context.performedByUid ?? null,
    });
  } catch (error) {
    console.error("[applyClientAccountStatusAction] audit log failed:", error);
  }

  const email = await sendStatusEmail(user, action);
  return {
    success: true,
    status: nextStatus,
    emailSent: email.emailSent,
    emailError: email.emailError,
  };
}

export async function recordClientLastLogin(uid: string): Promise<void> {
  const ref = adminDb().collection("users").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return;

  const user = snap.data()!;
  if (!isClientUserData(user)) return;

  const status = String(user.status || "approved");
  if (status !== "approved") return;

  await ref.set({ lastLoginAt: FieldValue.serverTimestamp() }, { merge: true });
}
