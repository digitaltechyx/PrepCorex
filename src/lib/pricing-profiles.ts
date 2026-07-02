import type { UserProfile } from "@/types";

/** Built-in global pricing profile slugs. */
export type GlobalPricingProfileSlug =
  | "standard"
  | "wholesale"
  | "brand"
  | "enterprise"
  | "vip"
  | "agency";

export type PricingProfileKind = "global" | "custom";

export const DEFAULT_PRICING_PROFILE_ID: GlobalPricingProfileSlug = "standard";

export const GLOBAL_PRICING_PROFILES: ReadonlyArray<{
  id: GlobalPricingProfileSlug;
  label: string;
}> = [
  { id: "standard", label: "Standard" },
  { id: "wholesale", label: "Wholesale" },
  { id: "brand", label: "Brand" },
  { id: "enterprise", label: "Enterprise" },
  { id: "vip", label: "VIP" },
  { id: "agency", label: "Agency" },
] as const;

export const CUSTOM_PRICING_PROFILE_OPTION = {
  id: "custom" as const,
  label: "Custom",
};

export type PricingDataCategory =
  | "prep"
  | "storage"
  | "boxForwarding"
  | "palletForwarding"
  | "containerHandling"
  | "additionalServices"
  | "fbaPackAddOn";

const CATEGORY_COLLECTION: Record<PricingDataCategory, string> = {
  prep: "pricing",
  storage: "storagePricing",
  boxForwarding: "boxForwardingPricing",
  palletForwarding: "palletForwardingPricing",
  containerHandling: "containerHandlingPricing",
  additionalServices: "additionalServicesPricing",
  fbaPackAddOn: "fbaPackAddOnPricing",
};

/** Legacy top-level default collections (migrated into `pricingProfiles/standard`). */
export const LEGACY_DEFAULT_COLLECTIONS: Record<PricingDataCategory, string> = {
  prep: "defaultPricing",
  storage: "defaultStoragePricing",
  boxForwarding: "defaultBoxForwardingPricing",
  palletForwarding: "defaultPalletForwardingPricing",
  containerHandling: "defaultContainerHandlingPricing",
  additionalServices: "defaultAdditionalServicesPricing",
  fbaPackAddOn: "defaultFbaPackAddOnPricing",
};

export function customProfileIdForUser(userId: string): string {
  return `custom_${userId}`;
}

export function isCustomProfileId(profileId: string): boolean {
  return profileId.startsWith("custom_");
}

export function userIdFromCustomProfileId(profileId: string): string | null {
  if (!isCustomProfileId(profileId)) return null;
  const uid = profileId.slice("custom_".length);
  return uid || null;
}

/** Resolve the Firestore profile id used for pricing tables. */
export function resolveUserPricingProfileId(
  user: Pick<UserProfile, "pricingProfileId" | "uid"> | null | undefined
): string {
  if (!user) return DEFAULT_PRICING_PROFILE_ID;
  if (user.pricingProfileId?.trim()) return user.pricingProfileId.trim();
  return DEFAULT_PRICING_PROFILE_ID;
}

/** UI select value for admin forms (`custom` vs global slug). */
export function pricingProfileSelectValue(
  user: Pick<UserProfile, "pricingProfileId" | "uid"> | null | undefined
): string {
  const profileId = resolveUserPricingProfileId(user);
  if (isCustomProfileId(profileId)) return CUSTOM_PRICING_PROFILE_OPTION.id;
  if (GLOBAL_PRICING_PROFILES.some((p) => p.id === profileId)) return profileId;
  return DEFAULT_PRICING_PROFILE_ID;
}

/** Map admin select value to stored `pricingProfileId`. */
export function pricingProfileIdFromSelect(
  selectValue: string,
  userId: string
): string {
  if (selectValue === CUSTOM_PRICING_PROFILE_OPTION.id) {
    return customProfileIdForUser(userId);
  }
  const global = GLOBAL_PRICING_PROFILES.find((p) => p.id === selectValue);
  return global?.id ?? DEFAULT_PRICING_PROFILE_ID;
}

export function getPricingProfileLabel(profileId: string): string {
  if (isCustomProfileId(profileId)) return "Custom";
  const global = GLOBAL_PRICING_PROFILES.find((p) => p.id === profileId);
  return global?.label ?? "Standard";
}

export function getPricingProfileCollectionPath(
  profileId: string,
  category: PricingDataCategory
): string {
  const collection = CATEGORY_COLLECTION[category];
  return `pricingProfiles/${profileId}/${collection}`;
}

export function getPricingProfilePaths(profileId: string) {
  return {
    prep: getPricingProfileCollectionPath(profileId, "prep"),
    storage: getPricingProfileCollectionPath(profileId, "storage"),
    boxForwarding: getPricingProfileCollectionPath(profileId, "boxForwarding"),
    palletForwarding: getPricingProfileCollectionPath(profileId, "palletForwarding"),
    containerHandling: getPricingProfileCollectionPath(profileId, "containerHandling"),
    additionalServices: getPricingProfileCollectionPath(profileId, "additionalServices"),
    fbaPackAddOn: getPricingProfileCollectionPath(profileId, "fbaPackAddOn"),
  };
}

export function getUserPricingProfilePaths(
  user: Pick<UserProfile, "pricingProfileId" | "uid"> | null | undefined
) {
  const profileId = resolveUserPricingProfileId(user);
  return getPricingProfilePaths(profileId);
}
