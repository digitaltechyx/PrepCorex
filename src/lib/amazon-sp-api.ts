/**
 * Amazon SP-API / LWA helpers (LWA-only — no AWS SigV4).
 */

export function isAmazonSpApiSandbox(): boolean {
  return process.env.AMAZON_SP_API_SANDBOX === "true";
}

/**
 * Website OAuth `version=beta` flag.
 * Required while the SP-API app is Draft / self-authorized.
 * Only set AMAZON_OAUTH_VERSION_BETA=false after the app is live in the Selling Partner Appstore.
 * (Production LWA keys do not mean Appstore-published.)
 */
export function isAmazonOAuthVersionBeta(): boolean {
  const raw = process.env.AMAZON_OAUTH_VERSION_BETA?.trim().toLowerCase();
  if (raw === "false" || raw === "0") return false;
  if (raw === "true" || raw === "1") return true;
  // Default: beta. Sandbox always uses beta.
  return true;
}

export function getAmazonLwaClientId(): string | undefined {
  return process.env.AMAZON_LWA_CLIENT_ID?.trim() || undefined;
}

export function getAmazonLwaClientSecret(): string | undefined {
  return process.env.AMAZON_LWA_CLIENT_SECRET?.trim() || undefined;
}

export function getAmazonSpApiAppId(): string | undefined {
  return (
    process.env.AMAZON_SP_API_APP_ID?.trim() ||
    process.env.AMAZON_APPLICATION_ID?.trim() ||
    undefined
  );
}

export function getAmazonAppBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.VERCEL_URL?.trim() ||
    "";
  if (!raw) return "http://localhost:3000";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw.replace(/\/$/, "");
  return `https://${raw.replace(/\/$/, "")}`;
}

export function getAmazonRedirectUri(): string {
  const explicit = process.env.AMAZON_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  return `${getAmazonAppBaseUrl()}/dashboard/integrations/amazon/callback`;
}

export function getAmazonLoginUri(): string {
  const explicit = process.env.AMAZON_LOGIN_URI?.trim();
  if (explicit) return explicit;
  return `${getAmazonAppBaseUrl()}/dashboard/integrations/amazon/login`;
}

/** Seller Central host for consent (NA default). */
export function getAmazonSellerCentralHost(): string {
  const region = (process.env.AMAZON_SELLER_CENTRAL_REGION || "NA").toUpperCase();
  if (region === "EU") return "https://sellercentral.amazon.co.uk";
  if (region === "FE") return "https://sellercentral.amazon.co.jp";
  return "https://sellercentral.amazon.com";
}

export function getAmazonSpApiEndpoint(): string {
  const region = (process.env.AMAZON_SP_API_REGION || "NA").toUpperCase();
  const sandbox = isAmazonSpApiSandbox();
  if (region === "EU") {
    return sandbox
      ? "https://sandbox.sellingpartnerapi-eu.amazon.com"
      : "https://sellingpartnerapi-eu.amazon.com";
  }
  if (region === "FE") {
    return sandbox
      ? "https://sandbox.sellingpartnerapi-fe.amazon.com"
      : "https://sellingpartnerapi-fe.amazon.com";
  }
  return sandbox
    ? "https://sandbox.sellingpartnerapi-na.amazon.com"
    : "https://sellingpartnerapi-na.amazon.com";
}

export type AmazonOAuthStatePayload = {
  u: string;
  n: string;
  a?: 0 | 1;
  t: number;
};

export function encodeAmazonOAuthState(payload: AmazonOAuthStatePayload): string {
  const json = JSON.stringify(payload);
  return `pcx.${Buffer.from(json, "utf8").toString("base64url")}`;
}

export function decodeAmazonOAuthState(raw: string | null | undefined): AmazonOAuthStatePayload | null {
  if (!raw || !raw.startsWith("pcx.")) return null;
  try {
    const json = Buffer.from(raw.slice(4), "base64url").toString("utf8");
    const parsed = JSON.parse(json) as AmazonOAuthStatePayload;
    if (!parsed?.u || !parsed?.n || typeof parsed.t !== "number") return null;
    // 30 minutes
    if (Date.now() - parsed.t > 30 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function buildAmazonConsentUrl(input: {
  state: string;
  /** Draft / self-auth apps need version=beta; Appstore-published apps must omit it */
  versionBeta?: boolean;
}): string {
  const appId = getAmazonSpApiAppId();
  if (!appId) throw new Error("Missing AMAZON_SP_API_APP_ID");
  const host = getAmazonSellerCentralHost();
  const params = new URLSearchParams({
    application_id: appId,
    state: input.state,
  });
  const useBeta =
    typeof input.versionBeta === "boolean"
      ? input.versionBeta
      : isAmazonOAuthVersionBeta();
  if (useBeta) {
    params.set("version", "beta");
  }
  return `${host}/apps/authorize/consent?${params.toString()}`;
}

export async function exchangeAmazonAuthorizationCode(input: {
  code: string;
  redirectUri: string;
}): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type?: string;
}> {
  const clientId = getAmazonLwaClientId();
  const clientSecret = getAmazonLwaClientSecret();
  if (!clientId || !clientSecret) {
    throw new Error("Amazon LWA credentials not configured");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: body.toString(),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const detail =
      (typeof data.error_description === "string" && data.error_description) ||
      (typeof data.error === "string" && data.error) ||
      `HTTP ${res.status}`;
    throw new Error(detail);
  }
  const accessToken = String(data.access_token ?? "");
  const refreshToken = String(data.refresh_token ?? "");
  if (!accessToken || !refreshToken) {
    throw new Error("Amazon token response missing access_token or refresh_token");
  }
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: typeof data.expires_in === "number" ? data.expires_in : 3600,
    token_type: typeof data.token_type === "string" ? data.token_type : "bearer",
  };
}

export async function refreshAmazonAccessToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
}> {
  const clientId = getAmazonLwaClientId();
  const clientSecret = getAmazonLwaClientSecret();
  if (!clientId || !clientSecret) {
    throw new Error("Amazon LWA credentials not configured");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: body.toString(),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const detail =
      (typeof data.error_description === "string" && data.error_description) ||
      (typeof data.error === "string" && data.error) ||
      `HTTP ${res.status}`;
    throw new Error(detail);
  }
  const accessToken = String(data.access_token ?? "");
  if (!accessToken) throw new Error("Amazon refresh response missing access_token");
  return {
    access_token: accessToken,
    expires_in: typeof data.expires_in === "number" ? data.expires_in : 3600,
  };
}

