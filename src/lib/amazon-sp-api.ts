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
  return amazonSpApiRequest<T>({ method: "GET", ...input });
}

/** Minimal SP-API POST helper (LWA access token only). */
export async function amazonSpApiPost<T = unknown>(input: {
  path: string;
  accessToken: string;
  query?: Record<string, string>;
  body?: unknown;
}): Promise<{ ok: boolean; status: number; data: T | Record<string, unknown> }> {
  return amazonSpApiRequest<T>({ method: "POST", ...input });
}

/** Minimal SP-API request helper (LWA access token only). */
export async function amazonSpApiRequest<T = unknown>(input: {
  method: "GET" | "POST" | "PUT" | "PATCH";
  path: string;
  accessToken: string;
  query?: Record<string, string>;
  body?: unknown;
}): Promise<{ ok: boolean; status: number; data: T | Record<string, unknown> }> {
  const base = getAmazonSpApiEndpoint();
  const url = new URL(input.path.startsWith("http") ? input.path : `${base}${input.path}`);
  if (input.query) {
    for (const [k, v] of Object.entries(input.query)) {
      if (v) url.searchParams.set(k, v);
    }
  }
  const headers: Record<string, string> = {
    "x-amz-access-token": input.accessToken,
    Accept: "application/json",
  };
  const init: RequestInit = { method: input.method, headers };
  if (input.body != null && input.method !== "GET") {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(input.body);
  }
  const res = await fetch(url.toString(), init);
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

function strValue(value: unknown): string {
  return String(value ?? "").trim();
}

function parseMarketplaceRows(rows: unknown): AmazonMarketplaceSummary[] {
  if (!Array.isArray(rows)) return [];
  const out: AmazonMarketplaceSummary[] = [];
  for (const row of rows) {
    const rec = asRecord(row);
    const marketplace = asRecord(rec.marketplace);
    const id =
      strValue(marketplace.id) ||
      strValue(marketplace.marketplaceId) ||
      strValue(rec.marketplaceId) ||
      strValue(rec.marketplace_id) ||
      (typeof rec.marketplace === "string" ? strValue(rec.marketplace) : "");
    if (!id) continue;
    out.push({
      id,
      name: cleanName(marketplace.name) || cleanName(rec.marketplaceName),
      countryCode: cleanName(marketplace.countryCode) || cleanName(rec.countryCode),
      storeName: cleanName(rec.storeName) || cleanName(rec.storeFrontName),
    });
  }
  return out;
}

function participationListFrom(data: unknown): unknown {
  const root = asRecord(data);
  if (Array.isArray(root.payload)) return root.payload;
  if (Array.isArray(root.marketplaceParticipationList)) return root.marketplaceParticipationList;
  const payload = payloadRecord(data);
  if (Array.isArray(payload.marketplaceParticipationList)) {
    return payload.marketplaceParticipationList;
  }
  if (Array.isArray(payload.payload)) return payload.payload;
  if (Array.isArray(payload.participations)) return payload.participations;
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

/** Re-fetch marketplaces from SP-API and persist on the connection doc when missing/stale. */
export async function refreshAmazonConnectionMarketplaces(input: {
  uid: string;
  connectionId: string;
  accessToken: string;
}): Promise<AmazonMarketplaceSummary[]> {
  const profile = await fetchAmazonSellerProfile(input.accessToken);
  let marketplaces = profile.marketplaces;

  if (marketplaces.length === 0) {
    const participations = await amazonSpApiGet({
      path: "/sellers/v1/marketplaceParticipations",
      accessToken: input.accessToken,
    });
    if (participations.ok) {
      marketplaces = parseMarketplaceRows(participationListFrom(participations.data));
    } else {
      console.warn(
        "[refreshAmazonConnectionMarketplaces] marketplaceParticipations failed",
        participations.status,
        participations.data
      );
    }
  }

  if (marketplaces.length > 0) {
    const { adminDb } = await import("@/lib/firebase-admin");
    await adminDb()
      .collection("users")
      .doc(input.uid)
      .collection("amazonConnections")
      .doc(input.connectionId)
      .update({
        marketplaces,
        ...(profile.storeName ? { storeName: profile.storeName } : {}),
        ...(profile.businessName ? { businessName: profile.businessName } : {}),
        lastVerifiedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
      });
  }

  return marketplaces;
}

/** Parse marketplace participations payload from Sellers API responses. */
export function parseAmazonMarketplaceParticipations(data: unknown): AmazonMarketplaceSummary[] {
  return parseMarketplaceRows(participationListFrom(data));
}

const AMAZON_TOKEN_REFRESH_BUFFER_SEC = 300;

export type AmazonConnectionTokens = {
  connectionId: string;
  accessToken: string;
  refreshToken: string;
  sellingPartnerId: string | null;
  marketplaces: AmazonMarketplaceSummary[];
  environment: string;
};

/** Load connection and refresh LWA access token when near expiry. */
export async function getValidAmazonToken(
  uid: string,
  connectionId?: string
): Promise<AmazonConnectionTokens | null> {
  const { adminDb } = await import("@/lib/firebase-admin");
  const col = adminDb().collection("users").doc(uid).collection("amazonConnections");
  let doc:
    | {
        data(): Record<string, unknown> | undefined;
        ref: { update(x: Record<string, unknown>): Promise<void> };
        id: string;
      }
    | null = null;
  if (connectionId) {
    const snap = await col.doc(connectionId).get();
    if (snap.exists) doc = snap as typeof doc;
  } else {
    const snapshot = await col.limit(1).get();
    if (!snapshot.empty) doc = snapshot.docs[0];
  }
  if (!doc) return null;

  const data = doc.data() ?? {};
  const connId = doc.id;
  let accessToken = String(data.accessToken ?? "").trim();
  const refreshToken = String(data.refreshToken ?? "").trim();
  const expiresAt = data.expiresAt as { seconds: number } | undefined;
  const sellingPartnerId =
    typeof data.sellingPartnerId === "string" && data.sellingPartnerId.trim()
      ? data.sellingPartnerId.trim()
      : null;
  const marketplaces = Array.isArray(data.marketplaces)
    ? (data.marketplaces as AmazonMarketplaceSummary[])
    : [];
  const environment = typeof data.environment === "string" ? data.environment : "production";

  if (!accessToken && !refreshToken) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = expiresAt?.seconds ?? 0;
  const needsRefresh = !accessToken || expSec <= nowSec + AMAZON_TOKEN_REFRESH_BUFFER_SEC;

  if (needsRefresh) {
    if (!refreshToken) {
      if (!accessToken) return null;
    } else {
      try {
        const tokens = await refreshAmazonAccessToken(refreshToken);
        accessToken = tokens.access_token;
        await doc.ref.update({
          accessToken: tokens.access_token,
          expiresAt: {
            seconds: nowSec + (tokens.expires_in || 3600),
            nanoseconds: 0,
          },
        });
      } catch (err) {
        console.error("[getValidAmazonToken] refresh failed", connId, err);
        if (!accessToken) return null;
      }
    }
  }

  return {
    connectionId: connId,
    accessToken,
    refreshToken,
    sellingPartnerId,
    marketplaces,
    environment,
  };
}

export function buildAmazonListingKey(marketplaceId: string, sellerSku: string): string {
  return `${marketplaceId.trim()}_${sellerSku.trim()}`;
}

export function sanitizeAmazonFirestoreKey(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 180);
}

export type AmazonListingRow = {
  id: string;
  sellerSku: string;
  marketplaceId: string;
  asin?: string;
  title: string;
  sku?: string;
  status: string;
  quantity?: number;
  fulfillmentChannel?: string;
  imageUrl?: string;
};

function parseAmazonListingStatus(statuses: unknown): string {
  if (!Array.isArray(statuses) || statuses.length === 0) return "UNKNOWN";
  return statuses.map((s) => String(s)).join(", ");
}

function quantityFromFulfillment(
  fulfillment: unknown,
  marketplaceId: string
): { quantity: number; fulfillmentChannel?: string } {
  if (!Array.isArray(fulfillment)) return { quantity: 0 };
  let total = 0;
  let channel: string | undefined;
  for (const row of fulfillment) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const qty = Number(rec.quantity ?? 0);
    const code = typeof rec.fulfillmentChannelCode === "string" ? rec.fulfillmentChannelCode : undefined;
    if (Number.isFinite(qty) && qty > 0) {
      total += qty;
      if (!channel) channel = code;
    }
  }
  void marketplaceId;
  return { quantity: total, fulfillmentChannel: channel };
}

