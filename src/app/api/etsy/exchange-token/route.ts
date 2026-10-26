import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import {
  exchangeEtsyAuthorizationCode,
  etsyTokenFieldsFromResponse,
} from "@/lib/etsy-access-token";
import { etsyApiRequest, type EtsyShop, type EtsyUserMe } from "@/lib/etsy-api";
import { getEtsyAppCredentials, getEtsyRedirectUri } from "@/lib/etsy-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Exchange Etsy auth code for tokens and persist users/{uid}/etsyConnections.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let uid: string;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    uid = decoded.uid;
    if (!uid) throw new Error("No uid");
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  try {
    getEtsyAppCredentials();
  } catch {
    return NextResponse.json({ error: "Etsy app not configured" }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const callbackState = typeof body.state === "string" ? body.state : "";

  if (!code) {
    return NextResponse.json({ error: "Missing auth code from Etsy" }, { status: 400 });
  }

  const stateCookie = request.cookies.get("etsy_oauth_state")?.value;
  const codeVerifier = request.cookies.get("etsy_pkce_verifier")?.value;
  if (stateCookie && callbackState && stateCookie !== callbackState) {
    return NextResponse.json(
      { error: "Invalid or expired OAuth state. Restart connect from Integrations." },
      { status: 400 }
    );
  }
  if (!codeVerifier) {
    return NextResponse.json(
      {
        error:
          "Missing PKCE verifier cookie. Restart Connect from Integrations (same browser).",
      },
      { status: 400 }
    );
  }

  let redirectUri: string;
  try {
    redirectUri = getEtsyRedirectUri(request.nextUrl.origin);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Redirect URI not configured" },
      { status: 500 }
    );
  }

  let tokenData;
  try {
    tokenData = await exchangeEtsyAuthorizationCode({
      code,
      codeVerifier,
      redirectUri,
    });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[Etsy exchange-token]", detail);
    return NextResponse.json(
      { error: "Failed to exchange code with Etsy", detail },
      { status: 502 }
    );
  }

  let tokenFields;
  try {
    tokenFields = etsyTokenFieldsFromResponse(tokenData);
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Invalid Etsy token response",
      },
      { status: 502 }
    );
  }

  const accessToken = tokenFields.accessToken;

  let userId = "";
  let shopId = "";
  let shopName = "Etsy Shop";
  try {
    const me = await etsyApiRequest<EtsyUserMe>({
      path: "/users/me",
      accessToken,
    });
    userId = String(me.user_id ?? "");
  } catch (e) {
    console.warn("[Etsy exchange-token] /users/me failed", e);
  }

  if (userId) {
    try {
      const shopsRes = await etsyApiRequest<{ count?: number; results?: EtsyShop[] }>({
        path: `/users/${encodeURIComponent(userId)}/shops`,
        accessToken,
      });
      const shop = shopsRes.results?.[0];
      if (shop?.shop_id) {
        shopId = String(shop.shop_id);
        shopName = shop.shop_name || shop.title || shopName;
      }
    } catch (e) {
      console.warn("[Etsy exchange-token] shops failed", e);
    }
  }

  if (!shopId) {
    return NextResponse.json(
      {
        error:
          "Connected to Etsy but no shop was found for this account. Use a seller account with an active shop.",
      },
      { status: 400 }
    );
  }

  const db = adminDb();
  const col = db.collection("users").doc(uid).collection("etsyConnections");
  const snapshot = await col.where("shopId", "==", shopId).limit(1).get();
  const connectedAt = new Date();
  const docData = {
    shopId,
    shopName,
    etsyUserId: userId || null,
    ...tokenFields,
    connectedAt: { seconds: Math.floor(connectedAt.getTime() / 1000), nanoseconds: 0 },
  };

  let connectionId: string;
  if (!snapshot.empty) {
    await snapshot.docs[0].ref.update(docData);
    connectionId = snapshot.docs[0].id;
  } else {
    const added = await col.add(docData);
    connectionId = added.id;
  }

  await db.collection("etsyShopToUser").doc(shopId).set({
    userId: uid,
    connectionId,
    shopName,
    updatedAt: connectedAt.toISOString(),
  });

  const res = NextResponse.json({
    ok: true,
    connectionId,
    shopId,
    shopName,
  });
  res.cookies.set("etsy_oauth_state", "", { path: "/", maxAge: 0 });
  res.cookies.set("etsy_pkce_verifier", "", { path: "/", maxAge: 0 });
  return res;
}
