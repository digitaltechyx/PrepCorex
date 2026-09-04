import type { UserProfile } from "@/types";

type InboundShippingUser = Pick<UserProfile, "companyName" | "name" | "inboundShippingName"> | null | undefined;

/** Company or account name used when the client has not set a custom inbound shipping name. */
export function getDefaultInboundShippingName(user: InboundShippingUser): string {
  const company = user?.companyName?.trim();
  if (company) return company;
  return user?.name?.trim() || "";
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
