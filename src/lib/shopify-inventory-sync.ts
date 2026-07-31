/**
 * Shared Shopify inventory quantity setter (PrepCorex → Shopify).
 */

import { shopifyAdminRestUrl } from "@/lib/shopify-api";

/** Payload for client → `/api/shopify/sync-inventory` after PrepCorex qty changes. */
export type ShopifyInventoryPushHint = {
  userId: string;
  shop: string;
  shopifyVariantId: string;
  shopifyInventoryItemId?: string | null;
  newQuantity: number;
};

/** Push PrepCorex quantities to Shopify (staff or owner bearer token). */
export async function pushShopifyInventoryHints(
  token: string,
  hints: ShopifyInventoryPushHint[]
): Promise<{ ok: number; errors: string[] }> {
  const unique = new Map<string, ShopifyInventoryPushHint>();
  for (const h of hints) {
    if (!h.userId || !h.shop || !h.shopifyVariantId) continue;
    const key = `${h.userId}|${h.shop}|${h.shopifyVariantId}`;
    unique.set(key, h);
  }
  let ok = 0;
  const errors: string[] = [];
  for (const h of unique.values()) {
    try {
      const res = await fetch("/api/shopify/sync-inventory", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId: h.userId,
          shop: h.shop,
          shopifyVariantId: h.shopifyVariantId,
          shopifyInventoryItemId: h.shopifyInventoryItemId ?? undefined,
          newQuantity: h.newQuantity,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        errors.push(typeof data.error === "string" ? data.error : "Shopify sync failed");
        continue;
      }
      ok += 1;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "Shopify sync failed");
    }
  }
  return { ok, errors };
}

export async function setShopifyInventoryAvailable(input: {
  shop: string;
  accessToken: string;
  shopifyVariantId: string;
  shopifyInventoryItemId?: string | null;
  newQuantity: number;
}): Promise<{ inventoryItemId: string; available: number }> {
  let shopNorm = input.shop.trim().toLowerCase();
  if (!shopNorm.includes(".myshopify.com")) {
    shopNorm = `${shopNorm}.myshopify.com`;
  }
  const newQuantity = Math.max(0, Math.floor(input.newQuantity));

  let inventoryItemId =
    input.shopifyInventoryItemId != null && String(input.shopifyInventoryItemId).trim()
      ? String(input.shopifyInventoryItemId).trim()
      : undefined;

  if (!inventoryItemId) {
    const variantRes = await fetch(
      shopifyAdminRestUrl(shopNorm, `/variants/${input.shopifyVariantId}.json`),
      {
        headers: {
          "X-Shopify-Access-Token": input.accessToken,
          "Content-Type": "application/json",
        },
      }
    );
    if (!variantRes.ok) {
      throw new Error("Could not get variant from Shopify");
    }
    const variantData = (await variantRes.json()) as {
      variant?: { inventory_item_id?: number };
    };
    inventoryItemId =
      variantData.variant?.inventory_item_id != null
        ? String(variantData.variant.inventory_item_id)
        : undefined;
  }
  if (!inventoryItemId) {
    throw new Error("Variant has no inventory item");
  }

  const locRes = await fetch(`${shopifyAdminRestUrl(shopNorm, "/locations.json")}?limit=250`, {
    headers: {
      "X-Shopify-Access-Token": input.accessToken,
      "Content-Type": "application/json",
    },
  });
  if (!locRes.ok) {
    const hint =
      locRes.status === 403
        ? " Add read_locations scope in your Shopify app and re-connect the store."
        : "";
    throw new Error(`Could not get location from Shopify (${locRes.status})${hint}`);
  }
  const locData = (await locRes.json()) as { locations?: { id: number }[] };
  const locations = locData.locations ?? [];
  if (locations.length === 0) {
    throw new Error("No location on store");
  }

  const headers = {
    "X-Shopify-Access-Token": input.accessToken,
    "Content-Type": "application/json",
  };
  for (let i = 0; i < locations.length; i++) {
    const available = i === 0 ? newQuantity : 0;
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
      const errText = await setRes.text();
      throw new Error(
        `Shopify rejected inventory update (${setRes.status}). Ensure app has write_inventory scope. ${errText.slice(0, 120)}`
      );
    }
  }

  return { inventoryItemId, available: newQuantity };
}

export function isShopifyStaffCaller(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  const role = data.role as string | undefined;
  const roles = data.roles as string[] | undefined;
  if (role === "admin" || role === "sub_admin" || role === "warehouse_ops") return true;
  if (Array.isArray(roles)) {
    return (
      roles.includes("admin") ||
      roles.includes("sub_admin") ||
      roles.includes("warehouse_ops")
    );
  }
  return false;
}