/** Minimal SP-API GET helper (LWA access token only). */
export async function amazonSpApiGet<T = unknown>(input: {
  path: string;
  accessToken: string;
  query?: Record<string, string>;
}): Promise<{ ok: boolean; status: number; data: T | Record<string, unknown> }> {
  const base = getAmazonSpApiEndpoint();
  const url = new URL(input.path.startsWith("http") ? input.path : `${base}${input.path}`);
  if (input.query) {
    for (const [k, v] of Object.entries(input.query)) {
      if (v) url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "x-amz-access-token": input.accessToken,
      Accept: "application/json",
    },
  });
  const data = (await res.json().catch(() => ({}))) as T | Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

export type AmazonMarketplaceSummary = {
  id: string | null;
  name: string | null;
  countryCode: string | null;
  storeName: string | null;
};

export type AmazonSellerProfile = {
  storeName: string | null;
  businessName: string | null;
  marketplaces: AmazonMarketplaceSummary[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function payloadRecord(data: unknown): Record<string, unknown> {
  const root = asRecord(data);
  if (root.payload && typeof root.payload === "object" && !Array.isArray(root.payload)) {
    return root.payload as Record<string, unknown>;
  }
  return root;
}

function cleanName(value: unknown): string | null {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function parseMarketplaceRows(rows: unknown): AmazonMarketplaceSummary[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const rec = asRecord(row);
      const marketplace = asRecord(rec.marketplace);
      const id = marketplace.id != null ? String(marketplace.id).trim() : "";
      if (!id) return null;
      return {
        id,
        name: cleanName(marketplace.name),
        countryCode: cleanName(marketplace.countryCode),
        // Amazon returns the seller's storefront name on the participation, not the marketplace.
        storeName: cleanName(rec.storeName),
      };
    })
    .filter((row): row is AmazonMarketplaceSummary => Boolean(row));
}

function participationListFrom(data: unknown): unknown {
  const root = asRecord(data);
  if (Array.isArray(root.payload)) return root.payload;
  const payload = payloadRecord(data);
  if (Array.isArray(payload.marketplaceParticipationList)) {
    return payload.marketplaceParticipationList;
  }
  if (Array.isArray(payload.payload)) return payload.payload;
  return [];
}

/** Store / business name + marketplaces for the connected selling partner. */
export async function fetchAmazonSellerProfile(
  accessToken: string
): Promise<AmazonSellerProfile> {
  let marketplaces: AmazonMarketplaceSummary[] = [];
  let businessName: string | null = null;

  const account = await amazonSpApiGet({
    path: "/sellers/v1/account",
    accessToken,
  });
  if (account.ok) {
    const accountPayload = payloadRecord(account.data);
    marketplaces = parseMarketplaceRows(
      accountPayload.marketplaceParticipationList ?? participationListFrom(account.data)
    );
    const business = asRecord(accountPayload.business);
    businessName = cleanName(business.name) || cleanName(business.nonLatinName);
  }

  if (marketplaces.length === 0) {
    const participations = await amazonSpApiGet({
      path: "/sellers/v1/marketplaceParticipations",
      accessToken,
    });
    if (participations.ok) {
      marketplaces = parseMarketplaceRows(participationListFrom(participations.data));
    }
  } else {
    // Prefer store names from marketplaceParticipations when account omits them.
    const missingStore = marketplaces.every((m) => !m.storeName);
    if (missingStore) {
      const participations = await amazonSpApiGet({
        path: "/sellers/v1/marketplaceParticipations",
        accessToken,
      });
      if (participations.ok) {
        const fromParticipations = parseMarketplaceRows(participationListFrom(participations.data));
        if (fromParticipations.some((m) => m.storeName)) {
          marketplaces = fromParticipations;
        }
      }
    }
  }

  const storeFromParticipation =
    marketplaces.map((m) => m.storeName).find(Boolean) || null;
  const marketplaceLabel =
    marketplaces.map((m) => m.name || m.countryCode).find(Boolean) || null;

  return {
    storeName: storeFromParticipation || businessName || marketplaceLabel,
    businessName,
    marketplaces,
  };
}
