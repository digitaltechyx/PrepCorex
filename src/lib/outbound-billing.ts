import type { OutboundBillingSettings, UserProfile } from "@/types";

/** Default: PrepCorex Create Invoice is available. */
export function allowsPrepcorexCreateInvoice(
  user: Pick<UserProfile, "outboundBilling"> | OutboundBillingSettings | null | undefined
): boolean {
  if (!user) return true;
  const settings =
    "outboundBilling" in (user as object)
      ? (user as UserProfile).outboundBilling
      : (user as OutboundBillingSettings);
  if (!settings || typeof settings !== "object") return true;
  if (settings.prepcorexCreateInvoice === false) return false;
  return true;
}

/** Off clients: bill via CRM consolidated draft. */
export function usesCrmOutboundDraftInvoice(
  user: Pick<UserProfile, "outboundBilling"> | null | undefined
): boolean {
  return !allowsPrepcorexCreateInvoice(user);
}

export const CRM_OUTBOUND_DRAFT_BILLING_SOURCE = "prepcorex_outbound_consolidated";

export function crmOutboundDraftConsolidationKey(clientUserId: string): string {
  return `${String(clientUserId || "").trim()}_outbound_open`;
}
