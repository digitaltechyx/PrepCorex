"use client";

import { auth } from "@/lib/firebase";
import type { UserAuditEventType } from "@/types";

const SESSION_STORAGE_KEY = "prepcorex_audit_session";

export type AuditSession = {
  sessionId: string;
  sessionStartedAt: string;
};

export function getAuditSession(): AuditSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuditSession;
    if (!parsed.sessionId || !parsed.sessionStartedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function beginAuditSession(): AuditSession {
  const session: AuditSession = {
    sessionId: crypto.randomUUID(),
    sessionStartedAt: new Date().toISOString(),
  };
  if (typeof window !== "undefined") {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  }
  return session;
}

export function clearAuditSession(): void {
  if (typeof window !== "undefined") {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

export type LogUserAuditOptions = {
  action?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  session?: AuditSession | null;
};

export async function logUserAuditEvent(
  type: UserAuditEventType,
  options: LogUserAuditOptions = {}
): Promise<void> {
  try {
    const user = auth.currentUser;
    if (!user) return;

    const token = await user.getIdToken();
    const session = options.session ?? getAuditSession();

    await fetch("/api/audit/log", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        type,
        action: options.action,
        description: options.description,
        sessionId: session?.sessionId,
        sessionStartedAt: session?.sessionStartedAt,
        metadata: options.metadata,
      }),
    });
  } catch {
    // Non-blocking — audit must not break user flows
  }
}

/** Map dashboard paths to friendly action labels for audit logs. */
export function friendlyPathAction(pathname: string): string {
  const map: Record<string, string> = {
    "/dashboard": "Viewed Dashboard",
    "/dashboard/inventory": "Viewed Inventory",
    "/dashboard/inbound": "Viewed Inbound",
    "/dashboard/outbound": "Viewed Outbound",
    "/dashboard/shipment-requests": "Viewed Shipment Requests",
    "/dashboard/integrations": "Viewed Integrations",
    "/dashboard/invoices": "Viewed Invoices",
    "/dashboard/quotes": "Viewed Quotes",
    "/dashboard/activate-account": "Viewed Account Activation",
    "/admin/dashboard": "Viewed Admin Dashboard",
    "/admin/dashboard/users": "Viewed User Management",
    "/admin/dashboard/integrations": "Viewed Admin Integrations",
    "/admin/dashboard/invoices": "Viewed Admin Invoices",
    "/admin/dashboard/quotes": "Viewed Admin Quotes",
    "/admin/dashboard/legal-templates": "Viewed Legal Templates",
  };
  if (map[pathname]) return map[pathname];
  return `Viewed ${pathname}`;
}
