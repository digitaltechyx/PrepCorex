import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { ShopifyReconnectRequired } from "@/lib/shopify-access-token";
import { shopifyOrderFromFirestore } from "@/lib/shopify-order-normalize";
import { syncShopifyOrdersForUser } from "@/lib/shopify-order-sync";
import { authorizeShopifyUserRoute } from "@/lib/shopify-route-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/shopify/orders?userId=&shop=&connectionId=&source=live|cache
 * Default: live pull from Shopify with full order details (like TikTok), persisted to Firestore.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId")?.trim() || "";
  const shop = searchParams.get("shop")?.trim() || undefined;
  const connectionId = searchParams.get("connectionId")?.trim() || undefined;
  const source = searchParams.get("source")?.trim() || "live";

  if (!userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }

  const auth = await authorizeShopifyUserRoute(request, userId);
  if (auth instanceof NextResponse) return auth;

  try {
    if (source === "cache") {
      const snapshot = await adminDb()
        .collection("users")
        .doc(userId)
        .collection("shopifyOrders")
        .orderBy("created_at", "desc")
        .limit(200)
        .get();
      let orders = snapshot.docs.map((d) => shopifyOrderFromFirestore(d.id, d.data()));
      if (shop) {
        const shopNorm = shop.includes(".myshopify.com") ? shop.toLowerCase() : `${shop.toLowerCase()}.myshopify.com`;
        orders = orders.filter((o) => o.shop.toLowerCase() === shopNorm);
      }
      if (connectionId) {
        orders = orders.filter((o) => o.connectionId === connectionId);
      }
      return NextResponse.json({ orders, source: "cache" });
    }

    const result = await syncShopifyOrdersForUser(adminDb(), userId, {
      shop,
      connectionId,
      persist: true,
    });
    return NextResponse.json({
      orders: result.orders,
      connections: result.connections,
      source: "live",
    });
  } catch (err: unknown) {
    if (err instanceof ShopifyReconnectRequired) {
      return NextResponse.json({ error: err.message, reconnect: true }, { status: 401 });
    }
    console.error("[shopify/orders GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}

/** POST: explicit sync (ShipStation-style). Body/query: userId, shop?, connectionId? */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const userId =
    String(body.userId || new URL(request.url).searchParams.get("userId") || "").trim();
  const shop = String(body.shop || new URL(request.url).searchParams.get("shop") || "").trim() || undefined;
  const connectionId =
    String(body.connectionId || new URL(request.url).searchParams.get("connectionId") || "").trim() ||
    undefined;

  if (!userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }

  const auth = await authorizeShopifyUserRoute(request, userId);
  if (auth instanceof NextResponse) return auth;

  try {
    const result = await syncShopifyOrdersForUser(adminDb(), userId, {
      shop,
      connectionId,
      persist: true,
    });
    return NextResponse.json({
      ok: true,
      synced: result.orders.length,
      orders: result.orders,
      connections: result.connections,
    });
  } catch (err: unknown) {
    if (err instanceof ShopifyReconnectRequired) {
      return NextResponse.json({ error: err.message, reconnect: true }, { status: 401 });
    }
    console.error("[shopify/orders POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
