import type { Firestore } from "firebase-admin/firestore";
import {
  amazonOrderToFirestoreDoc,
  type AmazonNormalizedOrder,
} from "@/lib/amazon-order-normalize";
import {
  fetchAmazonOrdersFromApi,
  getAmazonConnectionTokensOrThrow,
  mapRawAmazonOrders,
  resolveAmazonMarketplaceIds,
} from "@/lib/amazon-sp-api-orders";

export type AmazonConnectionRow = {
  id: string;
  storeName?: string;
  sellingPartnerId?: string;
  marketplaces?: Array<{ id: string | null; name?: string | null; countryCode?: string | null }>;
};

const LOOKBACK_DAYS = 30;

export async function syncAmazonOrdersForUser(
  db: Firestore,
  userId: string,
  options?: { connectionId?: string; persist?: boolean }
): Promise<{
  orders: AmazonNormalizedOrder[];
  connections: Array<{ id: string; storeName: string; sellingPartnerId: string | null }>;
}> {
  const col = db.collection("users").doc(userId).collection("amazonConnections");
  let connections: AmazonConnectionRow[] = [];

  if (options?.connectionId) {
    const snap = await col.doc(options.connectionId).get();
    if (!snap.exists) throw new Error("Amazon connection not found");
    connections = [{ id: snap.id, ...(snap.data() as Omit<AmazonConnectionRow, "id">) }];
  } else {
    const snap = await col.get();
    connections = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AmazonConnectionRow, "id">) }));
  }

  if (connections.length === 0) {
    return { orders: [], connections: [] };
  }

  const allOrders: AmazonNormalizedOrder[] = [];
  const syncedAt = new Date().toISOString();
  const persist = options?.persist !== false;
  const connectionSummaries: Array<{
    id: string;
    storeName: string;
    sellingPartnerId: string | null;
  }> = [];

  for (const conn of connections) {
    const tokens = await getAmazonConnectionTokensOrThrow(userId, conn.id);
    const storeName =
      conn.storeName ||
      tokens.marketplaces.map((m) => m.storeName || m.name).find(Boolean) ||
      "Amazon";
    const sellingPartnerId =
      conn.sellingPartnerId || tokens.sellingPartnerId || null;
    const marketplaceIds = resolveAmazonMarketplaceIds(
      tokens.marketplaces.length > 0
        ? tokens.marketplaces
        : (conn.marketplaces ?? []).map((m) => ({
            id: m.id,
            name: m.name ?? null,
            countryCode: m.countryCode ?? null,
            storeName: null,
          }))
    );

    connectionSummaries.push({ id: conn.id, storeName, sellingPartnerId });

    const rawOrders = await fetchAmazonOrdersFromApi({
      accessToken: tokens.accessToken,
      marketplaceIds,
      lookbackDays: LOOKBACK_DAYS,
      fetchAddresses: true,
    });

    const normalized = mapRawAmazonOrders(rawOrders, {
      connectionId: conn.id,
      storeName,
      sellingPartnerId,
    }).map((order) => ({ ...order, syncedAt }));

    allOrders.push(...normalized);

    if (persist) {
      let batch = db.batch();
      let batchCount = 0;
      for (const order of normalized) {
        if (!order.id) continue;
        batch.set(
          db.collection("users").doc(userId).collection("amazonOrders").doc(order.id),
          amazonOrderToFirestoreDoc(order),
          { merge: true }
        );
        batchCount += 1;
        if (batchCount >= 400) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }
      if (batchCount > 0) await batch.commit();

      await col.doc(conn.id).set(
        {
          lastOrdersSyncedAt: syncedAt,
          lastSyncOrderCount: normalized.length,
        },
        { merge: true }
      );
    }
  }

  allOrders.sort((a, b) => {
    const aMs = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bMs = b.createdAt ? Date.parse(b.createdAt) : 0;
    return bMs - aMs;
  });

  return { orders: allOrders, connections: connectionSummaries };
}
