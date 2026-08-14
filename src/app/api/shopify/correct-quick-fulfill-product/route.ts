import { NextRequest, NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { requireAdmin } from "@/lib/api-admin-auth";
import { correctShopifyQuickFulfillWarehouseProduct } from "@/lib/shopify-quick-fulfill-correct";
import { getShopifyAccessTokenForUserShop } from "@/lib/shopify-access-token";
import { shopifyAdminRestUrl } from "@/lib/shopify-api";

export const dynamic = "force-dynamic";

/**
 * POST: Correct warehouse product on a Shopify Quick Fulfill shipped entry.
 * Body: { userId, shippedId, lineIndex, newInventoryId }
 * Does not change Shopify order fulfillment / tracking.
 */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || "").trim();
  const shippedId = String(body.shippedId || "").trim();
  const newInventoryId = String(body.newInventoryId || body.inventoryId || "").trim();
  const lineIndex = Math.floor(Number(body.lineIndex ?? 0));

  if (!userId || !shippedId || !newInventoryId) {
    return NextResponse.json(
      { error: "userId, shippedId, and newInventoryId are required." },
      { status: 400 }
    );
  }

  try {
    const db = adminDb();
    const result = await correctShopifyQuickFulfillWarehouseProduct({
      db,
      ownerUserId: userId,
      shippedId,
      lineIndex,
      newInventoryId,
      actorUid: admin.uid,
      actorName: admin.name || null,
    });

    const syncErrors: string[] = [];
    for (const hint of result.shopifySyncHints) {
      try {
        await syncShopifyAbsoluteQty({
          db,
          userId,
          shop: hint.shop,
          shopifyVariantId: hint.shopifyVariantId,
          shopifyInventoryItemId: hint.shopifyInventoryItemId,
          newQuantity: hint.newQuantity,
        });
      } catch (err) {
        syncErrors.push(err instanceof Error ? err.message : "Shopify inventory sync failed");
      }
    }

    return NextResponse.json({
      ok: true,
      ...result,
      syncErrors: syncErrors.length ? syncErrors : undefined,
    });
  } catch (err: unknown) {
    console.error("[shopify/correct-quick-fulfill-product]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not correct warehouse product." },
      { status: 400 }
    );
  }
}

async function syncShopifyAbsoluteQty(input: {
  db: Firestore;
  userId: string;
  shop: string;
  shopifyVariantId: string;
  shopifyInventoryItemId?: string;
  newQuantity: number;
}) {
  let shopNorm = input.shop.toLowerCase();
  if (!shopNorm.includes(".myshopify.com")) {
    shopNorm = `${shopNorm}.myshopify.com`;
  }
  const accessToken = await getShopifyAccessTokenForUserShop(input.db, input.userId, shopNorm);

  let inventoryItemId = input.shopifyInventoryItemId;
  if (!inventoryItemId) {
    const variantRes = await fetch(
      shopifyAdminRestUrl(shopNorm, `/variants/${input.shopifyVariantId}.json`),
      {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      }
    );
    if (!variantRes.ok) throw new Error("Could not get variant from Shopify");
    const variantData = (await variantRes.json()) as {
      variant?: { inventory_item_id?: number };
    };
    inventoryItemId =
      variantData.variant?.inventory_item_id != null
        ? String(variantData.variant.inventory_item_id)
        : undefined;
  }
  if (!inventoryItemId) throw new Error("Variant has no inventory item");

  const locRes = await fetch(`${shopifyAdminRestUrl(shopNorm, "/locations.json")}?limit=250`, {
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
  });
  if (!locRes.ok) throw new Error(`Could not get Shopify locations (${locRes.status})`);
  const locData = (await locRes.json()) as { locations?: { id: number }[] };
  const locations = locData.locations ?? [];
  if (locations.length === 0) throw new Error("No location on store");

  const headers = {
    "X-Shopify-Access-Token": accessToken,
    "Content-Type": "application/json",
  };
  for (let i = 0; i < locations.length; i++) {
    const available = i === 0 ? Math.max(0, Math.floor(input.newQuantity)) : 0;
    const setRes = await fetch(shopifyAdminRestUrl(shopNorm, "/inventory_levels/set.json"), {
      method: "POST",
      headers,
      body: JSON.stringify({
        location_id: locations[i].id,
        inventory_item_id: Number(inventoryItemId),
        available,
      }),
    });
    if (!setRes.ok) {
      const text = await setRes.text();
      throw new Error(`Shopify inventory set failed (${setRes.status}): ${text.slice(0, 160)}`);
    }
  }
}
