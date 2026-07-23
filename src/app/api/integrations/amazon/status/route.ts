import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import {
  amazonSpApiGet,
  isAmazonSpApiSandbox,
  refreshAmazonAccessToken,
} from "@/lib/amazon-sp-api";

export const dynamic = "force-dynamic";

/**
 * Verify an existing Amazon connection (refresh access token + marketplace participations).
 * Query: connectionId (optional — uses first connection if omitted)
 */
export async function GET(request: NextRequest) {
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

  const connectionId = request.nextUrl.searchParams.get("connectionId")?.trim();
  const col = adminDb().collection("users").doc(uid).collection("amazonConnections");

  try {
    let ref;
    if (connectionId) {
      ref = col.doc(connectionId);
    } else {
      const snap = await col.limit(1).get();
      if (snap.empty) {
        return NextResponse.json({ error: "No Amazon connection found." }, { status: 404 });
      }
      ref = snap.docs[0]!.ref;
    }

    const doc = await ref.get();
    if (!doc.exists) {
      return NextResponse.json({ error: "Connection not found." }, { status: 404 });
    }
    const data = doc.data() || {};
    const refreshToken = String(data.refreshToken ?? "").trim();
    if (!refreshToken) {
      return NextResponse.json({ error: "Connection has no refresh token." }, { status: 400 });
    }

    const tokens = await refreshAmazonAccessToken(refreshToken);
    const verify = await amazonSpApiGet<{
      payload?: Array<{
        marketplace?: { id?: string; name?: string; countryCode?: string };
      }>;
    }>({
      path: "/sellers/v1/marketplaceParticipations",
      accessToken: tokens.access_token,
    });

    if (!verify.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "SP-API verify failed",
          status: verify.status,
          detail: verify.data,
          sandbox: isAmazonSpApiSandbox(),
        },
        { status: 502 }
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const participations = Array.isArray(verify.data.payload) ? verify.data.payload : [];
    const marketplaces = participations
      .map((p) => ({
        id: p.marketplace?.id ?? null,
        name: p.marketplace?.name ?? null,
        countryCode: p.marketplace?.countryCode ?? null,
      }))
      .filter((m) => m.id);

    await ref.update({
      accessToken: tokens.access_token,
      expiresAt: { seconds: now + (tokens.expires_in || 3600), nanoseconds: 0 },
      marketplaces,
      lastVerifiedAt: { seconds: now, nanoseconds: 0 },
    });

    return NextResponse.json({
      ok: true,
      connectionId: doc.id,
      environment: data.environment ?? (isAmazonSpApiSandbox() ? "sandbox" : "production"),
      marketplaceCount: marketplaces.length,
      marketplaces,
    });
  } catch (err: unknown) {
    console.error("[amazon status]", err);
    return NextResponse.json(
      {
        error: "Failed to verify Amazon connection",
        detail: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