/** Fetch seller catalog listings via SP-API Listings Items search (paginated). */
export async function fetchAmazonSellerListings(input: {
  accessToken: string;
  sellingPartnerId: string;
  marketplaceIds: string[];
}): Promise<{ listings: AmazonListingRow[]; pagesFetched: number }> {
  const marketplaceIds = input.marketplaceIds.filter(Boolean);
  if (marketplaceIds.length === 0) {
    throw new Error("No Amazon marketplace IDs on this connection. Reconnect Amazon from Integrations.");
  }

  const listings: AmazonListingRow[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;
  let pagesFetched = 0;
  const maxPages = 100;

  while (pagesFetched < maxPages) {
    const query: Record<string, string> = {
      marketplaceIds: marketplaceIds.join(","),
      includedData: "summaries,attributes,fulfillmentAvailability",
      pageSize: "20",
    };
    if (pageToken) query.pageToken = pageToken;

    const res = await amazonSpApiGet({
      path: `/listings/2021-08-01/items/${encodeURIComponent(input.sellingPartnerId)}`,
      accessToken: input.accessToken,
      query,
    });

    if (!res.ok) {
      const errBody = res.data as Record<string, unknown>;
      const errors = Array.isArray(errBody.errors) ? errBody.errors : [];
      const first = errors[0] as { message?: string; code?: string } | undefined;
      const detail =
        first?.message ||
        (typeof errBody.message === "string" ? errBody.message : null) ||
        `Amazon SP-API HTTP ${res.status}`;
      throw new Error(detail);
    }

    const payload = asRecord(res.data);
    const items = Array.isArray(payload.items) ? payload.items : [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const sellerSku = String(row.sku ?? "").trim();
      if (!sellerSku) continue;

      const summaries = Array.isArray(row.summaries) ? row.summaries : [];
      const fulfillment = row.fulfillmentAvailability;
      if (summaries.length === 0) {
        const marketplaceId = marketplaceIds[0]!;
        const id = buildAmazonListingKey(marketplaceId, sellerSku);
        if (seen.has(id)) continue;
        seen.add(id);
        const { quantity, fulfillmentChannel } = quantityFromFulfillment(fulfillment, marketplaceId);
        listings.push({
          id,
          sellerSku,
          marketplaceId,
          title: sellerSku,
          sku: sellerSku,
          status: "UNKNOWN",
          quantity,
          fulfillmentChannel,
        });
        continue;
      }

      for (const summaryRaw of summaries) {
        if (!summaryRaw || typeof summaryRaw !== "object") continue;
        const summary = summaryRaw as Record<string, unknown>;
        const marketplaceId = String(summary.marketplaceId ?? marketplaceIds[0] ?? "").trim();
        if (!marketplaceId) continue;
        const id = buildAmazonListingKey(marketplaceId, sellerSku);
        if (seen.has(id)) continue;
        seen.add(id);

        const { quantity, fulfillmentChannel } = quantityFromFulfillment(fulfillment, marketplaceId);
        const mainImage = asRecord(summary.mainImage);
        const imageUrl =
          typeof mainImage.link === "string" && mainImage.link.startsWith("http")
            ? mainImage.link
            : undefined;

        listings.push({
          id,
          sellerSku,
          marketplaceId,
          asin: typeof summary.asin === "string" ? summary.asin : undefined,
          title:
            (typeof summary.itemName === "string" && summary.itemName.trim()) ||
            sellerSku,
          sku: sellerSku,
          status: parseAmazonListingStatus(summary.status),
          quantity,
          fulfillmentChannel,
          imageUrl,
        });
      }
    }

    pagesFetched += 1;
    const pagination = asRecord(payload.pagination);
    const next = typeof pagination.nextToken === "string" ? pagination.nextToken.trim() : "";
    if (!next) break;
    pageToken = next;
  }

  listings.sort((a, b) => a.title.localeCompare(b.title));
  return { listings, pagesFetched };
}
