/**
 * eBay Quick Fulfill: deduct warehouse inventory, create shipped entry,
 * fulfill the eBay order with tracking — no pick/pack/dispatch.
 */

import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { getValidEbayToken, getEbayApiBaseUrl } from "@/lib/ebay-api";
import { deductWarehouseStockForQuickFulfill } from "@/lib/warehouse-quick-fulfill-deduct";
import { resolveShopifyQuickFulfillDtcUnitPrice } from "@/lib/shopify-quick-fulfill-pricing";
import { DTC_FBM_SERVICE } from "@/types";
import type { EbayInventoryPushHint } from "@/lib/ebay-inventory-sync";

export type EbayQuickFulfillLineInput = {
  ebayLineItemId: string;
  inventoryId: string;
  quantity: number;
  lineTitle?: string | null;
  lineSku?: string | null;
};

export type EbayQuickFulfillResult = {
  shippedId: string;
  alreadyProcessed: boolean;
  ebaySyncHints: EbayInventoryPushHint[];
  warehouseDeducted: number;
  warehouseShortfall: number;
};

function shipToFromEbayAddress(addr: Record<string, unknown> | null | undefined): string {
  if (!addr) return "eBay customer";
  const parts = [
    addr.fullName,
    addr.addressLine1,
    addr.addressLine2,
    [addr.city, addr.stateOrProvince, addr.postalCode].filter(Boolean).join(", "),
    addr.countryCode,
  ]
    .map((p) => (p == null ? "" : String(p).trim()))
    .filter(Boolean);
  return parts.join(", ") || "eBay customer";
}

