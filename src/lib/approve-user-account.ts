import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { buildAccountApprovedEmail } from "@/lib/account-email-templates";
import { adminDb } from "@/lib/firebase-admin";
import { getDefaultFeaturesForRole } from "@/lib/permissions";
import { getAppLoginUrl, sendTransactionalEmail } from "@/lib/smtp-send";
import type { UserRole } from "@/types";

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

function isClientPortalUser(roles: UserRole[]): boolean {
  return roles.includes("user");
}

export type ApproveUserResult = {
  emailSent: boolean;
  emailError?: string;
};

export async function approveUserAccount(uid: string): Promise<ApproveUserResult> {
  const ref = adminDb().collection("users").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error("User not found.");
  }

  const user = snap.data()!;
  if (user.status === "approved") {
    throw new Error("User is already approved.");
  }
  if (user.status === "deleted") {
    throw new Error("Restore the user before approving.");
  }

  const roles = normalizeRoles(user);
  const updateData: Record<string, unknown> = {
    status: "approved",
    approvedAt: FieldValue.serverTimestamp(),
  };

  if (!Array.isArray(user.roles) || user.roles.length === 0) {
    updateData.roles = roles;
  }

  const existingFeatures = Array.isArray(user.features) ? user.features : [];
  if (existingFeatures.length === 0 && !isClientPortalUser(roles)) {
    const defaultFeatures: string[] = [];
    for (const role of roles) {
      for (const feature of getDefaultFeaturesForRole(role)) {
        if (!defaultFeatures.includes(feature)) defaultFeatures.push(feature);
      }
    }
    if (defaultFeatures.length > 0) {
      updateData.features = defaultFeatures;
    }
  }

  await ref.set(updateData, { merge: true });

  const to = String(user.email || "").trim();
  if (!to) {
    return { emailSent: false, emailError: "User has no email address on file." };
  }

  try {
    const mail = buildAccountApprovedEmail({
      contactName: String(user.name || "there"),
      companyName: String(user.companyName || "your company"),
      loginUrl: getAppLoginUrl(),
    });
    await sendTransactionalEmail({ to, ...mail });
    await ref.set({ approvalEmailSentAt: Timestamp.now() }, { merge: true });
    return { emailSent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send approval email.";
    console.error("[approveUserAccount] email failed:", message);
    return { emailSent: false, emailError: message };
  }
}
