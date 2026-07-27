import type { Firestore } from "firebase-admin/firestore";
import { shopifyAdminRestUrl } from "@/lib/shopify-api";
import { getValidShopifyAccessToken, ShopifyReconnectRequired } from "@/lib/shopify-access-token";
import {
  normalizeShopifyOrder,
  shopifyOrderToFirestoreDoc,
  type ShopifyNormalizedOrder,
} from "@/lib/shopify-order-normalize";

export type ShopifyConnectionRow = {
  id: string;
  shop: string;
  shopName?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: { seconds: number; nanoseconds?: number };
  refreshTokenExpiresAt?: { seconds: number; nanoseconds?: number };
};

const MAX_ORDERS = 500;
const LOOKBACK_DAYS = 30;

function parseNextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const parts = linkHeader.split(",");
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

export async function fetchShopifyOrdersFromApi(
  shop: string,
  accessToken: string,
  options?: { lookbackDays?: number; maxOrders?: number }
): Promise<Record<string, unknown>[]> {
  const lookbackDays = options?.lookbackDays ?? LOOKBACK_DAYS;
  const maxOrders = options?.maxOrders ?? MAX_ORDERS;
  const createdMin = new Date();
  createdMin.setDate(createdMin.getDate() - lookbackDays);

  const orders: Record<string, unknown>[] = [];
  let url: string | null =
    `${shopifyAdminRestUrl(shop, "/orders.json")}?` +
    new URLSearchParams({
      status: "any",
      limit: "250",
      created_at_min: createdMin.toISOString(),
    }).toString();

  while (url && orders.length < maxOrders) {
    const res = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Shopify orders fetch failed (${res.status}): ${text.slice(0, 240)}`);
    }
    const data = (await res.json()) as { orders?: Array<Record<string, unknown>> };
    const batch = data.orders ?? [];
    orders.push(...batch);
    if (batch.length === 0) break;
    url = parseNextPageUrl(res.headers.get("link"));
  }

  return orders.slice(0, maxOrders);
}

export async function syncShopifyOrdersForUser(
  db: Firestore,
  userId: string,
  options?: { shop?: string; connectionId?: string; persist?: boolean }
): Promise<{
  orders: ShopifyNormalizedOrder[];
  connections: Array<{ id: string; shop: string; shopName: string }>;
}> {
  const col = db.collection("users").doc(userId).collection("shopifyConnections");
  let connections: ShopifyConnectionRow[] = [];

  if (options?.connectionId) {
    const snap = await col.doc(options.connectionId).get();
    if (!snap.exists) throw new Error("Connection not found");
    connections = [{ id: snap.id, ...(snap.data() as Omit<ShopifyConnectionRow, "id">) }];
  } else {
    const snap = await col.get();
    connections = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ShopifyConnectionRow, "id">) }));
  }

  if (options?.shop) {
    const shopNorm = options.shop.includes(".myshopify.com")
      ? options.shop.toLowerCase()
      : `${options.shop.toLowerCase()}.myshopify.com`;
    connections = connections.filter((c) => c.shop?.toLowerCase() === shopNorm);
  }

  if (connections.length === 0) {
    return { orders: [], connections: [] };
  }

  const allOrders: ShopifyNormalizedOrder[] = [];
  const syncedAt = new Date().toISOString();
  const persist = options?.persist !== false;

  for (const conn of connections) {
    const shop = conn.shop;
    if (!shop) continue;
    const ref = col.doc(conn.id);
    const accessToken = await getValidShopifyAccessToken(ref, conn as Record<string, unknown>, shop);
    const shopName = conn.shopName || shop.replace(".myshopify.com", "");

    const rawOrders = await fetchShopifyOrdersFromApi(shop, accessToken);
    let batch = db.batch();
    let batchCount = 0;

    for (const raw of rawOrders) {
      const normalized = normalizeShopifyOrder(raw, {
        shop,
        connectionId: conn.id,
        shopName,
      });
      normalized.syncedAt = syncedAt;
      allOrders.push(normalized);

      if (persist && normalized.id) {
        const doc = shopifyOrderToFirestoreDoc(normalized);
        batch.set(
          db.collection("users").doc(userId).collection("shopifyOrders").doc(normalized.id),
          doc,
          { merge: true }
        );
        batchCount += 1;
        if (batchCount >= 400) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }
    }

    if (persist && batchCount > 0) {
      await batch.commit();
    }

    await ref.set(
      {
        lastOrdersSyncedAt: syncedAt,
        lastSyncOrderCount: rawOrders.length,
        updatedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
      },
      { merge: true }
    );
  }

  allOrders.sort((a, b) => {
    const aMs = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bMs = b.createdAt ? Date.parse(b.createdAt) : 0;
    return bMs - aMs;
  });

  return {
    orders: allOrders,
    connections: connections.map((c) => ({
      id: c.id,
      shop: c.shop,
      shopName: c.shopName || c.shop.replace(".myshopify.com", ""),
    })),
  };
}

export { ShopifyReconnectRequired };
