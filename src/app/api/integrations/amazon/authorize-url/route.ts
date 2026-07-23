import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { adminAuth } from "@/lib/firebase-admin";
import {
  buildAmazonConsentUrl,
  encodeAmazonOAuthState,
  getAmazonLwaClientId,
  getAmazonLwaClientSecret,
  getAmazonSpApiAppId,
  isAmazonSpApiSandbox,
} from "@/lib/amazon-sp-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
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

  if (!getAmazonLwaClientId() || !getAmazonLwaClientSecret() || !getAmazonSpApiAppId()) {
    return NextResponse.json(
      {
        error:
          "Amazon SP-API not configured. Set AMAZON_LWA_CLIENT_ID, AMAZON_LWA_CLIENT_SECRET, and AMAZON_SP_API_APP_ID.",
      },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const addNew = searchParams.get("addNew") === "true";
  const nonce = randomBytes(16).toString("hex");
  const state = encodeAmazonOAuthState({
    u: uid,
    n: nonce,
    a: addNew ? 1 : 0,
    t: Date.now(),
  });

  try {
    const url = buildAmazonConsentUrl({
      state,
      versionBeta: true, // Draft / sandbox app authorization
    });

    const res = NextResponse.json({
      url,
      sandbox: isAmazonSpApiSandbox(),
      hint: "Register Login URI and Redirect URI in Amazon Developer Central → Edit App.",
    });
    res.cookies.set("amazon_oauth_nonce", nonce, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 30 * 60,
    });
    return res;
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to build Amazon authorize URL" },
      { status: 500 }
    );
  }
}
