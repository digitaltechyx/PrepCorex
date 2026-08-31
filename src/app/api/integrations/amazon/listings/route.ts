import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import {
  fetchAmazonSellerListings,
  getValidAmazonToken,
  refreshAmazonConnectionMarketplaces,
  type AmazonMarketplaceSummary,
} from "@/lib/amazon-sp-api";

export const dynamic = "force-dynamic";

function marketplaceIdsFromConnection(marketplaces: AmazonMarketplaceSummary[]): string[] {
  const ids = marketplaces
    .map((m) => (typeof m.id === "string" ? m.id.trim() : ""))
    .filter(Boolean);
  return Array.from(new Set(ids));
}

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

  const connectionId = request.nextUrl.searchParams.get("connectionId")?.trim() || undefined;
  const conn = await getValidAmazonToken(uid, connectionId);
  if (!conn) {
    return NextResponse.json(
      { error: "No Amazon connection. Connect your Amazon seller account in Integrations first." },
      { status: 400 }
    );
  }

  const sellingPartnerId = conn.sellingPartnerId?.trim();
  if (!sellingPartnerId) {
    return NextResponse.json(
      {
        error:
          "Missing selling partner ID on this connection. Disconnect and reconnect Amazon from Integrations.",
      },
      { status: 400 }
    );
  }

  let marketplaceIds = marketplaceIdsFromConnection(conn.marketplaces);
  if (marketplaceIds.length === 0) {
    const refreshed = await refreshAmazonConnectionMarketplaces({
      uid,
      connectionId: conn.connectionId,
      accessToken: conn.accessToken,
    });
    marketplaceIds = marketplaceIdsFromConnection(refreshed);
  }

  if (marketplaceIds.length === 0) {
    return NextResponse.json(
      {
        error:
          "No Amazon marketplaces found on this connection. Disconnect and reconnect Amazon from Integrations.",
        hint:
          "Ensure the PrepCorex SP-API app has the Product Listing role and that Seller Central authorization completed. If you use production Amazon, confirm AMAZON_SP_API_SANDBOX is not set to true on the server.",
      },
      { status: 400 }
    );
  }

  try {
    const { listings, pagesFetched } = await fetchAmazonSellerListings({
      accessToken: conn.accessToken,
      sellingPartnerId,
      marketplaceIds,
    });

    return NextResponse.json({
      listings,
      environment: conn.environment === "sandbox" ? "sandbox" : "production",
      sellingPartnerId,
      marketplaceIds,
      pagesFetched,
      listingCount: listings.length,
    });
  } catch (err: unknown) {
    console.error("[amazon listings GET]", err);
    const message = err instanceof Error ? err.message : "Failed to load Amazon listings";
    const lower = message.toLowerCase();
    const hint =
      lower.includes("unauthorized") || lower.includes("403") || lower.includes("access")
        ? "Ensure the PrepCorex SP-API app includes Product Listing role and reconnect Amazon."
        : "Try again or reconnect Amazon from Integrations.";
    return NextResponse.json({ error: message, hint }, { status: 502 });
  }
}
