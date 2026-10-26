import { createHash, randomBytes } from "crypto";
import { etsyScopeParam } from "@/lib/etsy-scopes";

const AUTH_AUTHORIZE = "https://www.etsy.com/oauth/connect";
const TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";

export function getEtsyAppCredentials(): {
  keystring: string;
  sharedSecret: string;
} {
  const keystring =
    process.env.ETSY_API_KEYSTRING?.trim() ||
    process.env.ETSY_CLIENT_ID?.trim() ||
    process.env.NEXT_PUBLIC_ETSY_API_KEYSTRING?.trim() ||
    "";
  const sharedSecret =
    process.env.ETSY_SHARED_SECRET?.trim() ||
    process.env.ETSY_CLIENT_SECRET?.trim() ||
    "";
  if (!keystring || !sharedSecret) {
    throw new Error(
      "Etsy app not configured (missing ETSY_API_KEYSTRING / ETSY_SHARED_SECRET)"
    );
  }
  return { keystring, sharedSecret };
}

/** `x-api-key` value: keystring:shared_secret */
export function etsyApiKeyHeader(): string {
  const { keystring, sharedSecret } = getEtsyAppCredentials();
  return `${keystring}:${sharedSecret}`;
}

export function createEtsyOAuthState(): string {
  return randomBytes(24).toString("hex");
}

export function createEtsyPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function getEtsyRedirectUri(baseUrl?: string): string {
  const origin =
    (baseUrl || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (!origin) {
    throw new Error("App base URL not configured. Set NEXT_PUBLIC_APP_URL.");
  }
  // Must match Etsy Developer Portal callback exactly.
  const explicit = process.env.ETSY_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  return `${origin}/api/integrations/etsy/callback`;
}

export function buildEtsyAuthorizeUrl(options: {
  keystring: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: readonly string[];
}): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: options.keystring,
    redirect_uri: options.redirectUri,
    scope: etsyScopeParam(options.scopes),
    state: options.state,
    code_challenge: options.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_AUTHORIZE}?${q.toString()}`;
}

export { TOKEN_URL as ETSY_TOKEN_URL };
