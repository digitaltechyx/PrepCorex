import { createHmac } from "crypto";
import { getTikTokAppCredentials } from "@/lib/tiktok-oauth";

export const TIKTOK_API_BASE =
  process.env.TIKTOK_API_BASE?.replace(/\/$/, "") || "https://open-api.tiktokglobalshop.com";

export const TIKTOK_AUTH_BASE =
  process.env.TIKTOK_AUTH_BASE?.replace(/\/$/, "") || "https://auth.tiktok-shops.com";

/**
 * Sign a TikTok Shop Open API request.
 * input = secret + path + sorted(key+value for query except sign/access_token) + body? + secret
 * sign = HMAC-SHA256(input, secret) as hex
 */
export function signTikTokRequest(options: {
  path: string;
  query: Record<string, string | number | undefined | null>;
  body?: string;
  appSecret: string;
}): string {
  const { path, query, body, appSecret } = options;
  const keys = Object.keys(query)
    .filter((k) => k !== "sign" && k !== "access_token" && query[k] != null && query[k] !== "")
    .sort();
  let paramStr = "";
  for (const key of keys) {
    paramStr += `${key}${query[key]}`;
  }
  let input = `${appSecret}${path}${paramStr}`;
  if (body) input += body;
  input += appSecret;
  return createHmac("sha256", appSecret).update(input).digest("hex");
}

export type TikTokApiResponse<T = unknown> = {
  code: number;
  message?: string;
  request_id?: string;
  data?: T;
};

export async function tikTokApiRequest<T = unknown>(options: {
  method?: "GET" | "POST" | "PUT";
  path: string;
  accessToken: string;
  shopCipher?: string | null;
  query?: Record<string, string | number | undefined | null>;
  body?: Record<string, unknown> | null;
}): Promise<TikTokApiResponse<T>> {
  const { appKey, appSecret } = getTikTokAppCredentials();
  const method = options.method ?? "GET";
  const timestamp = Math.floor(Date.now() / 1000);
  const query: Record<string, string | number> = {
    app_key: appKey,
    timestamp,
    ...(options.query ?? {}),
  };
  if (options.shopCipher) {
    query.shop_cipher = options.shopCipher;
  }

  const bodyStr =
    method !== "GET" && options.body != null ? JSON.stringify(options.body) : undefined;

  const sign = signTikTokRequest({
    path: options.path,
    query,
    body: bodyStr,
    appSecret,
  });
  query.sign = sign;

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    qs.set(k, String(v));
  }

  const url = `${TIKTOK_API_BASE}${options.path}?${qs.toString()}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-tts-access-token": options.accessToken,
    },
    ...(bodyStr ? { body: bodyStr } : {}),
  });

  const text = await res.text();
  let parsed: TikTokApiResponse<T>;
  try {
    parsed = JSON.parse(text) as TikTokApiResponse<T>;
  } catch {
    throw new Error(`TikTok API invalid JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  return parsed;
}

export function parseTikTokError(res: TikTokApiResponse): string {
  if (res.message) return res.message;
  return `TikTok API error code ${res.code}`;
}
