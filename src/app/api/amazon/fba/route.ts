import { NextRequest, NextResponse } from "next/server";
import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import {
  fetchAmazonFbaInboundPlans,
  fetchAmazonFbaInventorySummaries,
  getAmazonConnectionTokensOrThrow,
  resolveAmazonMarketplaceIds,
} from "@/lib/amazon-sp-api-orders";
import { authorizeAmazonUserRoute, requireAdminAmazonRoute } from "@/lib/amazon-route-auth";

export const dynamic = "force-dynamic";

async function loadFbaData(userId: string, connectionId?: string) {
  const tokens = await getAmazonConnectionTokensOrThrow(userId, connectionId);
  const marketplaceIds = resolveAmazonMarketplaceIds(tokens.marketplaces);
  const [inventory, inboundPlans] = await Promise.all([
    fetchAmazonFbaInventorySummaries({
      accessToken: tokens.accessToken,
      marketplaceIds,
    }),
    fetchAmazonFbaInboundPlans({ accessToken: tokens.accessToken }),
  ]);
  return {
    connectionId: tokens.connectionId,
    storeName: tokens.marketplaces.map((m) => m.storeName || m.name).find(Boolean) || "Amazon",
    marketplaceIds,
    inventory,
    inboundPlans,
  };
}

/** GET /api/amazon/fba?userId=&connectionId= — client or admin */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId")?.trim() || "";
  const connectionId = searchParams.get("connectionId")?.trim() || undefined;

  if (!userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }

  const auth = await authorizeAmazonUserRoute(request, userId);
  if (auth instanceof NextResponse) return auth;

  try {
    const data = await loadFbaData(userId, connectionId);
    return NextResponse.json(data);
  } catch (err: unknown) {
    console.error("[amazon/fba GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}

/** POST /api/admin/amazon/fba — sync all clients (admin) */
export async function POST(request: NextRequest) {
  const denied = await requireAdminAmazonRoute(request);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || "all").trim() || "all";

  try {
    const db = adminDb();
    let uids: string[] = [];
    if (userId !== "all") {
      uids = [userId];
    } else {
      const snap = await db.collectionGroup("amazonConnections").get();
      uids = Array.from(
        new Set(
          snap.docs
            .map((d: QueryDocumentSnapshot) => d.ref.parent.parent?.id)
            .filter((id: string | undefined): id is string => Boolean(id))
        )
      );
    }

    const results = [];
    const errors: string[] = [];
    for (const uid of uids) {
      try {
        const data = await loadFbaData(uid);
        results.push({ userId: uid, ...data });
      } catch (err) {
        errors.push(`${uid}: ${err instanceof Error ? err.message : "Failed"}`);
      }
    }

    return NextResponse.json({ results, errors });
  } catch (err: unknown) {
    console.error("[admin/amazon/fba POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
