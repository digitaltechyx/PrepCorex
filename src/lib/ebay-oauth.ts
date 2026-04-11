/**
 * eBay OAuth uses a RuName (redirect_uri) registered in the developer portal for a specific
 * Auth Accepted URL. One RuName ≈ one callback URL, so multiple production domains need
 * either separate env deployments or EBAY_RUNAME_BY_HOST (JSON map).
 *
 * Example Vercel secret:
 * EBAY_RUNAME_BY_HOST={"prepcorex.com":"PrepCor-prepcor-PRD-...","ims.prepservicesfba.com":"Prep-ims-PRD-..."}
 */
export function getRequestHost(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-host");
  if (forwarded) {
    return forwarded.split(",")[0].trim().split(":")[0].toLowerCase();
  }
  try {
    return new URL(request.url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function resolveEbayRuName(host: string): string | undefined {
  const mapRaw = process.env.EBAY_RUNAME_BY_HOST?.trim();
  if (mapRaw) {
    try {
      const map = JSON.parse(mapRaw) as Record<string, string>;
      const pick = (h: string) => {
        const v = map[h];
        return typeof v === "string" && v.length > 0 ? v : undefined;
      };
      let ru = pick(host);
      if (!ru && host.startsWith("www.")) ru = pick(host.slice(4));
      if (!ru && !host.startsWith("www.")) ru = pick(`www.${host}`);
      if (ru) return ru;
    } catch {
      // invalid JSON — fall back to EBAY_RUNAME
    }
  }
  const fallback = process.env.EBAY_RUNAME?.trim();
  return fallback || undefined;
}
