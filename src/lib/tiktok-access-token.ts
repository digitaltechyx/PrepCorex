import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { TIKTOK_AUTH_BASE } from "@/lib/tiktok-api";
import { getTikTokAppCredentials } from "@/lib/tiktok-oauth";

const REFRESH_BUFFER_SEC = 120;

export class TikTokReconnectRequired extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TikTokReconnectRequired";
  }
}

type FirestoreTs = { seconds: number; nanoseconds?: number };

export type TikTokOAuthTokenResponse = {
  access_token: string;
  access_token_expire_in?: number;
  refresh_token: string;
  refresh_token_expire_in?: number;
  open_id?: string;
  seller_name?: string;
  seller_base_region?: string;
  user_type?: number;
  granted_scopes?: string[];
};

type TikTokTokenApiEnvelope = {
  code: number;
  message?: string;
  data?: TikTokOAuthTokenResponse;
};

function toFirestoreTimestamp(date: Date): FirestoreTs {
  return { seconds: Math.floor(date.getTime() / 1000), nanoseconds: 0 };
}

function timestampToMs(ts: FirestoreTs | Date | undefined): number | null {
  if (!ts) return null;
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts.seconds === "number") {
    return ts.seconds * 1000 + (ts.nanoseconds ?? 0) / 1e6;
  }
  return null;
}

async function callTikTokTokenApi(
  path: "/api/v2/token/get" | "/api/v2/token/refresh",
  params: Record<string, string>
): Promise<TikTokOAuthTokenResponse> {
  const { appKey, appSecret } = getTikTokAppCredentials();
  const q = new URLSearchParams({
    app_key: appKey,
    app_secret: appSecret,
    ...params,
  });
  const url = `${TIKTOK_AUTH_BASE}${path}?${q.toString()}`;
  const res = await fetch(url, { method: "GET" });
  const text = await res.text();
  let envelope: TikTokTokenApiEnvelope;
  try {
    envelope = JSON.parse(text) as TikTokTokenApiEnvelope;
  } catch {
    throw new Error(`TikTok token API invalid JSON: ${text.slice(0, 200)}`);
  }
  if (envelope.code !== 0 || !envelope.data?.access_token) {
    throw new Error(envelope.message || `TikTok token error code ${envelope.code}`);
  }
  if (!envelope.data.refresh_token) {
    throw new Error("TikTok did not return a refresh_token");
  }
  return envelope.data;
}

export async function exchangeTikTokAuthorizationCode(
  authCode: string
): Promise<TikTokOAuthTokenResponse> {
  return callTikTokTokenApi("/api/v2/token/get", {
    auth_code: authCode,
    grant_type: "authorized_code",
  });
}

export async function refreshTikTokAccessToken(
  refreshToken: string
): Promise<TikTokOAuthTokenResponse> {
  return callTikTokTokenApi("/api/v2/token/refresh", {
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
}

export function tikTokTokenFieldsFromResponse(data: TikTokOAuthTokenResponse): {
  accessToken: string;
  expiresAt: FirestoreTs;
  refreshToken: string;
  refreshTokenExpiresAt: FirestoreTs;
  openId?: string;
  sellerName?: string;
  sellerBaseRegion?: string;
  grantedScopes?: string[];
} {
  const now = Date.now();
  // TikTok often returns absolute unix expiry, not relative seconds — handle both.
  const accessExpire =
    typeof data.access_token_expire_in === "number" ? data.access_token_expire_in : 0;
  const refreshExpire =
    typeof data.refresh_token_expire_in === "number" ? data.refresh_token_expire_in : 0;

  const accessMs =
    accessExpire > 1_000_000_000
      ? accessExpire * 1000
      : now + (accessExpire || 3600) * 1000;
  const refreshMs =
    refreshExpire > 1_000_000_000
      ? refreshExpire * 1000
      : now + (refreshExpire || 30 * 24 * 3600) * 1000;

  return {
    accessToken: data.access_token,
    expiresAt: toFirestoreTimestamp(new Date(accessMs)),
    refreshToken: data.refresh_token,
    refreshTokenExpiresAt: toFirestoreTimestamp(new Date(refreshMs)),
    ...(data.open_id ? { openId: data.open_id } : {}),
    ...(data.seller_name ? { sellerName: data.seller_name } : {}),
    ...(data.seller_base_region ? { sellerBaseRegion: data.seller_base_region } : {}),
    ...(data.granted_scopes ? { grantedScopes: data.granted_scopes } : {}),
  };
}

type ConnData = {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: FirestoreTs;
  refreshTokenExpiresAt?: FirestoreTs;
};

/** Return a valid access token, refreshing if near expiry. */
export async function getValidTikTokAccessToken(
  connRef: DocumentReference,
  data: ConnData
): Promise<string> {
  const accessToken = data.accessToken;
  if (!accessToken) {
    throw new TikTokReconnectRequired("Missing TikTok access token. Reconnect the shop.");
  }
  const expiresMs = timestampToMs(data.expiresAt);
  const needsRefresh =
    !expiresMs || expiresMs - Date.now() < REFRESH_BUFFER_SEC * 1000;

  if (!needsRefresh) return accessToken;

  const refreshToken = data.refreshToken;
  if (!refreshToken) {
    throw new TikTokReconnectRequired("TikTok session expired. Reconnect the shop.");
  }
  const refreshExpiresMs = timestampToMs(data.refreshTokenExpiresAt);
  if (refreshExpiresMs && refreshExpiresMs < Date.now()) {
    throw new TikTokReconnectRequired("TikTok refresh token expired. Reconnect the shop.");
  }

  try {
    const refreshed = await refreshTikTokAccessToken(refreshToken);
    const fields = tikTokTokenFieldsFromResponse(refreshed);
    await connRef.update(fields);
    return fields.accessToken;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TikTokReconnectRequired(`TikTok token refresh failed: ${msg}`);
  }
}

export async function getTikTokConnectionForUser(
  db: Firestore,
  uid: string,
  connectionId: string
): Promise<{ ref: DocumentReference; data: Record<string, unknown> }> {
  const ref = db.collection("users").doc(uid).collection("tiktokConnections").doc(connectionId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error("TikTok connection not found");
  }
  return { ref, data: snap.data() as Record<string, unknown> };
}