async function createEbayFulfillment(input: {
  ownerUserId: string;
  connectionId: string;
  orderId: string;
  lineItems: Array<{ lineItemId: string; quantity: number }>;
  trackingNumber?: string;
  shippingCarrierCode?: string;
}): Promise<"created" | "already_fulfilled"> {
  const conn = await getValidEbayToken(input.ownerUserId, input.connectionId);
  if (!conn) throw new Error("eBay connection not found or token invalid");

  const base = getEbayApiBaseUrl(conn.isSandbox);
  const payload: Record<string, unknown> = {
    lineItems: input.lineItems,
  };
  if (input.trackingNumber) payload.trackingNumber = input.trackingNumber;
  if (input.shippingCarrierCode) payload.shippingCarrierCode = input.shippingCarrierCode;
  if (input.trackingNumber || input.shippingCarrierCode) {
    payload.shippedDate = new Date().toISOString();
  }

  const url = `${base}/sell/fulfillment/v1/order/${encodeURIComponent(input.orderId)}/shipping_fulfillment`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${conn.accessToken}`,
      "Content-Type": "application/json",
      "Accept-Language": "en-US",
      "Content-Language": "en-US",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    if (/already|fulfilled|completed/i.test(errText)) {
      return "already_fulfilled";
    }
    throw new Error(`eBay fulfillment failed (${res.status}): ${errText.slice(0, 240)}`);
  }
  return "created";
}

export async function executeEbayQuickFulfill(input: {
  db: Firestore;
  ownerUserId: string;
  connectionId: string;
  orderId: string;
  lines: EbayQuickFulfillLineInput[];
  trackingNumber?: string;
  shippingCarrierCode?: string;
  fulfilledBy: string;
  labelPrice?: number | null;
  labelPurchaseId?: string | null;
}): Promise<EbayQuickFulfillResult> {
  const orderId = String(input.orderId || "").trim();
  const ownerUserId = String(input.ownerUserId || "").trim();
  const connectionId = String(input.connectionId || "").trim();
  if (!orderId || !ownerUserId || !connectionId) {
    throw new Error("Missing orderId, ownerUserId, or connectionId");
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new Error("Select at least one warehouse product to fulfill");
  }

  const logRef = input.db
    .collection("users")
    .doc(ownerUserId)
    .collection("ebayQuickFulfillLogs")
    .doc(orderId);

  const existingLog = await logRef.get();
  if (existingLog.exists) {
    const data = existingLog.data() || {};
    return {
      shippedId: String(data.shippedId || ""),
      alreadyProcessed: true,
      ebaySyncHints: [],
      warehouseDeducted: Number(data.warehouseDeducted) || 0,
      warehouseShortfall: Number(data.warehouseShortfall) || 0,
    };
  }

  const qtyByInventoryId = new Map<string, number>();
  const lineMetaByInventoryId = new Map<
    string,
    { lineTitle?: string; lineSku?: string; ebayLineItemId: string }
  >();
  const ebayLineItems: Array<{ lineItemId: string; quantity: number }> = [];

  for (const line of input.lines) {
    const inventoryId = String(line.inventoryId || "").trim();
    const quantity = Math.floor(Number(line.quantity) || 0);
    const ebayLineItemId = String(line.ebayLineItemId || "").trim();
    if (!inventoryId) throw new Error("Each line must select a warehouse product");
    if (!ebayLineItemId) throw new Error("Each line must include an eBay line item id");
    if (quantity <= 0) throw new Error("Quantity must be greater than 0");
    qtyByInventoryId.set(inventoryId, (qtyByInventoryId.get(inventoryId) || 0) + quantity);
    ebayLineItems.push({ lineItemId: ebayLineItemId, quantity });
    const title = String(line.lineTitle || "").trim();
    const lineSku = String(line.lineSku || "").trim();
    if (title || lineSku) {
      const prev = lineMetaByInventoryId.get(inventoryId);
      lineMetaByInventoryId.set(inventoryId, {
        lineTitle: prev?.lineTitle || title || undefined,
        lineSku: prev?.lineSku || lineSku || undefined,
        ebayLineItemId,
      });
    } else {
      lineMetaByInventoryId.set(inventoryId, { ebayLineItemId });
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

  await createEbayFulfillment({
    ownerUserId,
    connectionId,
    orderId,
    lineItems: ebayLineItems,
    trackingNumber: input.trackingNumber,
    shippingCarrierCode: input.shippingCarrierCode,
  });

  const orderName = `#${orderId}`;
  const trackingParts = [input.shippingCarrierCode, input.trackingNumber].filter(Boolean).join(" ");
  const labelPrice =
    input.labelPrice != null && Number.isFinite(Number(input.labelPrice))
      ? Math.max(0, Number(Number(input.labelPrice).toFixed(2)))
      : 0;
  const labelPurchaseId =
    typeof input.labelPurchaseId === "string" && input.labelPurchaseId.trim()
      ? input.labelPurchaseId.trim()
      : null;
  const remarks = [
    `Shipped for eBay order ${orderName}`,
    trackingParts ? `Tracking: ${trackingParts}` : null,
    labelPrice > 0 ? `Label price: $${labelPrice.toFixed(2)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const shippedRef = input.db.collection("users").doc(ownerUserId).collection("shipped").doc();
  const ebaySyncHints: EbayInventoryPushHint[] = [];
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
      input.db.collection("users").doc(ownerUserId).collection("ebayOrders").doc(orderId)
    );
    const orderData = orderSnap.exists ? (orderSnap.data() as Record<string, unknown>) : null;
    const shipTo = shipToFromEbayAddress(
      (orderData?.shipTo as Record<string, unknown> | undefined) || null
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
      const meta = lineMetaByInventoryId.get(row.inventoryId);

      tx.update(row.ref, {
        quantity: newQuantity,
        status: newStatus,
        updatedAt: now,
      });

      const changeLogRef = input.db
        .collection("users")
        .doc(ownerUserId)
        .collection("inventoryChangeLogs")
        .doc(`ebay_qf_${orderId}_${row.inventoryId}`);
      tx.set(changeLogRef, {
        inventoryId: row.inventoryId,
        productName,
        sku: sku || null,
        eventType: "ebay_quick_fulfill",
        qtyBefore: currentQty,
        qtyAfter: newQuantity,
        qtyChange: -shipQty,
        ebayOrderId: orderId,
        shippedId: shippedRef.id,
        details: `eBay quick fulfill · ${orderName}`,
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
        ebayLineTitle: meta?.lineTitle || null,
        ebayLineSku: meta?.lineSku || null,
      });
      totalUnits += shipQty;

      if (
        row.data.source === "ebay" &&
        row.data.ebayConnectionId &&
        (row.data.ebayOfferId || row.data.ebayListingId)
      ) {
        ebaySyncHints.push({
          userId: ownerUserId,
          connectionId: String(row.data.ebayConnectionId),
          offerId: row.data.ebayOfferId ? String(row.data.ebayOfferId) : null,
          listingId: row.data.ebayListingId ? String(row.data.ebayListingId) : null,
          newQuantity,
        });
      }
    }

    const first = fresh[0];
    tx.set(shippedRef, {
      productName:
        fresh.length === 1
          ? String(first.data.productName || "eBay shipment")
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
      source: "ebay",
      ebayOrderId: orderId,
      ebayConnectionId: connectionId,
      trackingNumber: input.trackingNumber || null,
      trackingCompany: input.shippingCarrierCode || null,
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
      orderId,
      shippedId: shippedRef.id,
      inventoryIds: Array.from(qtyByInventoryId.keys()),
      totalUnits,
      trackingNumber: input.trackingNumber || null,
      shippingCarrierCode: input.shippingCarrierCode || null,
      fulfilledBy: input.fulfilledBy,
      at: now,
    });

    if (orderSnap.exists) {
      tx.update(orderSnap.ref, {
        orderFulfillmentStatus: "FULFILLED",
        quickFulfilledAt: now,
        quickFulfilledShippedId: shippedRef.id,
        updatedAt: new Date().toISOString(),
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
        ebayOrderId: orderId,
        movementType: "ebay_quick_fulfill",
      });
      warehouseDeducted += wh.deducted;
      warehouseShortfall += wh.shortfall;
    } catch (err) {
      console.error("[ebay-quick-fulfill] warehouse deduct failed", err);
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
    ebaySyncHints,
    warehouseDeducted,
    warehouseShortfall,
  };
}
