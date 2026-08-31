/**
 * Amazon FBM Quick Fulfill: deduct warehouse inventory, create shipped entry,
 * confirm shipment on Amazon with tracking.
 */

import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { amazonAddressSummary } from "@/lib/amazon-order-normalize";
import {
  confirmAmazonOrderShipment,
  getAmazonConnectionTokensOrThrow,
} from "@/lib/amazon-sp-api-orders";
import { deductWarehouseStockForQuickFulfill } from "@/lib/warehouse-quick-fulfill-deduct";
import { resolveShopifyQuickFulfillDtcUnitPrice } from "@/lib/shopify-quick-fulfill-pricing";
import { DTC_FBM_SERVICE } from "@/types";

export type AmazonQuickFulfillLineInput = {
  orderItemId: string;
  inventoryId: string;
  quantity: number;
  lineTitle?: string | null;
  lineSku?: string | null;
};

export type AmazonQuickFulfillResult = {
  shippedId: string;
  alreadyProcessed: boolean;
  warehouseDeducted: number;
  warehouseShortfall: number;
};

function quickFulfillLogId(connectionId: string, orderId: string): string {
  return `${connectionId.replace(/[^a-z0-9]+/gi, "_")}_${orderId}`;
}

export async function executeAmazonQuickFulfill(input: {
  db: Firestore;
  ownerUserId: string;
  connectionId: string;
  amazonOrderId: string;
  marketplaceId: string;
  storeName?: string | null;
  shipTo?: string | null;
  lines: AmazonQuickFulfillLineInput[];
  trackingNumber?: string;
  trackingCompany?: string;
  fulfilledBy: string;
  labelPrice?: number | null;
  labelPurchaseId?: string | null;
}): Promise<AmazonQuickFulfillResult> {
  const ownerUserId = String(input.ownerUserId || "").trim();
  const connectionId = String(input.connectionId || "").trim();
  const amazonOrderId = String(input.amazonOrderId || "").trim();
  const marketplaceId = String(input.marketplaceId || "").trim();
  if (!ownerUserId || !connectionId || !amazonOrderId || !marketplaceId) {
    throw new Error("Missing ownerUserId, connectionId, amazonOrderId, or marketplaceId");
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new Error("Select at least one warehouse product to fulfill");
  }
  if (!input.trackingNumber?.trim()) {
    throw new Error("Tracking number is required for Amazon FBM shipment confirmation");
  }

  const logId = quickFulfillLogId(connectionId, amazonOrderId);
  const logRef = input.db
    .collection("users")
    .doc(ownerUserId)
    .collection("amazonQuickFulfillLogs")
    .doc(logId);

  const existingLog = await logRef.get();
  if (existingLog.exists) {
    const data = existingLog.data() || {};
    return {
      shippedId: String(data.shippedId || ""),
      alreadyProcessed: true,
      warehouseDeducted: Number(data.warehouseDeducted) || 0,
      warehouseShortfall: Number(data.warehouseShortfall) || 0,
    };
  }

  const qtyByInventoryId = new Map<string, number>();
  const amazonMetaByInventoryId = new Map<
    string,
    { lineTitle?: string; lineSku?: string }
  >();
  const confirmItems: Array<{ orderItemId: string; quantity: number }> = [];

  for (const line of input.lines) {
    const inventoryId = String(line.inventoryId || "").trim();
    const orderItemId = String(line.orderItemId || "").trim();
    const quantity = Math.floor(Number(line.quantity) || 0);
    if (!inventoryId) throw new Error("Each line must select a warehouse product");
    if (!orderItemId) throw new Error("Each line must map to an Amazon order item");
    if (quantity <= 0) throw new Error("Quantity must be greater than 0");
    qtyByInventoryId.set(inventoryId, (qtyByInventoryId.get(inventoryId) || 0) + quantity);
    confirmItems.push({ orderItemId, quantity });
    const title = String(line.lineTitle || "").trim();
    const sku = String(line.lineSku || "").trim();
    if (title || sku) {
      const prev = amazonMetaByInventoryId.get(inventoryId);
      amazonMetaByInventoryId.set(inventoryId, {
        lineTitle: prev?.lineTitle || title || undefined,
        lineSku: prev?.lineSku || sku || undefined,
      });
    }
  }

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

  const tokens = await getAmazonConnectionTokensOrThrow(ownerUserId, connectionId);
  await confirmAmazonOrderShipment({
    accessToken: tokens.accessToken,
    amazonOrderId,
    marketplaceId,
    carrierName: input.trackingCompany?.trim() || "Other",
    trackingNumber: input.trackingNumber.trim(),
    orderItems: confirmItems,
  });

  const storeLabel = input.storeName?.trim() || "Amazon";
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
    `Shipped for Amazon order ${amazonOrderId}`,
    `Store: ${storeLabel}`,
    trackingParts ? `Tracking: ${trackingParts}` : null,
    labelPrice > 0 ? `Label price: $${labelPrice.toFixed(2)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const shippedRef = input.db.collection("users").doc(ownerUserId).collection("shipped").doc();
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
      input.db.collection("users").doc(ownerUserId).collection("amazonOrders").doc(amazonOrderId)
    );
    const orderData = orderSnap.exists ? (orderSnap.data() as Record<string, unknown>) : null;
    const shipTo =
      String(input.shipTo || "").trim() ||
      amazonAddressSummary(
        orderData?.shippingAddress as Parameters<typeof amazonAddressSummary>[0]
      ) ||
      "Amazon customer";

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
      const amazonMeta = amazonMetaByInventoryId.get(row.inventoryId);

      tx.update(row.ref, {
        quantity: newQuantity,
        status: newStatus,
        updatedAt: now,
      });

      const changeLogRef = input.db
        .collection("users")
        .doc(ownerUserId)
        .collection("inventoryChangeLogs")
        .doc(`amazon_qf_${amazonOrderId}_${row.inventoryId}`);
      tx.set(changeLogRef, {
        inventoryId: row.inventoryId,
        productName,
        sku: sku || null,
        eventType: "amazon_quick_fulfill",
        qtyBefore: currentQty,
        qtyAfter: newQuantity,
        qtyChange: -shipQty,
        amazonOrderId,
        connectionId,
        storeName: storeLabel,
        shippedId: shippedRef.id,
        details: `Amazon quick fulfill · ${amazonOrderId} · ${storeLabel}`,
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
        amazonLineTitle: amazonMeta?.lineTitle || null,
        amazonLineSku: amazonMeta?.lineSku || null,
      });
      totalUnits += shipQty;
    }

    const first = fresh[0];
    tx.set(shippedRef, {
      productName:
        fresh.length === 1
          ? String(first.data.productName || "Amazon shipment")
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
      source: "amazon",
      amazonOrderId,
      amazonConnectionId: connectionId,
      amazonStoreName: storeLabel,
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
    });

    tx.set(logRef, {
      connectionId,
      amazonOrderId,
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
        orderStatus: "Shipped",
        sellerFulfillable: false,
        updatedAt: new Date().toISOString(),
        quickFulfilledAt: new Date().toISOString(),
        quickFulfilledShippedId: shippedRef.id,
        trackingNumbers: FieldValue.arrayUnion(input.trackingNumber),
        trackingCarriers: input.trackingCompany
          ? FieldValue.arrayUnion(input.trackingCompany)
          : undefined,
      });
    }
  });

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
        movementType: "shopify_quick_fulfill",
      });
      warehouseDeducted += wh.deducted;
      warehouseShortfall += wh.shortfall;
    } catch (err) {
      console.error("[amazon-quick-fulfill] warehouse deduct failed", err);
      warehouseShortfall += row.needed;
    }
  }

  try {
    await logRef.set(
      { warehouseDeducted, warehouseShortfall, warehouseDeductedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  } catch {
    // non-fatal
  }

  return {
    shippedId: shippedRef.id,
    alreadyProcessed: false,
    warehouseDeducted,
    warehouseShortfall,
  };
}
