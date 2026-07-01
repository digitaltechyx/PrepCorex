import type { NextRequest } from "next/server";

export type AuditRequestMeta = {
  ipAddress?: string | null;
  region?: string | null;
  userAgent?: string | null;
};

function headerValue(headers: Headers, name: string): string | undefined {
  const v = headers.get(name);
  return v?.trim() || undefined;
}

/** Extract IP, region, and user agent from proxy / edge headers. */
export function getAuditRequestMeta(request?: NextRequest | Headers | null): AuditRequestMeta {
  if (!request) return {};
  const headers = request instanceof Headers ? request : request.headers;

  const forwarded = headerValue(headers, "x-forwarded-for");
  const ipAddress =
    forwarded?.split(",")[0]?.trim() ||
    headerValue(headers, "x-real-ip") ||
    headerValue(headers, "cf-connecting-ip") ||
    headerValue(headers, "x-vercel-forwarded-for") ||
    null;

  const country =
    headerValue(headers, "x-vercel-ip-country") ||
    headerValue(headers, "cf-ipcountry") ||
    headerValue(headers, "x-country-code") ||
    undefined;
  const city =
    headerValue(headers, "x-vercel-ip-city") ||
    headerValue(headers, "cf-ipcity") ||
    undefined;
  const regionCode =
    headerValue(headers, "x-vercel-ip-country-region") ||
    headerValue(headers, "cf-region") ||
    undefined;

  const regionParts = [city, regionCode, country].filter(Boolean);
  const region = regionParts.length > 0 ? regionParts.join(", ") : country || null;

  return {
    ipAddress,
    region,
    userAgent: headerValue(headers, "user-agent") || null,
  };
}
