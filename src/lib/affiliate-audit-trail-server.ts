import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { getAffiliateAuditEventLabel } from "@/lib/affiliate-audit-trail-display";
import type { AffiliateAuditEvent, AffiliateAuditEventType } from "@/types";

export type AppendAffiliateAuditInput = {
  agentId: string;
  agentName?: string | null;
  type: AffiliateAuditEventType;
  action?: string | null;
  description?: string | null;
  performedByUid?: string | null;
  performedByName?: string | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: Date;
};

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

function mapDoc(id: string, data: FirebaseFirestore.DocumentData): AffiliateAuditEvent {
  const occurredAt =
    toIso(data.occurredAt) || toIso(data.createdAt) || new Date().toISOString();

  return {
    id,
    agentId: data.agentId || "",
    agentName: data.agentName ?? null,
    type: data.type as AffiliateAuditEventType,
    action: data.action ?? null,
    description: data.description ?? null,
    occurredAt,
    performedByUid: data.performedByUid ?? null,
    performedByName: data.performedByName ?? null,
    metadata: (data.metadata as Record<string, unknown> | undefined) ?? null,
  };
}

export async function appendAffiliateAuditEvent(
  input: AppendAffiliateAuditInput
): Promise<string> {
  const occurredAt = input.occurredAt ?? new Date();
  const ref = adminDb().collection("affiliateAuditTrail").doc();

  await ref.set({
    agentId: input.agentId,
    agentName: input.agentName ?? null,
    type: input.type,
    action: input.action ?? null,
    description: input.description ?? null,
    performedByUid: input.performedByUid ?? null,
    performedByName: input.performedByName ?? null,
    metadata: input.metadata ?? null,
    occurredAt: Timestamp.fromDate(occurredAt),
    createdAt: FieldValue.serverTimestamp(),
  });

  return ref.id;
}

export async function getAffiliateAuditTrail(
  options: { agentId?: string; limit?: number } = {}
): Promise<AffiliateAuditEvent[]> {
  const limit = Math.min(Math.max(options.limit ?? 500, 1), 2000);
  let q: FirebaseFirestore.Query = adminDb()
    .collection("affiliateAuditTrail")
    .orderBy("occurredAt", "desc")
    .limit(limit);

  if (options.agentId) {
    q = adminDb()
      .collection("affiliateAuditTrail")
      .where("agentId", "==", options.agentId)
      .orderBy("occurredAt", "desc")
      .limit(limit);
  }

  const snap = await q.get();
  return snap.docs.map((doc) => mapDoc(doc.id, doc.data()));
}

export function affiliateAuditEventsToCsv(
  events: AffiliateAuditEvent[],
  agentLabel?: string
): string {
  const header = [
    "Agent",
    "Event Type",
    "Action",
    "Description",
    "Occurred At",
    "Performed By",
    "Metadata",
  ];

  const rows = events.map((event) => [
    agentLabel || event.agentName || event.agentId,
    getAffiliateAuditEventLabel(event.type),
    event.action || "",
    event.description || "",
    event.occurredAt,
    event.performedByName || event.performedByUid || "",
    event.metadata ? JSON.stringify(event.metadata) : "",
  ]);

  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return [header, ...rows].map((row) => row.map((cell) => escape(String(cell))).join(",")).join("\n");
}
