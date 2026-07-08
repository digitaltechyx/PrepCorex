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
  const col = adminDb().collection("affiliateAuditTrail");

  let events: AffiliateAuditEvent[];

  if (options.agentId) {
    // Avoid compound index (agentId + occurredAt) — filter in Firestore, sort in memory.
    const snap = await col.where("agentId", "==", options.agentId).get();
    events = snap.docs.map((doc) => mapDoc(doc.id, doc.data()));
  } else {
    try {
      const snap = await col.orderBy("occurredAt", "desc").limit(limit).get();
      events = snap.docs.map((doc) => mapDoc(doc.id, doc.data()));
      return events;
    } catch {
      const snap = await col.limit(limit).get();
      events = snap.docs.map((doc) => mapDoc(doc.id, doc.data()));
    }
  }

  events.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  return events.slice(0, limit);
}

/** Backfill display events from commission records when live audit log is sparse. */
export async function enrichAffiliateAuditWithCommissions(
  agentId: string,
  agentName: string | null | undefined,
  events: AffiliateAuditEvent[]
): Promise<AffiliateAuditEvent[]> {
  const liveKeys = new Set(
    events
      .filter((e) => !e.id.startsWith("legacy-"))
      .map((e) => {
        const meta = e.metadata || {};
        if (e.type === "commission_created" && meta.commissionId) return `created:${meta.commissionId}`;
        if (e.type === "commission_paid" && meta.commissionId) return `paid:${meta.commissionId}`;
        return null;
      })
      .filter(Boolean)
  );

  const snap = await adminDb()
    .collection("commissions")
    .where("agentId", "==", agentId)
    .get();

  const synthetic: AffiliateAuditEvent[] = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const commissionId = doc.id;
    const createdAt = toIso(data.createdAt) || new Date().toISOString();
    const rate = data.commissionRate ?? null;
    const tier = data.tier ?? null;
    const amount = data.commissionAmount ?? 0;
    const invoiceNumber = data.invoiceNumber ?? "—";
    const clientName = data.clientName ?? "client";

    if (!liveKeys.has(`created:${commissionId}`)) {
      synthetic.push({
        id: `legacy-created-${commissionId}`,
        agentId,
        agentName: agentName ?? data.agentName ?? null,
        type: "commission_created",
        action: "Commission generated (historical)",
        description: `Commission of $${Number(amount).toFixed(2)}${rate ? ` (${rate}%${tier ? ` ${tier}` : ""})` : ""} for invoice ${invoiceNumber} from ${clientName}.`,
        occurredAt: createdAt,
        performedByUid: null,
        performedByName: "System (recovered)",
        metadata: {
          commissionId,
          invoiceId: data.invoiceId,
          invoiceNumber,
          clientId: data.clientId,
          clientName,
          commissionAmount: amount,
          commissionRate: rate,
          tier,
          source: "commission_backfill",
        },
      });
    }

    if (data.status === "paid") {
      const paidAt = toIso(data.paidAt) || createdAt;
      if (!liveKeys.has(`paid:${commissionId}`)) {
        synthetic.push({
          id: `legacy-paid-${commissionId}`,
          agentId,
          agentName: agentName ?? data.agentName ?? null,
          type: "commission_paid",
          action: "Commission paid (historical)",
          description: `Commission of $${Number(amount).toFixed(2)} paid for invoice ${invoiceNumber}.`,
          occurredAt: paidAt,
          performedByUid: data.paidBy ?? null,
          performedByName: "System (recovered)",
          metadata: {
            commissionId,
            invoiceId: data.invoiceId,
            invoiceNumber,
            clientId: data.clientId,
            clientName,
            commissionAmount: amount,
            commissionRate: rate,
            tier,
            source: "commission_backfill",
          },
        });
      }
    }
  }

  return [...events, ...synthetic].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  );
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
