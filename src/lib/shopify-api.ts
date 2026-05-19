/**
 * Shopify Admin API version — keep in sync with `api_version` in shopify.app.toml.
 * Override with SHOPIFY_API_VERSION in env if needed.
 */
export const SHOPIFY_API_VERSION =
  (typeof process.env.SHOPIFY_API_VERSION === "string" && process.env.SHOPIFY_API_VERSION.trim()) ||
  "2026-04";

export function shopifyAdminRestUrl(shop: string, path: string): string {
  const shopNorm = shop.includes(".myshopify.com") ? shop : `${shop}.myshopify.com`;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `https://${shopNorm}/admin/api/${SHOPIFY_API_VERSION}${p}`;
}

export function shopifyAdminGraphqlUrl(shop: string): string {
  return shopifyAdminRestUrl(shop, "/graphql.json");
}

/** Best-effort parse of Shopify error body for UI / logs. */
export function parseShopifyErrorBody(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "Unknown Shopify error";
  try {
    const j = JSON.parse(trimmed) as { errors?: string | Record<string, string[]> };
    if (typeof j.errors === "string") return j.errors;
    if (j.errors && typeof j.errors === "object") {
      const parts = Object.entries(j.errors).flatMap(([k, v]) =>
        (Array.isArray(v) ? v : [String(v)]).map((msg) => `${k}: ${msg}`)
      );
      if (parts.length) return parts.join("; ");
    }
  } catch {
    // not JSON
  }
  const titleMatch = trimmed.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) return titleMatch[1].trim();
  return trimmed.replace(/\s+/g, " ").slice(0, 280);
}
