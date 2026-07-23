import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import {
  amazonSpApiGet,
  getAmazonLwaClientId,
  getAmazonLwaClientSecret,
  isAmazonSpApiSandbox,
  refreshAmazonAccessToken,
} from "@/lib/amazon-sp-api";

export const dynamic = "force-dynamic";

/**
 * Connect Amazon using a refresh token (self-authorization / Manage Authorizations flow).
 * Body (optional): { refreshToken?: string, sellingPartnerId?: string, addNew?: boolean }
 * If refreshToken omitted, uses AMAZON_REFRESH_TOKEN from env.
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

  if (!getAmazonLwaClientId() || !getAmazonLwaClientSecret()) {
    return NextResponse.json(
      { error: "Amazon LWA credentials not configured in env." },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const fromBody = typeof body.refreshToken === "string" ? body.refreshToken.trim() : "";
  const fromEnv = process.env.AMAZON_REFRESH_TOKEN?.trim() || "";
  const refreshToken = fromBody || fromEnv;
  const sellingPartnerId =
    typeof body.sellingPartnerId === "string" ? body.sellingPartnerId.trim() : "";
  const addNew = body.addNew === true;

  if (!refreshToken) {
    return NextResponse.json(
      {
        error:
          "Missing refresh token. Set AMAZON_REFRESH_TOKEN in .env.local or pass refreshToken in the request body.",
      },
      { status: 400 }
    );
  }

  try {
    const tokens = await refreshAmazonAccessToken(refreshToken);
    const now = new Date();
    const expiresIn = tokens.expires_in || 3600;

    // Verify SP-API access
    const verify = await amazonSpApiGet<{
      payload?: Array<{
        marketplace?: { id?: string; name?: string; countryCode?: string };
        participation?: { isParticipating?: boolean };
      }>;
      errors?: Array<{ message?: string; code?: string }>;
    }>({
      path: "/sellers/v1/marketplaceParticipations",
      accessToken: tokens.access_token,
    });

    if (!verify.ok) {
      const errMsg =
        (verify.data as { errors?: Array<{ message?: string }> })?.errors?.[0]?.message ||
        `SP-API verify failed (HTTP ${verify.status})`;
      return NextResponse.json(
        {
          error: "Refresh token obtained an access token, but SP-API verify failed.",
          detail: errMsg,
          sandbox: isAmazonSpApiSandbox(),
        },
        { status: 502 }
      );
    }

    const participations = Array.isArray(verify.data.payload) ? verify.data.payload : [];
    const marketplaces = participations
      .map((p) => ({
        id: p.marketplace?.id ?? null,
        name: p.marketplace?.name ?? null,
        countryCode: p.marketplace?.countryCode ?? null,
        isParticipating: p.participation?.isParticipating ?? null,
      }))
      .filter((m) => m.id);

    const db = adminDb();
    const col = db.collection("users").doc(uid).collection("amazonConnections");
    const snapshot = await col.limit(1).get();

    const docData = {
      accessToken: tokens.access_token,
      refreshToken,
      sellingPartnerId: sellingPartnerId || null,
      connectedAt: { seconds: Math.floor(now.getTime() / 1000), nanoseconds: 0 },
      expiresAt: {
        seconds: Math.floor(now.getTime() / 1000) + expiresIn,
        nanoseconds: 0,
      },
      environment: isAmazonSpApiSandbox() ? "sandbox" : "production",
      marketplaceRegion: process.env.AMAZON_SP_API_REGION || "NA",
      marketplaces,
      lastVerifiedAt: { seconds: Math.floor(now.getTime() / 1000), nanoseconds: 0 },
      authMethod: "refresh_token",
    };

    let connectionId: string;
    if (addNew) {
      const ref = await col.add(docData);
      connectionId = ref.id;
    } else if (!snapshot.empty) {
      await snapshot.docs[0]!.ref.update(docData);
      connectionId = snapshot.docs[0]!.id;
    } else {
      const ref = await col.add(docData);
      connectionId = ref.id;
    }

    return NextResponse.json({
      ok: true,
      connectionId,
      environment: docData.environment,
      marketplaceCount: marketplaces.length,
      marketplaces,
    });
  } catch (err: unknown) {
    console.error("[amazon connect-refresh-token]", err);
    return NextResponse.json(
      {
        error: "Failed to connect with refresh token",
        detail: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 502 }
    );
  }
}
