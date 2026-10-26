import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import {
  ETSY_TOKEN_URL,
  etsyApiKeyHeader,
  getEtsyAppCredentials,
  getEtsyRedirectUri,
} from "@/lib/etsy-oauth";

const REFRESH_BUFFER_SEC = 120;

export class EtsyReconnectRequired extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EtsyReconnectRequired";
  }
}

type FirestoreTs = { seconds: number; nanoseconds?: number };

export type EtsyOAuthTokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  /** Space-separated scopes actually granted */
  scope?: string;
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

async function callEtsyTokenApi(
  body: Record<string, string>
): Promise<EtsyOAuthTokenResponse> {
  const res = await fetch(ETSY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "x-api-key": etsyApiKeyHeader(),
    },
    body: new URLSearchParams(body).toString(),
  });
  const text = await res.text();
  let data: EtsyOAuthTokenResponse & { error?: string; error_description?: string };
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    throw new Error(`Etsy token API invalid JSON: ${text.slice(0, 200)}`);
  }
  if (!res.ok || !data.access_token) {
    throw new Error(
      data.error_description || data.error || `Etsy token error HTTP ${res.status}`
    );
  }
  return data;
}

export async function exchangeEtsyAuthorizationCode(input: {
  code: string;
  codeVerifier: string;
  redirectUri?: string;
}): Promise<EtsyOAuthTokenResponse> {
  const { keystring } = getEtsyAppCredentials();
  return callEtsyTokenApi({
    grant_type: "authorization_code",
    client_id: keystring,
    redirect_uri: input.redirectUri || getEtsyRedirectUri(),
    code: input.code,
    code_verifier: input.codeVerifier,
  });
}

export async function refreshEtsyAccessToken(
  refreshToken: string
): Promise<EtsyOAuthTokenResponse> {
  const { keystring } = getEtsyAppCredentials();
  return callEtsyTokenApi({
    grant_type: "refresh_token",
    client_id: keystring,
    refresh_token: refreshToken,
  });
}

export function etsyTokenFieldsFromResponse(data: EtsyOAuthTokenResponse): {
  accessToken: string;
  expiresAt: FirestoreTs;
  refreshToken: string;
  grantedScopes?: string[];
} {
  const now = Date.now();
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  const refreshToken = data.refresh_token || "";
  if (!refreshToken) {
    throw new Error("Etsy did not return a refresh_token");
  }
  return {
    accessToken: data.access_token,
    expiresAt: toFirestoreTimestamp(new Date(now + expiresIn * 1000)),
    refreshToken,
    grantedScopes: data.scope
      ? data.scope.split(/\s+/).filter(Boolean)
      : undefined,
  };
}

export async function getValidEtsyAccessToken(
  connRef: DocumentReference,
  connData: Record<string, unknown>
): Promise<string> {
  const accessToken = String(connData.accessToken || "");
  const expiresAtMs = timestampToMs(
    connData.expiresAt as FirestoreTs | Date | undefined
  );
  const now = Date.now();
  if (
    accessToken &&
    expiresAtMs != null &&
    expiresAtMs > now + REFRESH_BUFFER_SEC * 1000
  ) {
    return accessToken;
  }

  const refreshToken = String(connData.refreshToken || "");
  if (!refreshToken) {
    throw new EtsyReconnectRequired(
      "Etsy connection expired. Reconnect the shop from Integrations."
    );
  }

  let refreshed: EtsyOAuthTokenResponse;
  try {
    refreshed = await refreshEtsyAccessToken(refreshToken);
  } catch (err) {
    throw new EtsyReconnectRequired(
      err instanceof Error
        ? err.message
        : "Etsy token refresh failed. Reconnect the shop."
    );
  }

  const fields = etsyTokenFieldsFromResponse({
    ...refreshed,
    refresh_token: refreshed.refresh_token || refreshToken,
  });
  await connRef.update({
    accessToken: fields.accessToken,
    expiresAt: fields.expiresAt,
    refreshToken: fields.refreshToken,
    ...(fields.grantedScopes ? { grantedScopes: fields.grantedScopes } : {}),
  });
  return fields.accessToken;
}

export async function getValidEtsyAccessTokenForConnection(
  db: Firestore,
  uid: string,
  connectionId: string
): Promise<{ accessToken: string; connRef: DocumentReference; data: Record<string, unknown> }> {
  const connRef = db
    .collection("users")
    .doc(uid)
    .collection("etsyConnections")
    .doc(connectionId);
  const snap = await connRef.get();
  if (!snap.exists) throw new Error("Etsy connection not found");
  const data = snap.data() as Record<string, unknown>;
  const accessToken = await getValidEtsyAccessToken(connRef, data);
  return { accessToken, connRef, data };
}
