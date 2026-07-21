import { randomBytes } from "crypto";

/** US Partner Center auth host (PrepCorex registered on partner.us). */
const AUTH_AUTHORIZE_US = "https://services.us.tiktokshop.com/open/authorize";
const AUTH_AUTHORIZE_GLOBAL = "https://services.tiktokshop.com/open/authorize";

export function getTikTokAppCredentials(): {
  appKey: string;
  appSecret: string;
  serviceId: string;
} {
  const appKey = process.env.TIKTOK_APP_KEY?.trim() || process.env.NEXT_PUBLIC_TIKTOK_APP_KEY?.trim();
  const appSecret = process.env.TIKTOK_APP_SECRET?.trim();
  const serviceId = process.env.TIKTOK_APP_ID?.trim() || process.env.TIKTOK_SERVICE_ID?.trim();
  if (!appKey || !appSecret || !serviceId) {
    throw new Error("TikTok app not configured (missing TIKTOK_APP_KEY, TIKTOK_APP_SECRET, or TIKTOK_APP_ID)");
  }
  return { appKey, appSecret, serviceId };
}

export function createTikTokOAuthState(): string {
  return randomBytes(24).toString("hex");
}

/** Seller authorize URL. Defaults to US (partner.us). Set TIKTOK_AUTH_REGION=global for non-US. */
export function buildTikTokAuthorizeUrl(options: { serviceId: string; state?: string }): string {
  const region = (process.env.TIKTOK_AUTH_REGION || "us").toLowerCase();
  const base = region === "global" ? AUTH_AUTHORIZE_GLOBAL : AUTH_AUTHORIZE_US;
  const q = new URLSearchParams({ service_id: options.serviceId });
  if (options.state) q.set("state", options.state);
  return `${base}?${q.toString()}`;
}

export function getTikTokRedirectUri(baseUrl?: string): string {
  const origin =
    (baseUrl || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (!origin) {
    throw new Error("App base URL not configured. Set NEXT_PUBLIC_APP_URL.");
  }
  return `${origin}/dashboard/integrations/tiktok/callback`;
}
