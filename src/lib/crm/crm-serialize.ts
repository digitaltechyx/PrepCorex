import type { CrmLeadRecord, CrmTimelineRecord } from "@/lib/crm/types";

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isFinite(t) ? new Date(t).toISOString() : value;
  }
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === "object" &&
    value &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  if (typeof value === "object" && value && "seconds" in value) {
    const sec = Number((value as { seconds: number }).seconds);
    if (Number.isFinite(sec)) return new Date(sec * 1000).toISOString();
  }
  return null;
}

export function serializeLead(id: string, data: FirebaseFirestore.DocumentData): CrmLeadRecord {
  const followUpDateRaw =
    data.followUpDate ?? data.followUpAt ?? data.followUp ?? data.nextFollowUpDate;
  let followUpDate: string | null = null;
  if (typeof followUpDateRaw === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(followUpDateRaw.trim());
    followUpDate = match ? match[1] : followUpDateRaw.trim().slice(0, 10) || null;
  } else if (followUpDateRaw) {
    const iso = toIso(followUpDateRaw);
    if (iso) followUpDate = iso.slice(0, 10);
  }

  return {
    id,
    name: String(data.name || "").trim(),
    phone: data.phone != null ? String(data.phone) : null,
    email: data.email != null ? String(data.email).toLowerCase() : null,
    company: data.company != null ? String(data.company) : null,
    notes: data.notes != null ? String(data.notes) : null,
    stage: String(data.stage || data.status || "new"),
    source: data.source != null ? String(data.source) : null,
    channel: data.channel != null ? String(data.channel) : null,
    ownerUid: data.ownerUid != null ? String(data.ownerUid) : null,
    ownerCard: data.ownerCard != null ? String(data.ownerCard) : null,
    followUpDate,
    nextTaskSummary:
      data.nextTaskSummary != null ? String(data.nextTaskSummary) : null,
    draftMessage: data.draftMessage != null ? String(data.draftMessage) : null,
    draftMailbox: data.draftMailbox != null ? String(data.draftMailbox) : null,
    draftUpdatedAt: toIso(data.draftUpdatedAt),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
}

export function serializeTimelineEntry(
  id: string,
  data: FirebaseFirestore.DocumentData
): CrmTimelineRecord {
  return {
    id,
    type: (data.type as CrmTimelineRecord["type"]) || "note",
    summary: String(data.summary || "").trim(),
    body: data.body != null ? String(data.body) : null,
    fromStage: data.fromStage != null ? String(data.fromStage) : null,
    toStage: data.toStage != null ? String(data.toStage) : null,
    dueAt: toIso(data.dueAt),
    completedAt: toIso(data.completedAt),
    createdByUid: data.createdByUid != null ? String(data.createdByUid) : null,
    createdByName: data.createdByName != null ? String(data.createdByName) : null,
    createdAt: toIso(data.createdAt),
  };
}
