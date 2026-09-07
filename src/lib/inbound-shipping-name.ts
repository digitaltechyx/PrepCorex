import type { UserProfile } from "@/types";

type InboundShippingUser = Pick<UserProfile, "inboundShippingName"> | null | undefined;

/** Default name on inbound shipment labels for all clients unless they set a custom override. */
export const DEFAULT_INBOUND_SHIPPING_NAME = "Prep Services FBA";

/** Default shipping name when the client has not set a custom inbound shipping name. */
export function getDefaultInboundShippingName(_user?: InboundShippingUser): string {
  return DEFAULT_INBOUND_SHIPPING_NAME;
}

/** Name clients should put on inbound shipments (custom override or default). */
export function getInboundShippingName(user: InboundShippingUser): string {
  const custom = user?.inboundShippingName?.trim();
  if (custom) return custom;
  const fallback = getDefaultInboundShippingName(user);
  return fallback || "-";
}

export function hasCustomInboundShippingName(user: InboundShippingUser): boolean {
  return Boolean(user?.inboundShippingName?.trim());
}
