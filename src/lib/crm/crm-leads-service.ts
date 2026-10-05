import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { adminDb, adminFieldValue } from "@/lib/firebase-admin";
import type { CrmAutomationActor } from "@/lib/crm/crm-automation-auth";
import {
  leadMatchesFollowUpScope,
  normalizeFollowUpDateInput,
  sortLeadsByFollowUpDate,
} from "@/lib/crm/crm-follow-up";
import { serializeLead, serializeTimelineEntry } from "@/lib/crm/crm-serialize";
import type {
  CrmLeadRecord,
  CrmLeadSearchParams,
  CrmTaskScope,
  CrmTimelineRecord,
  CrmTimelineType,
} from "@/lib/crm/types";
import { CRM_LEADS_COLLECTION, CRM_TIMELINE_SUBCOLLECTION } from "@/lib/crm/types";
import { compareDateInputs } from "@/lib/nj-date";

const MAX_LIST = 500;

function cleanText(value: unknown, max: number): string {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

function leadRef(id: string) {
  return adminDb().collection(CRM_LEADS_COLLECTION).doc(id);
}

function timelineRef(leadId: string) {
  return leadRef(leadId).collection(CRM_TIMELINE_SUBCOLLECTION);
}

async function appendTimeline(
  leadId: string,
  entry: {
    type: CrmTimelineType;
    summary: string;
    body?: string | null;
    fromStage?: string | null;
    toStage?: string | null;
    dueAt?: string | null;
    completedAt?: string | null;
    createdByUid?: string | null;
    createdByName?: string | null;
  }
) {
  await timelineRef(leadId).add({
    type: entry.type,
    summary: entry.summary,
    body: entry.body ?? null,
    fromStage: entry.fromStage ?? null,
    toStage: entry.toStage ?? null,
    dueAt: entry.dueAt ?? null,
    completedAt: entry.completedAt ?? null,
    createdByUid: entry.createdByUid ?? null,
    createdByName: entry.createdByName ?? null,
    createdAt: adminFieldValue().serverTimestamp(),
  });
}

async function fetchLeadDocs() {
  const col = adminDb().collection(CRM_LEADS_COLLECTION);
  try {
    return await col.orderBy("updatedAt", "desc").limit(MAX_LIST).get();
  } catch {
    return await col.limit(MAX_LIST).get();
  }
}

export async function listCrmLeads(params: CrmLeadSearchParams = {}): Promise<CrmLeadRecord[]> {
  const snap = await fetchLeadDocs();

  let leads: CrmLeadRecord[] = snap.docs.map((doc: QueryDocumentSnapshot) =>
    serializeLead(doc.id, doc.data())
  );

  const q = cleanText(params.q, 120).toLowerCase();
  if (q) {
    leads = leads.filter((lead: CrmLeadRecord) => {
      const hay = [
        lead.name,
        lead.email,
        lead.phone,
        lead.company,
        lead.notes,
        lead.id,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  const stage = cleanText(params.stage, 40).toLowerCase();
  if (stage) {
    leads = leads.filter(
      (lead: CrmLeadRecord) => String(lead.stage || "").toLowerCase() === stage
    );
  }

  if (params.followUpBefore) {
    const before = normalizeFollowUpDateInput(params.followUpBefore);
    if (before) {
      leads = leads.filter(
        (lead: CrmLeadRecord) =>
          lead.followUpDate && compareDateInputs(lead.followUpDate, before) <= 0
      );
    }
  }

  if (params.followUpAfter) {
    const after = normalizeFollowUpDateInput(params.followUpAfter);
    if (after) {
      leads = leads.filter(
        (lead: CrmLeadRecord) =>
          lead.followUpDate && compareDateInputs(lead.followUpDate, after) >= 0
      );
    }
  }

  const limit = Math.min(Math.max(params.limit ?? 100, 1), 200);
  return leads.slice(0, limit);
}

export async function getCrmLead(id: string): Promise<CrmLeadRecord | null> {
  const snap = await leadRef(id).get();
  if (!snap.exists) return null;
  return serializeLead(snap.id, snap.data() || {});
}

export async function createCrmLead(
  input: Partial<CrmLeadRecord>,
  actor: CrmAutomationActor
): Promise<CrmLeadRecord> {
  const name = cleanText(input.name, 120);
  if (!name) throw new Error("name is required.");

  const phone = cleanText(input.phone, 40) || null;
  const email = cleanText(input.email, 120).toLowerCase() || null;
  if (!phone && !email) throw new Error("phone or email is required.");

  const followUpDate = normalizeFollowUpDateInput(input.followUpDate);

  const ref = await adminDb()
    .collection(CRM_LEADS_COLLECTION)
    .add({
      name,
      phone,
      email,
      company: cleanText(input.company, 120) || null,
      notes: cleanText(input.notes, 2000) || null,
      stage: cleanText(input.stage || "new", 40) || "new",
      source: cleanText(input.source || "api", 40) || "api",
      channel: cleanText(input.channel, 40) || null,
      ownerUid: cleanText(input.ownerUid, 80) || null,
      ownerCard: cleanText(input.ownerCard, 80) || null,
      followUpDate,
      nextTaskSummary: cleanText(input.nextTaskSummary, 500) || null,
      tags: Array.isArray(input.tags) ? input.tags.map((t) => cleanText(t, 40)).filter(Boolean) : [],
      createdAt: adminFieldValue().serverTimestamp(),
      updatedAt: adminFieldValue().serverTimestamp(),
    });

  await appendTimeline(ref.id, {
    type: "system",
    summary: "Lead created",
    body: `Created via ${actor.via}.`,
    createdByUid: actor.uid,
    createdByName: actor.name,
  });

  const created = await getCrmLead(ref.id);
  if (!created) throw new Error("Lead created but could not be loaded.");
  return created;
}

const PATCHABLE: (keyof CrmLeadRecord)[] = [
  "name",
  "phone",
  "email",
  "company",
  "notes",
  "stage",
  "source",
  "channel",
  "ownerUid",
  "ownerCard",
  "followUpDate",
  "nextTaskSummary",
  "tags",
];

export async function updateCrmLead(
  id: string,
  patch: Partial<CrmLeadRecord>,
  actor: CrmAutomationActor
): Promise<CrmLeadRecord> {
  const existingSnap = await leadRef(id).get();
  if (!existingSnap.exists) throw new Error("Lead not found.");
  const existing = serializeLead(existingSnap.id, existingSnap.data() || {});

  const updates: Record<string, unknown> = {
    updatedAt: adminFieldValue().serverTimestamp(),
  };

  for (const key of PATCHABLE) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (key === "name") updates.name = cleanText(value, 120);
    else if (key === "phone") updates.phone = cleanText(value, 40) || null;
    else if (key === "email")
      updates.email = cleanText(value, 120).toLowerCase() || null;
    else if (key === "company") updates.company = cleanText(value, 120) || null;
    else if (key === "notes") updates.notes = cleanText(value, 2000) || null;
    else if (key === "stage") updates.stage = cleanText(value, 40) || "new";
    else if (key === "source") updates.source = cleanText(value, 40) || null;
    else if (key === "channel") updates.channel = cleanText(value, 40) || null;
    else if (key === "ownerUid") updates.ownerUid = cleanText(value, 80) || null;
    else if (key === "ownerCard") updates.ownerCard = cleanText(value, 80) || null;
    else if (key === "followUpDate")
      updates.followUpDate = normalizeFollowUpDateInput(value);
    else if (key === "nextTaskSummary")
      updates.nextTaskSummary = cleanText(value, 500) || null;
    else if (key === "tags" && Array.isArray(value)) {
      updates.tags = value.map((t) => cleanText(t, 40)).filter(Boolean);
    }
  }

  await leadRef(id).update(updates);

  const nextStage = updates.stage != null ? String(updates.stage) : null;
  if (nextStage && nextStage !== existing.stage) {
    await appendTimeline(id, {
      type: "stage_change",
      summary: `Stage: ${existing.stage} → ${nextStage}`,
      fromStage: existing.stage,
      toStage: nextStage,
      createdByUid: actor.uid,
      createdByName: actor.name,
    });
  }

  if ("followUpDate" in patch) {
    const nextDate = updates.followUpDate as string | null;
    if (nextDate !== existing.followUpDate) {
      await appendTimeline(id, {
        type: "task",
        summary: nextDate ? `Follow-up set to ${nextDate}` : "Follow-up cleared",
        body: patch.nextTaskSummary != null ? cleanText(patch.nextTaskSummary, 500) : null,
        createdByUid: actor.uid,
        createdByName: actor.name,
      });
    }
  }

  if ("notes" in patch && patch.notes && patch.notes !== existing.notes) {
    await appendTimeline(id, {
      type: "note",
      summary: "Notes updated",
      body: cleanText(patch.notes, 2000),
      createdByUid: actor.uid,
      createdByName: actor.name,
    });
  }

  const updated = await getCrmLead(id);
  if (!updated) throw new Error("Lead not found after update.");
  return updated;
}

export async function listCrmLeadActivities(
  leadId: string,
  limit = 50
): Promise<CrmTimelineRecord[]> {
  const snap = await timelineRef(leadId)
    .orderBy("createdAt", "desc")
    .limit(Math.min(Math.max(limit, 1), 200))
    .get();
  return snap.docs.map((doc: QueryDocumentSnapshot) =>
    serializeTimelineEntry(doc.id, doc.data() || {})
  );
}

export async function addCrmLeadActivity(
  leadId: string,
  input: {
    type?: CrmTimelineType;
    summary: string;
    body?: string | null;
    dueAt?: string | null;
    completedAt?: string | null;
  },
  actor: CrmAutomationActor
): Promise<CrmTimelineRecord> {
  const lead = await getCrmLead(leadId);
  if (!lead) throw new Error("Lead not found.");

  const summary = cleanText(input.summary, 500);
  if (!summary) throw new Error("summary is required.");

  const type = (cleanText(input.type || "note", 40) as CrmTimelineType) || "note";

  const ref = await timelineRef(leadId).add({
    type,
    summary,
    body: cleanText(input.body, 4000) || null,
    fromStage: null,
    toStage: null,
    dueAt: input.dueAt ?? null,
    completedAt: input.completedAt ?? null,
    createdByUid: actor.uid,
    createdByName: actor.name,
    createdAt: adminFieldValue().serverTimestamp(),
  });

  await leadRef(leadId).update({ updatedAt: adminFieldValue().serverTimestamp() });

  const snap = await ref.get();
  return serializeTimelineEntry(snap.id, snap.data() || {});
}

export async function getCrmLeadDraft(leadId: string) {
  const lead = await getCrmLead(leadId);
  if (!lead) return null;
  return {
    leadId,
    draftMessage: lead.draftMessage ?? "",
    draftMailbox: lead.draftMailbox ?? null,
    draftUpdatedAt: lead.draftUpdatedAt ?? null,
  };
}

export async function setCrmLeadDraft(
  leadId: string,
  input: { draftMessage?: string; draftMailbox?: string | null },
  actor: CrmAutomationActor
) {
  const lead = await getCrmLead(leadId);
  if (!lead) throw new Error("Lead not found.");

  const draftMessage =
    input.draftMessage != null ? String(input.draftMessage).slice(0, 20000) : lead.draftMessage ?? "";
  const draftMailbox =
    input.draftMailbox !== undefined
      ? cleanText(input.draftMailbox, 80) || null
      : lead.draftMailbox ?? null;

  await leadRef(leadId).update({
    draftMessage,
    draftMailbox,
    draftUpdatedAt: adminFieldValue().serverTimestamp(),
    updatedAt: adminFieldValue().serverTimestamp(),
  });

  await appendTimeline(leadId, {
    type: "system",
    summary: "Draft saved",
    body: draftMailbox ? `Mailbox: ${draftMailbox}` : null,
    createdByUid: actor.uid,
    createdByName: actor.name,
  });

  return getCrmLeadDraft(leadId);
}

export async function listCrmTasksByScope(scope: CrmTaskScope): Promise<CrmLeadRecord[]> {
  const snap = await fetchLeadDocs();

  const leads = snap.docs
    .map((doc: QueryDocumentSnapshot) => serializeLead(doc.id, doc.data() || {}))
    .filter((lead: CrmLeadRecord) => leadMatchesFollowUpScope(lead, scope));

  return sortLeadsByFollowUpDate(leads, "asc");
}
