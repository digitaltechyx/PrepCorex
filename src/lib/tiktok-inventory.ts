import { parseTikTokError, tikTokApiRequest } from "@/lib/tiktok-api";

type WarehouseInventory = {
  warehouse_id?: string;
  available_quantity?: number;
  available_stock?: number;
  quantity?: number;
};

type InventorySku = {
  id?: string;
  seller_sku?: string;
  total_available_quantity?: number;
  warehouse_inventory?: WarehouseInventory[];
  stock_infos?: Array<{ available_stock?: number; available_quantity?: number }>;
};

type InventoryProduct = {
  product_id?: string;
  skus?: InventorySku[];
};

/** Sum stock fields from product-search / product-detail SKU payloads (often incomplete). */
export function quantityFromTikTokSkuStockInfos(
  sku: {
    stock_infos?: Array<{ available_stock?: number; available_quantity?: number }>;
    inventory?: WarehouseInventory[];
  } | null | undefined
): number | null {
  if (!sku) return null;
  if (Array.isArray(sku.stock_infos) && sku.stock_infos.length > 0) {
    return sku.stock_infos.reduce(
      (sum, si) => sum + (si.available_stock ?? si.available_quantity ?? 0),
      0
    );
  }
  if (Array.isArray(sku.inventory) && sku.inventory.length > 0) {
    return sku.inventory.reduce(
      (sum, wi) => sum + (wi.available_quantity ?? wi.available_stock ?? wi.quantity ?? 0),
      0
    );
  }
  return null;
}

/**
 * Authoritative SKU quantities via POST /product/202309/inventory/search.
 * Returns map of skuId -> total available quantity.
 */
export async function fetchTikTokSkuQuantities(options: {
  accessToken: string;
  shopCipher?: string | null;
  productIds?: string[];
  skuIds?: string[];
}): Promise<Record<string, number>> {
  const productIds = [...new Set((options.productIds ?? []).filter(Boolean))];
  const skuIds = [...new Set((options.skuIds ?? []).filter(Boolean))];
  if (!productIds.length && !skuIds.length) return {};

  const qtyBySku: Record<string, number> = {};

  // API accepts batches; keep chunks small for safety
  const chunk = <T,>(arr: T[], size: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  const bodies: Array<Record<string, unknown>> = [];
  if (productIds.length) {
    for (const ids of chunk(productIds, 20)) {
      bodies.push({ product_ids: ids });
    }
  } else {
    for (const ids of chunk(skuIds, 50)) {
      bodies.push({ sku_ids: ids });
    }
  }

  for (const body of bodies) {
    const res = await tikTokApiRequest<{ inventory?: InventoryProduct[] }>({
      method: "POST",
      path: "/product/202309/inventory/search",
      accessToken: options.accessToken,
      shopCipher: options.shopCipher,
      body,
    });
    if (res.code !== 0) {
      console.warn("[tiktok-inventory] search failed", parseTikTokError(res));
      continue;
    }
    for (const product of res.data?.inventory ?? []) {
      for (const sku of product.skus ?? []) {
        const id = String(sku.id ?? "");
        if (!id) continue;
        if (typeof sku.total_available_quantity === "number") {
          qtyBySku[id] = Math.max(0, Math.floor(sku.total_available_quantity));
          continue;
        }
        const fromWarehouses = (sku.warehouse_inventory ?? []).reduce(
          (sum, wi) => sum + (wi.available_quantity ?? wi.available_stock ?? wi.quantity ?? 0),
          0
        );
        const fromStockInfos = quantityFromTikTokSkuStockInfos(sku);
        qtyBySku[id] = Math.max(0, Math.floor(fromWarehouses || fromStockInfos || 0));
      }
    }
  }

  return qtyBySku;
}
