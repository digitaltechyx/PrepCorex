import type { AffiliateAuditEventType } from "@/types";

export const AFFILIATE_AUDIT_EVENT_LABELS: Record<AffiliateAuditEventType, string> = {
  commission_created: "Commission Created",
  commission_paid: "Commission Paid",
  agent_approved: "Agent Approved",
  agent_rejected: "Agent Rejected",
  agent_deleted: "Agent Deleted",
  agent_restored: "Agent Restored",
  client_referred: "Client Referred",
  tier_snapshot: "Tier Snapshot",
};

export function getAffiliateAuditEventLabel(type: AffiliateAuditEventType): string {
  return AFFILIATE_AUDIT_EVENT_LABELS[type] || type;
}

export function getAffiliateAuditEventBadgeVariant(
  type: AffiliateAuditEventType
): "default" | "secondary" | "destructive" | "outline" {
  switch (type) {
    case "commission_paid":
    case "agent_approved":
    case "agent_restored":
      return "default";
    case "commission_created":
    case "client_referred":
    case "tier_snapshot":
      return "secondary";
    case "agent_rejected":
    case "agent_deleted":
      return "destructive";
    default:
      return "outline";
  }
}
