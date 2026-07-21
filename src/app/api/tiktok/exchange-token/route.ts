import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { parseTikTokError, tikTokApiRequest } from "@/lib/tiktok-api";
import {
  exchangeTikTokAuthorizationCode,
  tikTokTokenFieldsFromResponse,
} from "@/lib/tiktok-access-token";
import { getTikTokAppCredentials } from "@/lib/tiktok-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AuthorizedShop = {
  id?: string;
  name?: string;
  region?: string;
  seller_type?: string;
  cipher?: string;
  code?: string;
};

/**
 * Exchange TikTok auth_code for tokens and persist users/{uid}/tiktokConnections.
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
    getTikTokAppCredentials();
  } catch {
    return NextResponse.json({ error: "TikTok app not configured" }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const code =
    (typeof body.code === "string" && body.code.trim()) ||
    (typeof body.auth_code === "string" && body.auth_code.trim()) ||
    "";
  const callbackState = typeof body.state === "string" ? body.state : "";

  if (!code) {
    return NextResponse.json({ error: "Missing auth code from TikTok" }, { status: 400 });
  }

  const stateCookie = request.cookies.get("tiktok_oauth_state")?.value;
  if (stateCookie && callbackState && stateCookie !== callbackState) {
    return NextResponse.json(
      { error: "Invalid or expired OAuth state. Restart connect from Integrations." },
      { status: 400 }
    );
  }

  let tokenData;
  try {
    tokenData = await exchangeTikTokAuthorizationCode(code);
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[TikTok exchange-token]", detail);
    return NextResponse.json(
      { error: "Failed to exchange code with TikTok", detail },
      { status: 502 }
    );
  }

  const tokenFields = tikTokTokenFieldsFromResponse(tokenData);
  const accessToken = tokenFields.accessToken;

  // Fetch authorized shops for cipher + display name
  let shops: AuthorizedShop[] = [];
  try {
    const shopsRes = await tikTokApiRequest<{ shops?: AuthorizedShop[] }>({
      method: "GET",
      path: "/authorization/202309/shops",
      accessToken,
    });
    if (shopsRes.code === 0 && Array.isArray(shopsRes.data?.shops)) {
      shops = shopsRes.data!.shops!;
    } else if (shopsRes.code !== 0) {
      console.warn("[TikTok exchange-token] shops:", parseTikTokError(shopsRes));
    }
  } catch (e) {
    console.warn("[TikTok exchange-token] shops fetch failed", e);
  }

  const primary = shops[0];
  const shopId = String(primary?.id || tokenFields.openId || "unknown");
  const shopCipher = primary?.cipher || primary?.code || null;
  const shopName =
    primary?.name ||
    tokenFields.sellerName ||
    `TikTok Shop ${shopId.slice(-6)}`;

  const db = adminDb();
  const col = db.collection("users").doc(uid).collection("tiktokConnections");
  const snapshot = await col.where("shopId", "==", shopId).limit(1).get();
  const connectedAt = new Date();
  const docData = {
    shopId,
    shopName,
    shopCipher,
    region: primary?.region || tokenFields.sellerBaseRegion || null,
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

  // Map shop → user for future webhooks
  await db.collection("tiktokShopToUser").doc(shopId).set({
    userId: uid,
    connectionId,
    shopCipher,
    updatedAt: connectedAt.toISOString(),
  });

  const res = NextResponse.json({
    ok: true,
    connectionId,
    shopId,
    shopName,
    shopCipher,
  });
  res.cookies.set("tiktok_oauth_state", "", { path: "/", maxAge: 0 });
  return res;
}
