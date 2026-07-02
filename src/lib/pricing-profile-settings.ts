export const PRICING_PROFILE_SETTINGS_DOC_ID = "display";

export type PricingProfileSettings = {
  fbaIncludedItems?: string[];
  fbmIncludedItems?: string[];
  updatedAt?: unknown;
};

export const DEFAULT_FBA_INCLUDED_ITEMS = [
  "Receiving & inspection",
  "Labeling & standard prep",
  "Packaging & forwarding",
  "24-72 hour turnaround",
] as const;

export const DEFAULT_FBM_INCLUDED_ITEMS = [
  "Pick, pack, packaging, labeling",
  "Same-day shipping (before cutoff)",
  "24-48 hr guaranteed turnaround",
] as const;

export function getPricingProfileSettingsPath(profileId: string): string {
  return `pricingProfiles/${profileId}/profileSettings/${PRICING_PROFILE_SETTINGS_DOC_ID}`;
}

export function getPricingProfileSettingsCollectionPath(profileId: string): string {
  return `pricingProfiles/${profileId}/profileSettings`;
}

export function parseIncludedItemsText(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function includedItemsToText(items: string[] | undefined, fallback: readonly string[]): string {
  const list = items && items.length > 0 ? items : [...fallback];
  return list.join("\n");
}

export function resolveIncludedItems(
  items: string[] | undefined,
  fallback: readonly string[]
): string[] {
  if (items && items.length > 0) return items;
  return [...fallback];
}
