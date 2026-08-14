/**
 * Shopify Quick Fulfill: deduct warehouse inventory, create shipped entry,
 * fulfill the Shopify order with tracking — no pick/pack/dispatch.
 */

import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { shopifyAdminRestUrl } from "@/lib/shopify-api";
import { getShopifyAccessTokenForUserShop } from "@/lib/shopify-access-token";
import { deductWarehouseStockForQuickFulfill } from "@/lib/warehouse-quick-fulfill-deduct";
import { resolveShopifyQuickFulfillDtcUnitPrice } from "@/lib/shopify-quick-fulfill-pricing";
import { DTC_FBM_SERVICE } from "@/types";

export type QuickFulfillLineInput = {
  /** Shopify order line item id (string). */
  shopifyLineItemId: string;
  /** PrepCorex warehouse inventory doc id. */
  inventoryId: string;
  /** Units to ship from warehouse. */
  quantity: number;
  /** Shopify order line title (for shipped details). */
  shopifyLineTitle?: string | null;
  /** Shopify order line SKU (for shipped details). */
  shopifyLineSku?: string | null;
};

export type ShopifyInventorySyncHint = {
  shop: string;
  shopifyVariantId: string;
  shopifyInventoryItemId?: string;
  newQuantity: number;
};

export type QuickFulfillResult = {
  shippedId: string;
  alreadyProcessed: boolean;
  shopifySyncHints: ShopifyInventorySyncHint[];
  warehouseDeducted: number;
  warehouseShortfall: number;
};

function normalizeShop(shop: string): string {
  let shopNorm = shop.trim().toLowerCase();
  if (!shopNorm.includes(".myshopify.com")) {
    shopNorm = `${shopNorm}.myshopify.com`;
  }
  return shopNorm;
}

function quickFulfillLogId(shop: string, orderId: string): string {
  return `${shop.replace(/[^a-z0-9]+/gi, "_")}_${orderId}`;
}

function shipToFromAddress(addr: Record<string, unknown> | null | undefined): string {
  if (!addr) return "Shopify customer";
  const parts = [
    [addr.first_name, addr.last_name].filter(Boolean).join(" ") || addr.name,
    addr.company,
    addr.address1,
    addr.address2,
    [addr.city, addr.province || addr.province_code, addr.zip || addr.postal_code]
      .filter(Boolean)
      .join(", "),
    addr.country || addr.country_code,
  ]
    .map((p) => (p == null ? "" : String(p).trim()))
    .filter(Boolean);
  return parts.join(", ") || "Shopify customer";
}

async function createShopifyFulfillment(input: {
  accessToken: string;
  shop: string;
  orderId: string;
  trackingNumber?: string;
  trackingCompany?: string;
  notifyCustomer: boolean;
}): Promise<"created" | "already_fulfilled"> {
  const foRes = await fetch(
    shopifyAdminRestUrl(input.shop, `/orders/${input.orderId}/fulfillment_orders.json`),
    {
      headers: {
        "X-Shopify-Access-Token": input.accessToken,
        "Content-Type": "application/json",
      },
    }
  );
  if (!foRes.ok) {
    const errText = await foRes.text();
    throw new Error(`Failed to load fulfillment orders (${foRes.status}): ${errText.slice(0, 200)}`);
  }

  const foData = (await foRes.json()) as {
    fulfillment_orders?: Array<{
      id: number;
      status: string;
      supported_actions?: string[];
      line_items?: Array<{ id: number; fulfillable_quantity: number }>;
    }>;
  };
  const fulfillmentOrders = foData.fulfillment_orders ?? [];
  const openOrders = fulfillmentOrders.filter(
    (fo) =>
      (fo.status === "open" || fo.status === "scheduled") &&
      fo.supported_actions?.includes("create_fulfillment")
  );

  if (openOrders.length === 0) {
    const anyFulfilled = fulfillmentOrders.some(
      (fo) => fo.status === "closed" || fo.status === "success"
    );
    if (anyFulfilled || fulfillmentOrders.length > 0) {
      return "already_fulfilled";
    }
    throw new Error("No fulfillable Shopify fulfillment orders");
  }

  const lineItemsByFulfillmentOrder: Array<{
    fulfillment_order_id: number;
    fulfillment_order_line_items: Array<{ id: number; quantity: number }>;
  }> = [];

  for (const fo of openOrders) {
    const items = (fo.line_items ?? [])
      .filter((li) => li.fulfillable_quantity > 0)
      .map((li) => ({ id: li.id, quantity: li.fulfillable_quantity }));
    if (items.length > 0) {
      lineItemsByFulfillmentOrder.push({
        fulfillment_order_id: fo.id,
        fulfillment_order_line_items: items,
      });
    }
  }

  if (lineItemsByFulfillmentOrder.length === 0) {
    return "already_fulfilled";
  }

  const fulfillmentPayload: Record<string, unknown> = {
    line_items_by_fulfillment_order: lineItemsByFulfillmentOrder,
    notify_customer: input.notifyCustomer,
  };
  if (input.trackingNumber || input.trackingCompany) {
    fulfillmentPayload.tracking_info = {
      ...(input.trackingNumber ? { number: input.trackingNumber } : {}),
      ...(input.trackingCompany ? { company: input.trackingCompany } : {}),
    };
  }

  const createRes = await fetch(shopifyAdminRestUrl(input.shop, "/fulfillments.json"), {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": input.accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fulfillment: fulfillmentPayload }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    if (/already|fulfilled|closed/i.test(errText)) {
      return "already_fulfilled";
    }
    throw new Error(`Shopify fulfillment failed (${createRes.status}): ${errText.slice(0, 240)}`);
  }

  return "created";
}

