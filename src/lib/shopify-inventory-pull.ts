/**
 * Shopify → PrepCorex inventory quantity pull helpers (webhooks + repair).
 */

import type { Firestore } from "firebase-admin/firestore";
import { shopifyAdminRestUrl } from "@/lib/shopify-api";

export function shopifyShopKey(shop: string): string {
  let shopNorm = shop.trim().toLowerCase();
  if (!shopNorm.includes(".myshopify.com")) shopNorm = `${shopNorm}.myshopify.com`;
  return shopNorm.replace(/\./g, "_");
}

export function normalizeShopifyShop(shop: string): string {
  let shopNorm = shop.trim().toLowerCase();
  if (!shopNorm.includes(".myshopify.com")) shopNorm = `${shopNorm}.myshopify.com`;
  return shopNorm;
}

/** Resolve PrepCorex inventory doc paths for a Shopify inventory_item_id. */
export async function resolveShopifyInventoryPaths(
  db: Firestore,
  shop: string,
  inventoryItemId: string,
  preferredUserId?: string | null
): Promise<Array<{ path: string; userId: string }>> {
  const shopNorm = normalizeShopifyShop(shop);
  const shopKey = shopifyShopKey(shopNorm);
  const idStr = String(inventoryItemId).trim();
  if (!idStr) return [];

  const lookupRef = db.collection("shopifyInventoryLookup");
  const lookupIds = [`${shopKey}_${idStr}`];
  const rounded = String(Number(idStr));
  if (rounded !== idStr && Number.isFinite(Number(idStr))) {
    lookupIds.push(`${shopKey}_${rounded}`);
  }

  const found: Array<{ path: string; userId: string }> = [];
  const seen = new Set<string>();

  for (const lookupId of lookupIds) {
    const snap = await lookupRef.doc(lookupId).get();
    if (!snap.exists) continue;
    const data = snap.data() || {};
    const path = typeof data.inventoryPath === "string" ? data.inventoryPath.trim() : "";
    const userId = typeof data.userId === "string" ? data.userId.trim() : "";
    if (path && !seen.has(path)) {
      seen.add(path);
      found.push({ path, userId: userId || preferredUserId || "" });
    }
  }
  if (found.length > 0) return found;

  // Fallback: collection-group query (repairs missing lookup docs).
  try {
    let q = db
      .collectionGroup("inventory")
      .where("source", "==", "shopify")
      .where("shop", "==", shopNorm)
      .where("shopifyInventoryItemId", "==", idStr)
      .limit(10);
    let snap = await q.get();
    if (snap.empty && rounded !== idStr) {
      snap = await db
        .collectionGroup("inventory")
        .where("source", "==", "shopify")
        .where("shop", "==", shopNorm)
        .where("shopifyInventoryItemId", "==", rounded)
        .limit(10)
        .get();
    }

    for (const doc of snap.docs) {
      const path = doc.ref.path;
      if (seen.has(path)) continue;
      const userId = path.split("/")[1] || preferredUserId || "";
      if (preferredUserId && userId && userId !== preferredUserId) continue;
      seen.add(path);
      found.push({ path, userId });
      // Repair lookup for next webhook
      const lookupId = `${shopKey}_${idStr}`;
      await lookupRef.doc(lookupId).set(
        {
          userId,
          inventoryPath: path,
          shop: shopNorm,
          shopifyInventoryItemId: idStr,
        },
        { merge: true }
      );
    }
  } catch (err) {
    console.warn("[shopify-inventory-pull] collectionGroup fallback failed", err);
  }

  // Deterministic doc id fallback for known user
  if (found.length === 0 && preferredUserId) {
    // Without variant id we cannot build shopify_{shop}_{variantId}; try inventoryItemId field scan under user.
    try {
      const userInv = await db
        .collection("users")
        .doc(preferredUserId)
        .collection("inventory")
        .where("source", "==", "shopify")
        .where("shop", "==", shopNorm)
        .where("shopifyInventoryItemId", "==", idStr)
        .limit(5)
        .get();
      for (const doc of userInv.docs) {
        const path = doc.ref.path;
        if (seen.has(path)) continue;
        seen.add(path);
        found.push({ path, userId: preferredUserId });
        await lookupRef.doc(`${shopKey}_${idStr}`).set(
          {
            userId: preferredUserId,
            inventoryPath: path,
            shop: shopNorm,
            shopifyInventoryItemId: idStr,
          },
          { merge: true }
        );
      }
    } catch (err) {
      console.warn("[shopify-inventory-pull] user inventory fallback failed", err);
    }
  }

  return found;
}

export async function applyShopifyAvailableToPaths(
  db: Firestore,
  paths: Array<{ path: string }>,
  available: number
): Promise<number> {
  const qty = Math.max(0, Math.floor(available));
  const status = qty > 0 ? "In Stock" : "Out of Stock";
  let updated = 0;
  for (const { path } of paths) {
    try {
      await db.doc(path).update({ quantity: qty, status });
      updated += 1;
    } catch (err) {
      console.warn("[shopify-inventory-pull] update failed", path, err);
    }
  }
  return updated;
}

/** Pull live Shopify inventory_quantity for specific variant ids into PrepCorex docs. */
export async function pullShopifyVariantQuantities(input: {
  db: Firestore;
  userId: string;
  shop: string;
  accessToken: string;
  variantIds: string[];
}): Promise<{ updated: number }> {
  const shopNorm = normalizeShopifyShop(input.shop);
  const shopKey = shopifyShopKey(shopNorm);
  const variantIds = [...new Set(input.variantIds.map((v) => String(v || "").trim()).filter(Boolean))];
  if (variantIds.length === 0) return { updated: 0 };

  let updated = 0;
  for (const variantId of variantIds) {
    try {
      const variantRes = await fetch(shopifyAdminRestUrl(shopNorm, `/variants/${variantId}.json`), {
        headers: {
          "X-Shopify-Access-Token": input.accessToken,
          "Content-Type": "application/json",
        },
      });
      if (!variantRes.ok) continue;
      const variantData = (await variantRes.json()) as {
        variant?: {
          id?: number;
          inventory_quantity?: number;
          inventory_item_id?: number;
          product_id?: number;
        };
      };
      const variant = variantData.variant;
      if (!variant) continue;
      const qty =
        typeof variant.inventory_quantity === "number"
          ? Math.max(0, Math.floor(variant.inventory_quantity))
          : null;
      if (qty == null) continue;
      const inventoryItemId =
        variant.inventory_item_id != null ? String(variant.inventory_item_id) : null;
      const docId = `shopify_${shopKey}_${variantId}`;
      const invRef = input.db.collection("users").doc(input.userId).collection("inventory").doc(docId);
      const snap = await invRef.get();
      if (!snap.exists) continue;
      const status = qty > 0 ? "In Stock" : "Out of Stock";
      const patch: Record<string, unknown> = { quantity: qty, status };
      if (inventoryItemId) patch.shopifyInventoryItemId = inventoryItemId;
      await invRef.update(patch);
      updated += 1;

      if (inventoryItemId) {
        await input.db
          .collection("shopifyInventoryLookup")
          .doc(`${shopKey}_${inventoryItemId}`)
          .set(
            {
              userId: input.userId,
              inventoryPath: invRef.path,
              shop: shopNorm,
              shopifyInventoryItemId: inventoryItemId,
            },
            { merge: true }
          );
      }
    } catch (err) {
      console.warn("[shopify-inventory-pull] variant pull failed", variantId, err);
    }
  }
  return { updated };
}
