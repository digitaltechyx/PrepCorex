import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { getRequestHost, resolveEbayRuName } from "@/lib/ebay-oauth";

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
  const code = typeof body.code === "string" ? body.code.trim() : undefined;
  const addNew = body.addNew === true;
  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  const clientId = process.env.NEXT_PUBLIC_EBAY_APP_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const host = getRequestHost(request);
  const ruName = resolveEbayRuName(host);
  if (!clientId || !clientSecret || !ruName) {
    return NextResponse.json(
      { error: "eBay app not configured" },
      { status: 500 }
    );
  }

  const isSandbox =
    process.env.EBAY_SANDBOX !== "false" &&
    (clientId.includes("SBX") || process.env.EBAY_SANDBOX === "true");
  const tokenUrl = isSandbox
    ? "https://api.sandbox.ebay.com/identity/v1/oauth2/token"
    : "https://api.ebay.com/identity/v1/oauth2/token";

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const formBody = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: ruName,
  }).toString();

  try {
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
      body: formBody,
    });

    const data = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      refresh_token_expires_in?: number;
      error_description?: string;
    };

    if (!res.ok) {
      console.error("[ebay exchange-token]", res.status, data);
      return NextResponse.json(
        {
          error: "Failed to exchange code with eBay",
          detail: data.error_description || (data as Record<string, unknown>).error,
        },
        { status: 502 }
      );
    }

    const accessToken = data.access_token;
    const refreshToken = data.refresh_token;
    if (!accessToken) {
      return NextResponse.json(
        { error: "No access token in eBay response" },
        { status: 502 }
      );
    }

    const now = new Date();
    const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 7200;
    const refreshExpiresIn =
      typeof data.refresh_token_expires_in === "number"
        ? data.refresh_token_expires_in
        : 47304000;

    const db = adminDb();
    const col = db.collection("users").doc(uid).collection("ebayConnections");
    const snapshot = await col.limit(1).get();

    const docData = {
      accessToken,
      refreshToken: refreshToken || null,
      connectedAt: { seconds: Math.floor(now.getTime() / 1000), nanoseconds: 0 },
      expiresAt: { seconds: Math.floor(now.getTime() / 1000) + expiresIn, nanoseconds: 0 },
      refreshExpiresAt: {
        seconds: Math.floor(now.getTime() / 1000) + refreshExpiresIn,
        nanoseconds: 0,
      },
      environment: isSandbox ? "sandbox" : "production",
    };

    if (addNew) {
      await col.add(docData);
    } else if (!snapshot.empty) {
      await snapshot.docs[0].ref.update(docData);
    } else {
      await col.add(docData);
    }

    return NextResponse.json({
      ok: true,
      environment: isSandbox ? "sandbox" : "production",
    });
  } catch (err: unknown) {
    console.error("[ebay exchange-token]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Token exchange failed" },
      { status: 500 }
    );
  }
}
