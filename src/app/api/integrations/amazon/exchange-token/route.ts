import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import {
  decodeAmazonOAuthState,
  exchangeAmazonAuthorizationCode,
  getAmazonRedirectUri,
  isAmazonSpApiSandbox,
} from "@/lib/amazon-sp-api";

export const dynamic = "force-dynamic";

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

  const body = await request.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const stateRaw = typeof body.state === "string" ? body.state.trim() : "";
  const sellingPartnerId =
    typeof body.sellingPartnerId === "string" ? body.sellingPartnerId.trim() : "";
  const addNew = body.addNew === true;

  if (!code) {
    return NextResponse.json({ error: "Missing authorization code" }, { status: 400 });
  }

  const state = decodeAmazonOAuthState(stateRaw);
  if (!state || state.u !== uid) {
    return NextResponse.json(
      { error: "Invalid or expired OAuth state. Start Connect again from Integrations." },
      { status: 400 }
    );
  }

  const cookieNonce = request.cookies.get("amazon_oauth_nonce")?.value;
  if (cookieNonce && cookieNonce !== state.n) {
    return NextResponse.json(
      { error: "OAuth state mismatch. Start Connect again from Integrations." },
      { status: 400 }
    );
  }

  const redirectUri = getAmazonRedirectUri();

  try {
    const tokens = await exchangeAmazonAuthorizationCode({ code, redirectUri });
    const now = new Date();
    const expiresIn = tokens.expires_in || 3600;

    const db = adminDb();
    const col = db.collection("users").doc(uid).collection("amazonConnections");
    const snapshot = await col.limit(1).get();

    const docData = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      sellingPartnerId: sellingPartnerId || null,
      connectedAt: { seconds: Math.floor(now.getTime() / 1000), nanoseconds: 0 },
      expiresAt: {
        seconds: Math.floor(now.getTime() / 1000) + expiresIn,
        nanoseconds: 0,
      },
      environment: isAmazonSpApiSandbox() ? "sandbox" : "production",
      marketplaceRegion: process.env.AMAZON_SP_API_REGION || "NA",
    };

    let connectionId: string;
    const shouldAdd = addNew || state.a === 1;
    if (shouldAdd) {
      const ref = await col.add(docData);
      connectionId = ref.id;
    } else if (!snapshot.empty) {
      await snapshot.docs[0]!.ref.update(docData);
      connectionId = snapshot.docs[0]!.id;
    } else {
      const ref = await col.add(docData);
      connectionId = ref.id;
    }

    const res = NextResponse.json({
      ok: true,
      connectionId,
      environment: docData.environment,
      sellingPartnerId: sellingPartnerId || null,
    });
    res.cookies.set("amazon_oauth_nonce", "", { httpOnly: true, path: "/", maxAge: 0 });
    return res;
  } catch (err: unknown) {
    console.error("[amazon exchange-token]", err);
    return NextResponse.json(
      {
        error: "Failed to exchange code with Amazon",
        detail: err instanceof Error ? err.message : "Token exchange failed",
      },
      { status: 502 }
    );
  }
}
