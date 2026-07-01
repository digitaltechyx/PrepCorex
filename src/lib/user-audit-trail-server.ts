import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import type { AuditRequestMeta } from "@/lib/user-audit-request-meta";
import {
  formatSessionDuration,
  getAuditEventDisplayLabel,
  USER_AUDIT_EVENT_LABELS,
} from "@/lib/user-audit-trail-display";
import type { UserAuditEvent, UserAuditEventType } from "@/types";

export { formatSessionDuration, getAuditEventDisplayLabel, USER_AUDIT_EVENT_LABELS };

export type AppendUserAuditInput = {
  type: UserAuditEventType;
  action?: string | null;
  description?: string | null;
  meta?: AuditRequestMeta;
  sessionId?: string | null;
  sessionStartedAt?: string | null;
  performedByUid?: string | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: Date;
};

function auditCollection(uid: string) {
  return adminDb().collection("users").doc(uid).collection("auditTrail");
}

function toIso(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value !== null) {
    if ("toDate" in value && typeof (value as { toDate: () => Date }).toDate === "function") {
      return (value as { toDate: () => Date }).toDate().toISOString();
    }
    if ("seconds" in value && typeof (value as { seconds: number }).seconds === "number") {
      return new Date((value as { seconds: number }).seconds * 1000).toISOString();
    }
  }
  return null;
}

function computeSessionDurationMs(sessionStartedAt?: string | null, at = new Date()): number | null {
  if (!sessionStartedAt) return null;
  const start = new Date(sessionStartedAt).getTime();
  if (Number.isNaN(start)) return null;
  return Math.max(0, at.getTime() - start);
}

function mapDoc(uid: string, id: string, data: FirebaseFirestore.DocumentData): UserAuditEvent {
  const occurredAt =
    toIso(data.occurredAt) ||
    toIso(data.createdAt) ||
    new Date().toISOString();

  return {
    id,
    userId: uid,
    type: data.type as UserAuditEventType,
    action: data.action ?? null,
    description: data.description ?? null,
    occurredAt,
    ipAddress: data.ipAddress ?? null,
    region: data.region ?? null,
    userAgent: data.userAgent ?? null,
    sessionId: data.sessionId ?? null,
    sessionStartedAt: toIso(data.sessionStartedAt),
    sessionDurationMs:
      typeof data.sessionDurationMs === "number"
        ? data.sessionDurationMs
        : computeSessionDurationMs(toIso(data.sessionStartedAt), new Date(occurredAt)),
    performedByUid: data.performedByUid ?? null,
    metadata: (data.metadata as Record<string, unknown> | undefined) ?? null,
    synthetic: data.synthetic === true,
  };
}

export async function appendUserAuditEvent(
  uid: string,
  input: AppendUserAuditInput
): Promise<string> {
  const at = input.occurredAt ?? new Date();
  const sessionDurationMs = computeSessionDurationMs(input.sessionStartedAt, at);
  const ref = auditCollection(uid).doc();

  const payload: Record<string, unknown> = {
    type: input.type,
    occurredAt: input.occurredAt ? Timestamp.fromDate(at) : FieldValue.serverTimestamp(),
    ipAddress: input.meta?.ipAddress ?? null,
    region: input.meta?.region ?? null,
    userAgent: input.meta?.userAgent ?? null,
    sessionId: input.sessionId ?? null,
    sessionStartedAt: input.sessionStartedAt ?? null,
    sessionDurationMs,
    performedByUid: input.performedByUid ?? null,
  };

  if (input.action) payload.action = input.action;
  if (input.description) payload.description = input.description;
  if (input.metadata && Object.keys(input.metadata).length > 0) payload.metadata = input.metadata;

  await ref.set(payload);
  return ref.id;
}

export async function listUserAuditEvents(
  uid: string,
  limit = 500
): Promise<UserAuditEvent[]> {
  const snap = await auditCollection(uid)
    .orderBy("occurredAt", "desc")
    .limit(limit)
    .get();

  return snap.docs.map((d) => mapDoc(uid, d.id, d.data()));
}

type ProfileBackfillSource = FirebaseFirestore.DocumentData | null | undefined;

function hasEventType(events: UserAuditEvent[], type: UserAuditEventType): boolean {
  return events.some((e) => e.type === type && !e.synthetic);
}

/** Merge legacy profile timestamps when no live audit log exists yet. */
export function enrichAuditTrailWithProfileEvents(
  uid: string,
  events: UserAuditEvent[],
  profile: ProfileBackfillSource
): UserAuditEvent[] {
  if (!profile) return events;

  const synthetic: UserAuditEvent[] = [];
  const pushSynthetic = (type: UserAuditEventType, at: string | null, description: string) => {
    if (!at || hasEventType(events, type)) return;
    synthetic.push({
      id: `legacy-${type}`,
      userId: uid,
      type,
      description,
      occurredAt: at,
      ipAddress: null,
      region: null,
      userAgent: null,
      sessionId: null,
      sessionStartedAt: null,
      sessionDurationMs: null,
      performedByUid: null,
      metadata: { source: "profile_backfill" },
      synthetic: true,
    });
  };

  pushSynthetic("account_created", toIso(profile.createdAt), "Recovered from account registration date.");
  pushSynthetic("account_approved", toIso(profile.approvedAt), "Recovered from account approval date.");
  pushSynthetic(
    "profile_completed",
    toIso(profile.onboardingProfileCompletedAt),
    "Recovered from onboarding profile completion date."
  );
  pushSynthetic(
    "account_activated",
    toIso(profile.accountActivatedAt),
    "Recovered from MSA account activation date."
  );

  return [...events, ...synthetic].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  );
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function auditEventsToCsv(events: UserAuditEvent[], userLabel: string): string {
  const header = [
    "User",
    "Date/Time (UTC)",
    "Event",
    "Details",
    "Region",
    "IP Address",
    "Session Start (UTC)",
    "Session Duration",
    "Session ID",
    "Source",
  ];

  const rows = events.map((event) => {
    const sessionStart = event.sessionStartedAt
      ? new Date(event.sessionStartedAt).toISOString()
      : "";
    return [
      userLabel,
      new Date(event.occurredAt).toISOString(),
      getAuditEventDisplayLabel(event),
      event.description || event.action || "",
      event.region || "",
      event.ipAddress || "",
      sessionStart,
      formatSessionDuration(event.sessionDurationMs),
      event.sessionId || "",
      event.synthetic ? "Profile backfill" : "Live log",
    ]
      .map((cell) => csvEscape(String(cell)))
      .join(",");
  });

  return [header.join(","), ...rows].join("\r\n");
}

export async function getUserAuditTrailForAdmin(
  uid: string,
  limit = 500
): Promise<{ events: UserAuditEvent[]; userLabel: string }> {
  const userSnap = await adminDb().collection("users").doc(uid).get();
  const profile = userSnap.exists ? userSnap.data() : null;
  const userLabel = String(profile?.name || profile?.email || uid);

  const events = await listUserAuditEvents(uid, limit);
  const enriched = enrichAuditTrailWithProfileEvents(uid, events, profile);
  return { events: enriched, userLabel };
}
