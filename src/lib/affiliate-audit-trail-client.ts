import { auth } from "@/lib/firebase";
import type { AffiliateAuditEventType } from "@/types";

export async function logAffiliateAuditEvent(input: {
  agentId: string;
  agentName?: string | null;
  type: AffiliateAuditEventType;
  action?: string | null;
  description?: string | null;
  performedByUid?: string | null;
  performedByName?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return;

    await fetch("/api/admin/affiliate-management/audit-trail", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
  } catch {
    // Non-blocking — audit must not break user flows
  }
}
