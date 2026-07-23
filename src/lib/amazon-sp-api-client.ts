/** Client-safe Amazon URL helpers (no Node Buffer / secrets). */

export function getAmazonAppBaseUrlClient(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim() || "";
  if (raw) {
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw.replace(/\/$/, "");
    return `https://${raw.replace(/\/$/, "")}`;
  }
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:3000";
}

export function getAmazonRedirectUriClient(): string {
  const explicit = process.env.NEXT_PUBLIC_AMAZON_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  return `${getAmazonAppBaseUrlClient()}/dashboard/integrations/amazon/callback`;
}
