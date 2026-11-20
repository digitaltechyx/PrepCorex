import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { ShopifyReconnectRequired } from "@/lib/shopify-access-token";
import type { ShopifyNormalizedOrder } from "@/lib/shopify-order-normalize";
import {
  loadUserShopifyOrdersFromFirestore,
  syncShopifyOrdersForUser,
} from "@/lib/shopify-order-sync";
import { authorizeShopifyUserRoute } from "@/lib/shopify-route-auth";

export const dynamic = "force-dynamic";

function mergeOrdersById(
  cached: ShopifyNormalizedOrder[],
  live: ShopifyNormalizedOrder[]
): ShopifyNormalizedOrder[] {
  const byId = new Map<string, ShopifyNormalizedOrder>();
  for (const o of cached) {
    if (o.id) byId.set(o.id, o);
  }
  // Live sync wins for overlapping ids (fresher Shopify payload).
  for (const o of live) {
    if (o.id) byId.set(o.id, o);
  }
  return Array.from(byId.values()).sort((a, b) => {
    const aMs = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bMs = b.createdAt ? Date.parse(b.createdAt) : 0;
    return (Number.isNaN(bMs) ? 0 : bMs) - (Number.isNaN(aMs) ? 0 : aMs);
  });
}

/**
 * GET /api/shopify/orders?userId=&shop=&connectionId=&source=live|cache
 * live: sync from Shopify, then return live + all Firestore history for this client.
 * cache: Firestore only.
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
      const orders = await loadUserShopifyOrdersFromFirestore(adminDb(), userId, {
        shop,
        connectionId,
        limit: 2000,
      });
      return NextResponse.json({ orders, source: "cache" });
    }

    const result = await syncShopifyOrdersForUser(adminDb(), userId, {
      shop,
      connectionId,
      persist: true,
    });
    const cached = await loadUserShopifyOrdersFromFirestore(adminDb(), userId, {
      shop,
      connectionId,
      limit: 2000,
    });
    const orders = mergeOrdersById(cached, result.orders);

    return NextResponse.json({
      orders,
      connections: result.connections,
      source: "live",
      syncedNow: result.orders.length,
      total: orders.length,
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
    const cached = await loadUserShopifyOrdersFromFirestore(adminDb(), userId, {
      shop,
      connectionId,
      limit: 2000,
    });
    const orders = mergeOrdersById(cached, result.orders);

    return NextResponse.json({
      ok: true,
      synced: result.orders.length,
      orders,
      connections: result.connections,
      total: orders.length,
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
