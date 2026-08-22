/** Marketplace / integration inventory sources shown only in Other Resources. */

export const INTEGRATION_INVENTORY_SOURCES = [
  "shopify",
  "ebay",
  "woocommerce",
  "tiktok",
] as const;

export type IntegrationInventorySource = (typeof INTEGRATION_INVENTORY_SOURCES)[number];

export function isIntegrationInventorySource(
  source: string | null | undefined
): source is IntegrationInventorySource {
  return (
    source === "shopify" ||
    source === "ebay" ||
    source === "woocommerce" ||
    source === "tiktok"
  );
}

export function integrationInventorySourceLabel(source: string | null | undefined): string {
  switch (String(source || "").toLowerCase()) {
    case "shopify":
      return "Shopify";
    case "ebay":
      return "eBay";
    case "woocommerce":
      return "WooCommerce";
    case "tiktok":
      return "TikTok Shop";
    default:
      return "Other";
  }
}

export function integrationInventorySourceBadgeClass(source: string | null | undefined): string {
  switch (String(source || "").toLowerCase()) {
    case "shopify":
      return "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-100";
    case "ebay":
      return "border-blue-300 bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-100";
    case "woocommerce":
      return "border-violet-300 bg-violet-50 text-violet-800 dark:bg-violet-950 dark:text-violet-100";
    case "tiktok":
      return "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-100";
    default:
      return "border-neutral-300 bg-neutral-50 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-200";
  }
}
