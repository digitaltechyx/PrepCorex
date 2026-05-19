import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { parseShopifyErrorBody } from "@/lib/shopify-api";
import { normalizeShopDomain } from "@/lib/shopify-oauth";

/** Refresh access token this many seconds before expiry. */
const REFRESH_BUFFER_SEC = 120;

export class ShopifyReconnectRequired extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopifyReconnectRequired";
  }
}

type FirestoreTs = { seconds: number; nanoseconds?: number };

export type ShopifyOAuthTokenResponse = {
  access_token: string;
  scope?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
};

function getClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.NEXT_PUBLIC_SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Shopify app not configured");
  }
  return { clientId, clientSecret };
}

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

async function postShopifyAccessToken(
  shop: string,
  params: Record<string, string>
): Promise<ShopifyOAuthTokenResponse> {
  const { clientId, clientSecret } = getClientCredentials();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    ...params,
  });
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    const detail = parseShopifyErrorBody(text);
    const err = new Error(detail);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  const data = JSON.parse(text) as ShopifyOAuthTokenResponse;
  if (!data.access_token) {
    throw new Error("No access_token in Shopify response");
  }
  return data;
}

/** Exchange OAuth authorization code for expiring offline tokens (required for Admin API). */
export async function exchangeShopifyAuthorizationCode(
  shop: string,
  code: string
): Promise<ShopifyOAuthTokenResponse> {
  return postShopifyAccessToken(shop, { code, expiring: "1" });
}

/** Refresh an expiring offline access token. */
export async function refreshShopifyOfflineAccessToken(
  shop: string,
  refreshToken: string
): Promise<ShopifyOAuthTokenResponse> {
  return postShopifyAccessToken(shop, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

/** Fields to persist on users/{uid}/shopifyConnections after OAuth or refresh. */
export function shopifyTokenFieldsFromResponse(data: ShopifyOAuthTokenResponse): {
  accessToken: string;
  expiresAt: FirestoreTs;
  refreshToken: string;
  refreshTokenExpiresAt: FirestoreTs;
  scope?: string;
  tokenType: "expiring_offline";
} {
  const now = Date.now();
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
  const refreshExpiresIn =
    typeof data.refresh_token_expires_in === "number" ? data.refresh_token_expires_in : 90 * 24 * 3600;
  if (!data.refresh_token) {
    throw new Error("Shopify did not return a refresh_token. Ensure expiring=1 is set on token exchange.");
  }
  return {
    accessToken: data.access_token,
    expiresAt: toFirestoreTimestamp(new Date(now + expiresIn * 1000)),
    refreshToken: data.refresh_token,
    refreshTokenExpiresAt: toFirestoreTimestamp(new Date(now + refreshExpiresIn * 1000)),
    ...(data.scope ? { scope: data.scope } : {}),
    tokenType: "expiring_offline",
  };
}

/**
 * Return a valid Admin API access token, refreshing and persisting when near expiry.
 * Legacy non-expiring tokens must reconnect (Shopify rejects them on the Admin API).
 */
export async function getValidShopifyAccessToken(
  connRef: DocumentReference,
  connData: Record<string, unknown>,
  shop: string
): Promise<string> {
  const accessToken = connData.accessToken as string | undefined;
  const refreshToken = connData.refreshToken as string | undefined;
  const expiresAtMs = timestampToMs(connData.expiresAt as FirestoreTs | undefined);
  const refreshExpiresAtMs = timestampToMs(connData.refreshTokenExpiresAt as FirestoreTs | undefined);
  const now = Date.now();

  if (accessToken && !refreshToken && !expiresAtMs) {
    throw new ShopifyReconnectRequired(
      "This store uses a legacy Shopify token. Disconnect and reconnect from Integrations to continue."
    );
  }

  if (accessToken && expiresAtMs && now < expiresAtMs - REFRESH_BUFFER_SEC * 1000) {
    return accessToken;
  }

  if (!refreshToken) {
    throw new ShopifyReconnectRequired(
      "Shopify connection is missing a refresh token. Disconnect and reconnect the store from Integrations."
    );
  }

  if (refreshExpiresAtMs && now >= refreshExpiresAtMs) {
    throw new ShopifyReconnectRequired(
      "Shopify refresh token expired. Disconnect and reconnect the store from Integrations."
    );
  }

  const refreshed = await refreshShopifyOfflineAccessToken(shop, refreshToken);
  const fields = shopifyTokenFieldsFromResponse(refreshed);
  await connRef.update({
    ...fields,
    updatedAt: toFirestoreTimestamp(new Date()),
  });
  return fields.accessToken;
}

export async function getShopifyAccessTokenForUserShop(
  db: Firestore,
  uid: string,
  shop: string
): Promise<string> {
  const shopNorm = normalizeShopDomain(shop) ?? shop;
  const snap = await db
    .collection("users")
    .doc(uid)
    .collection("shopifyConnections")
    .where("shop", "==", shopNorm)
    .limit(1)
    .get();
  if (snap.empty) {
    throw new Error("Store not connected");
  }
  const doc = snap.docs[0];
  return getValidShopifyAccessToken(doc.ref, doc.data(), shopNorm);
}
