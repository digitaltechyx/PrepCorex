export const CRM_LEADS_COLLECTION = "crmLeads";
export const CRM_TIMELINE_SUBCOLLECTION = "timeline";

export const CRM_LEAD_STAGES = [
  "new",
  "contacted",
  "qualified",
  "quoted",
  "won",
  "lost",
  "nurture",
] as const;

export type CrmLeadStage = (typeof CRM_LEAD_STAGES)[number] | string;

export type CrmTimelineType =
  | "note"
  | "call"
  | "email"
  | "whatsapp"
  | "stage_change"
  | "task"
  | "system";

export type CrmLeadRecord = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  company?: string | null;
  notes?: string | null;
  stage: CrmLeadStage;
  source?: string | null;
  channel?: string | null;
  ownerUid?: string | null;
  ownerCard?: string | null;
  /** Calendar follow-up date (YYYY-MM-DD, America/New_York business day). */
  followUpDate?: string | null;
  nextTaskSummary?: string | null;
  draftMessage?: string | null;
  draftMailbox?: string | null;
  draftUpdatedAt?: string | null;
  tags?: string[];
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type CrmTimelineRecord = {
  id: string;
  type: CrmTimelineType;
  summary: string;
  body?: string | null;
  fromStage?: string | null;
  toStage?: string | null;
  dueAt?: string | null;
  completedAt?: string | null;
  createdByUid?: string | null;
  createdByName?: string | null;
  createdAt?: string | null;
};

export type CrmLeadSearchParams = {
  q?: string;
  stage?: string;
  followUpBefore?: string;
  followUpAfter?: string;
  limit?: number;
};

export type CrmTaskScope = "overdue" | "due" | "today";