export async function executeShopifyQuickFulfill(input: {
  db: Firestore;
  ownerUserId: string;
  shop: string;
  orderId: string;
  orderName?: string | null;
  orderNumber?: number | null;
  shipTo?: string | null;
  lines: QuickFulfillLineInput[];
  trackingNumber?: string;
  trackingCompany?: string;
  notifyCustomer?: boolean;
  fulfilledBy: string;
  /** PrepCorex Buy Labels price in USD to record on shipped + invoice. */
  labelPrice?: number | null;
  labelPurchaseId?: string | null;
}): Promise<QuickFulfillResult> {
  const shop = normalizeShop(input.shop);
  const orderId = String(input.orderId || "").trim();
  const ownerUserId = String(input.ownerUserId || "").trim();
  if (!shop || !orderId || !ownerUserId) {
    throw new Error("Missing shop, orderId, or ownerUserId");
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new Error("Select at least one warehouse product to fulfill");
  }

  const logId = quickFulfillLogId(shop, orderId);
  const logRef = input.db
    .collection("users")
    .doc(ownerUserId)
    .collection("shopifyQuickFulfillLogs")
    .doc(logId);

  const existingLog = await logRef.get();
  if (existingLog.exists) {
    const data = existingLog.data() || {};
    return {
      shippedId: String(data.shippedId || ""),
      alreadyProcessed: true,
      shopifySyncHints: [],
      warehouseDeducted: Number(data.warehouseDeducted) || 0,
      warehouseShortfall: Number(data.warehouseShortfall) || 0,
    };
  }

  // Aggregate qty per inventory id (multiple Shopify lines can map to same warehouse SKU)
  const qtyByInventoryId = new Map<string, number>();
  const shopifyMetaByInventoryId = new Map<
    string,
    { shopifyLineTitle?: string; shopifyLineSku?: string }
  >();
  for (const line of input.lines) {
    const inventoryId = String(line.inventoryId || "").trim();
    const quantity = Math.floor(Number(line.quantity) || 0);
    if (!inventoryId) throw new Error("Each line must select a warehouse product");
    if (quantity <= 0) throw new Error("Quantity must be greater than 0");
    qtyByInventoryId.set(inventoryId, (qtyByInventoryId.get(inventoryId) || 0) + quantity);
    const title = String(line.shopifyLineTitle || "").trim();
    const lineSku = String(line.shopifyLineSku || "").trim();
    if (title || lineSku) {
      const prev = shopifyMetaByInventoryId.get(inventoryId);
      shopifyMetaByInventoryId.set(inventoryId, {
        shopifyLineTitle: prev?.shopifyLineTitle || title || undefined,
        shopifyLineSku: prev?.shopifyLineSku || lineSku || undefined,
      });
    }
  }

  // Pre-validate inventory exists and has stock
  const inventorySnaps = await Promise.all(
    Array.from(qtyByInventoryId.keys()).map(async (inventoryId) => {
      const ref = input.db.collection("users").doc(ownerUserId).collection("inventory").doc(inventoryId);
      const snap = await ref.get();
      if (!snap.exists) throw new Error(`Warehouse product not found: ${inventoryId}`);
      const data = snap.data() || {};
      const available = Math.max(0, Math.floor(Number(data.quantity) || 0));
      const needed = qtyByInventoryId.get(inventoryId) || 0;
      if (available < needed) {
        throw new Error(
          `Not enough stock for ${data.productName || inventoryId}. Available: ${available}, Requested: ${needed}.`
        );
      }
      return { inventoryId, ref, data, available, needed };
    })
  );

  const accessToken = await getShopifyAccessTokenForUserShop(input.db, ownerUserId, shop);
  await createShopifyFulfillment({
    accessToken,
    shop,
    orderId,
    trackingNumber: input.trackingNumber,
    trackingCompany: input.trackingCompany,
    notifyCustomer: input.notifyCustomer === true,
  });

  const orderName =
    String(input.orderName || "").trim() ||
    (input.orderNumber != null ? `#${input.orderNumber}` : `#${orderId}`);
  const trackingParts = [input.trackingCompany, input.trackingNumber].filter(Boolean).join(" ");
  const labelPrice =
    input.labelPrice != null && Number.isFinite(Number(input.labelPrice))
      ? Math.max(0, Number(Number(input.labelPrice).toFixed(2)))
      : 0;
  const labelPurchaseId =
    typeof input.labelPurchaseId === "string" && input.labelPurchaseId.trim()
      ? input.labelPurchaseId.trim()
      : null;
  const remarks = [
    `Shipped for Shopify order ${orderName}`,
    `Store: ${shop.replace(/\.myshopify\.com$/i, "")}`,
    trackingParts ? `Tracking: ${trackingParts}` : null,
    labelPrice > 0 ? `Label price: $${labelPrice.toFixed(2)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const shippedRef = input.db.collection("users").doc(ownerUserId).collection("shipped").doc();
  const shopifySyncHints: ShopifyInventorySyncHint[] = [];
  const now = FieldValue.serverTimestamp();

  const provisionalUnits = Array.from(qtyByInventoryId.values()).reduce((a, b) => a + b, 0);
  const dtcUnitPrice = await resolveShopifyQuickFulfillDtcUnitPrice(
    input.db,
    ownerUserId,
    provisionalUnits
  );

  await input.db.runTransaction(async (tx) => {
    const logSnap = await tx.get(logRef);
    if (logSnap.exists) return;

    // Re-read inventory inside transaction
    const fresh = [];
    for (const row of inventorySnaps) {
      const snap = await tx.get(row.ref);
      if (!snap.exists) throw new Error(`Warehouse product not found: ${row.inventoryId}`);
      const data = snap.data() || {};
      const available = Math.max(0, Math.floor(Number(data.quantity) || 0));
      if (available < row.needed) {
        throw new Error(
          `Not enough stock for ${data.productName || row.inventoryId}. Available: ${available}, Requested: ${row.needed}.`
        );
      }
      fresh.push({ ...row, data, available });
    }

    const orderSnap = await tx.get(
      input.db.collection("users").doc(ownerUserId).collection("shopifyOrders").doc(orderId)
    );
    const orderData = orderSnap.exists ? (orderSnap.data() as Record<string, unknown>) : null;
    const shipTo =
      String(input.shipTo || "").trim() ||
      shipToFromAddress(
        (orderData?.shipping_address as Record<string, unknown> | undefined) ||
          (orderData?.shippingAddress as Record<string, unknown> | undefined) ||
          null
      );

    const items: Array<Record<string, unknown>> = [];
    let totalUnits = 0;

    for (const row of fresh) {
      const currentQty = row.available;
      const shipQty = row.needed;
      const newQuantity = currentQty - shipQty;
      const newStatus = newQuantity > 0 ? "In Stock" : "Out of Stock";
      const productName = String(row.data.productName || "Product");
      const sku = row.data.sku != null ? String(row.data.sku).trim() : "";
      const retailIdentifier =
        row.data.retailIdentifier != null ? String(row.data.retailIdentifier).trim() : "";
      const shopifyMeta = shopifyMetaByInventoryId.get(row.inventoryId);

      tx.update(row.ref, {
        quantity: newQuantity,
        status: newStatus,
        updatedAt: now,
      });

      const changeLogRef = input.db
        .collection("users")
        .doc(ownerUserId)
        .collection("inventoryChangeLogs")
        .doc(`shopify_qf_${orderId}_${row.inventoryId}`);
      tx.set(changeLogRef, {
        inventoryId: row.inventoryId,
        productName,
        sku: sku || null,
        eventType: "shopify_quick_fulfill",
        qtyBefore: currentQty,
        qtyAfter: newQuantity,
        qtyChange: -shipQty,
        shopifyOrderId: orderId,
        shopifyOrderName: orderName,
        shop,
        shippedId: shippedRef.id,
        details: `Shopify quick fulfill · ${orderName} · ${shop.replace(/\.myshopify\.com$/i, "")}`,
        at: now,
      });

      items.push({
        productId: row.inventoryId,
        productName,
        boxesShipped: shipQty,
        shippedQty: shipQty,
        packOf: 1,
        unitPrice: dtcUnitPrice,
        remainingQty: newQuantity,
        sku: sku || null,
        retailIdentifier: retailIdentifier || null,
        shopifyLineTitle: shopifyMeta?.shopifyLineTitle || null,
        shopifyLineSku: shopifyMeta?.shopifyLineSku || null,
      });
      totalUnits += shipQty;

      if (
        row.data.source === "shopify" &&
        row.data.shop &&
        row.data.shopifyVariantId
      ) {
        shopifySyncHints.push({
          shop: String(row.data.shop),
          shopifyVariantId: String(row.data.shopifyVariantId),
          shopifyInventoryItemId: row.data.shopifyInventoryItemId
            ? String(row.data.shopifyInventoryItemId)
            : undefined,
          newQuantity,
        });
      }
    }

    const first = fresh[0];
    const shipmentDoc: Record<string, unknown> = {
      productName:
        fresh.length === 1
          ? String(first.data.productName || "Shopify shipment")
          : "Multiple Products",
      date: now,
      createdAt: now,
      shippedQty: totalUnits,
      boxesShipped: totalUnits,
      unitsForPricing: totalUnits,
      remainingQty: Math.max(0, first.available - first.needed),
      packOf: 1,
      unitPrice: dtcUnitPrice,
      shipTo,
      remarks,
      service: DTC_FBM_SERVICE,
      shipmentType: "product",
      productType: "Standard",
      source: "shopify",
      shopifyOrderId: orderId,
      shopifyOrderName: orderName,
      shopifyShop: shop,
      trackingNumber: input.trackingNumber || null,
      trackingCompany: input.trackingCompany || null,
      labelPrice: labelPrice > 0 ? labelPrice : null,
      labelPurchaseId,
      items,
      totalBoxes: totalUnits,
      totalUnits,
      totalSkus: fresh.length,
      fulfilledBy: input.fulfilledBy,
      quickFulfill: true,
    };

    tx.set(shippedRef, shipmentDoc);
    tx.set(logRef, {
      shop,
      orderId,
      orderName,
      shippedId: shippedRef.id,
      inventoryIds: Array.from(qtyByInventoryId.keys()),
      totalUnits,
      trackingNumber: input.trackingNumber || null,
      trackingCompany: input.trackingCompany || null,
      fulfilledBy: input.fulfilledBy,
      at: now,
    });

    if (orderSnap.exists) {
      tx.update(orderSnap.ref, {
        fulfillment_status: "fulfilled",
        fulfillmentStatus: "fulfilled",
        updated_at: new Date().toISOString(),
        quickFulfilledAt: now,
        quickFulfilledShippedId: shippedRef.id,
      });
    }
  });

  // Physical warehouse cartons/bins (Warehouse Ops inventory) — separate from client inventory docs.
  let warehouseDeducted = 0;
  let warehouseShortfall = 0;
  for (const row of inventorySnaps) {
    const sku = row.data.sku != null ? String(row.data.sku) : null;
    const productName = row.data.productName != null ? String(row.data.productName) : null;
    try {
      const wh = await deductWarehouseStockForQuickFulfill({
        db: input.db,
        clientUserId: ownerUserId,
        sku,
        productName,
        quantity: row.needed,
        operatorId: input.fulfilledBy,
        shopifyOrderId: orderId,
        shopifyOrderName: orderName,
      });
      warehouseDeducted += wh.deducted;
      warehouseShortfall += wh.shortfall;
      if (wh.shortfall > 0) {
        console.warn("[shopify-quick-fulfill] warehouse bin shortfall", {
          inventoryId: row.inventoryId,
          sku,
          needed: row.needed,
          deducted: wh.deducted,
          shortfall: wh.shortfall,
        });
      }
    } catch (err) {
      console.error("[shopify-quick-fulfill] warehouse deduct failed", err);
      warehouseShortfall += row.needed;
    }
  }

  try {
    await logRef.set(
      {
        warehouseDeducted,
        warehouseShortfall,
        warehouseDeductedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  } catch {
    // non-fatal
  }

  return {
    shippedId: shippedRef.id,
    alreadyProcessed: false,
    shopifySyncHints,
    warehouseDeducted,
    warehouseShortfall,
  };
}
