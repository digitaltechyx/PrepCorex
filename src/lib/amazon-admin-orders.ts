import type { Firestore } from "firebase-admin/firestore";
import {
  amazonOrderFromFirestore,
  type AmazonNormalizedOrder,
} from "@/lib/amazon-order-normalize";
import { syncAmazonOrdersForUser } from "@/lib/amazon-order-sync";

export type AdminAmazonOrder = AmazonNormalizedOrder & {
  ownerUserId: string;
  ownerName: string;
  ownerClientId?: string | null;
  ownerEmail?: string | null;
};

type OwnerProfile = {
  uid: string;
  name: string;
  clientId?: string | null;
  email?: string | null;
};

async function listAmazonOwnerIds(db: Firestore, userId?: string): Promise<string[]> {
  if (userId && userId !== "all") return [userId];
  const snap = await db.collectionGroup("amazonConnections").get();
  const ids = new Set<string>();
  for (const doc of snap.docs) {
    const uid = doc.ref.parent.parent?.id;
    if (uid) ids.add(uid);
  }
  return Array.from(ids);
}

async function loadOwnerProfiles(db: Firestore, uids: string[]): Promise<Map<string, OwnerProfile>> {
  const map = new Map<string, OwnerProfile>();
  await Promise.all(
    uids.map(async (uid) => {
      const snap = await db.collection("users").doc(uid).get();
      const data = snap.data() ?? {};
      map.set(uid, {
        uid,
        name: String(data.name || data.displayName || data.email || uid),
        clientId: (data.clientId as string | undefined) ?? null,
        email: (data.email as string | undefined) ?? null,
      });
    })
  );
  return map;
}

function attachOwner(order: AmazonNormalizedOrder, owner: OwnerProfile): AdminAmazonOrder {
  return {
    ...order,
    ownerUserId: owner.uid,
    ownerName: owner.name,
    ownerClientId: owner.clientId ?? null,
    ownerEmail: owner.email ?? null,
  };
}

export async function loadAdminAmazonOrdersFromCache(
  db: Firestore,
  options?: { userId?: string; limit?: number }
): Promise<AdminAmazonOrder[]> {
  const limit = options?.limit ?? 500;
  const ownerIds = await listAmazonOwnerIds(db, options?.userId);
  if (ownerIds.length === 0) return [];

  const profiles = await loadOwnerProfiles(db, ownerIds);
  const snap = await db.collectionGroup("amazonOrders").limit(limit).get();

  const orders: AdminAmazonOrder[] = [];
  for (const doc of snap.docs) {
    const uid = doc.ref.parent.parent?.id;
    if (!uid || !ownerIds.includes(uid)) continue;
    const owner = profiles.get(uid);
    if (!owner) continue;
    orders.push(attachOwner(amazonOrderFromFirestore(doc.id, doc.data()), owner));
  }

  orders.sort((a, b) => {
    const aMs = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bMs = b.createdAt ? Date.parse(b.createdAt) : 0;
    return bMs - aMs;
  });

  return orders.slice(0, limit);
}

export async function syncAdminAmazonOrdersLive(
  db: Firestore,
  options?: { userId?: string }
): Promise<{ orders: AdminAmazonOrder[]; syncedUsers: number; errors: string[] }> {
  const ownerIds = await listAmazonOwnerIds(db, options?.userId);
  if (ownerIds.length === 0) {
    return { orders: [], syncedUsers: 0, errors: [] };
  }

  const profiles = await loadOwnerProfiles(db, ownerIds);
  const allOrders: AdminAmazonOrder[] = [];
  const errors: string[] = [];
  let syncedUsers = 0;

  for (const uid of ownerIds) {
    try {
      const result = await syncAmazonOrdersForUser(db, uid, { persist: true });
      syncedUsers += 1;
      const owner = profiles.get(uid);
      if (!owner) continue;
      for (const order of result.orders) {
        allOrders.push(attachOwner(order, owner));
      }
    } catch (err) {
      const owner = profiles.get(uid);
      const label = owner?.name || uid;
      errors.push(`${label}: ${err instanceof Error ? err.message : "Sync failed"}`);
    }
  }

  allOrders.sort((a, b) => {
    const aMs = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bMs = b.createdAt ? Date.parse(b.createdAt) : 0;
    return bMs - aMs;
  });

  return { orders: allOrders, syncedUsers, errors };
}
