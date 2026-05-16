import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { SHOPIFY_SCOPES } from "@/lib/shopify-scopes";

export { SHOPIFY_SCOPES };

const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

export function normalizeShopDomain(shop: string): string | null {
  const trimmed = shop.trim().toLowerCase();
  if (!trimmed) return null;
  const withDomain = trimmed.includes(".myshopify.com")
    ? trimmed
    : `${trimmed.replace(/[^a-z0-9-]/g, "")}.myshopify.com`;
  if (!SHOP_DOMAIN_RE.test(withDomain)) return null;
  return withDomain;
}

/** Verify HMAC on Shopify OAuth/install query params (excludes hmac and signature). */
export function verifyShopifyQueryHmac(
  params: URLSearchParams,
  secret: string
): boolean {
  const hmac = params.get("hmac");
  if (!hmac) return false;

  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === "hmac" || key === "signature") continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const message = pairs.join("&");
  const computed = createHmac("sha256", secret).update(message).digest("hex");
  try {
    const a = Buffer.from(computed, "utf8");
    const b = Buffer.from(hmac, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function createOAuthState(): string {
  return randomBytes(16).toString("hex");
}

export function buildOAuthAuthorizeUrl(options: {
  shop: string;
  clientId: string;
  redirectUri: string;
  state: string;
  scopes?: string;
}): string {
  const { shop, clientId, redirectUri, state, scopes = SHOPIFY_SCOPES } = options;
  const q = new URLSearchParams({
    client_id: clientId,
    scope: scopes,
    redirect_uri: redirectUri,
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${q.toString()}`;
}
