/**
 * Correct warehouse product on an already Quick-Fulfilled Shopify shipped entry.
 * Shopify order fulfillment / tracking stay unchanged.
 */

import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import {
  deductWarehouseStockForQuickFulfill,
  restoreWarehouseStockForQuickFulfill,
} from "@/lib/warehouse-quick-fulfill-deduct";
import type { ShopifyInventorySyncHint } from "@/lib/shopify-quick-fulfill";

export type CorrectQuickFulfillProductResult = {
  shippedId: string;
  oldInventoryId: string;
  newInventoryId: string;
  quantity: number;
  shopifySyncHints: ShopifyInventorySyncHint[];
  warehouseRestored: number;
  warehouseDeducted: number;
  warehouseShortfall: number;
};

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

/**
 * Swap the warehouse inventory product on a Quick Fulfill shipped line.
 * Credits the mistaken product, debits the correct one, rewrites shipped items,
 * restores/deducts warehouse bins best-effort, and returns Shopify sync hints.
 */
export async function correctShopifyQuickFulfillWarehouseProduct(input: {
  db: Firestore;
  ownerUserId: string;
  shippedId: string;
  lineIndex: number;
  newInventoryId: string;
  actorUid: string;
  actorName?: string | null;
}): Promise<CorrectQuickFulfillProductResult> {
  const ownerUserId = String(input.ownerUserId || "").trim();
  const shippedId = String(input.shippedId || "").trim();
  const newInventoryId = String(input.newInventoryId || "").trim();
  const lineIndex = Math.floor(Number(input.lineIndex));

  if (!ownerUserId || !shippedId || !newInventoryId) {
    throw new Error("userId, shippedId, and newInventoryId are required.");
  }
  if (!Number.isFinite(lineIndex) || lineIndex < 0) {
    throw new Error("Invalid line index.");
  }

  const shippedRef = input.db.collection("users").doc(ownerUserId).collection("shipped").doc(shippedId);
  const newInvRef = input.db.collection("users").doc(ownerUserId).collection("inventory").doc(newInventoryId);

  const shopifySyncHints: ShopifyInventorySyncHint[] = [];
  let oldSku: string | null = null;
  let oldProductName: string | null = null;
  let newSku: string | null = null;
  let newProductName: string | null = null;
  let shopifyOrderId: string | null = null;
  let shopifyOrderName: string | null = null;
  let quantity = 0;
  let oldInventoryId = "";

  await input.db.runTransaction(async (tx) => {
    const shippedSnap = await tx.get(shippedRef);
    if (!shippedSnap.exists) throw new Error("Shipped entry not found.");
    const shipped = asRecord(shippedSnap.data());

    const isQuickFulfill =
      shipped.quickFulfill === true || String(shipped.source || "").toLowerCase() === "shopify";
    if (!isQuickFulfill) {
      throw new Error("Only Shopify Quick Fulfill shipped entries can be corrected.");
    }

    const items = Array.isArray(shipped.items) ? [...shipped.items] : [];
    if (lineIndex >= items.length) throw new Error("Shipment line not found.");

    const line = asRecord(items[lineIndex]);
    oldInventoryId = String(line.productId || "").trim();
    if (!oldInventoryId) throw new Error("Shipped line has no warehouse product id.");
    if (oldInventoryId === newInventoryId) {
      throw new Error("Select a different warehouse product.");
    }

    quantity = Math.max(
      0,
      Math.floor(Number(line.shippedQty ?? line.boxesShipped ?? shipped.shippedQty) || 0)
    );
    if (quantity < 1) throw new Error("Shipped line quantity is invalid.");

    shopifyOrderId =
      shipped.shopifyOrderId != null ? String(shipped.shopifyOrderId).trim() || null : null;
    shopifyOrderName =
      shipped.shopifyOrderName != null ? String(shipped.shopifyOrderName).trim() || null : null;

    const oldInvRef = input.db
      .collection("users")
      .doc(ownerUserId)
      .collection("inventory")
      .doc(oldInventoryId);

    const [oldInvSnap, newInvSnap] = await Promise.all([tx.get(oldInvRef), tx.get(newInvRef)]);
    if (!oldInvSnap.exists) throw new Error("Original warehouse product no longer exists.");
    if (!newInvSnap.exists) throw new Error("Selected warehouse product not found.");

    const oldData = asRecord(oldInvSnap.data());
    const newData = asRecord(newInvSnap.data());
    const oldQty = Math.max(0, Math.floor(Number(oldData.quantity) || 0));
    const newQty = Math.max(0, Math.floor(Number(newData.quantity) || 0));
    if (newQty < quantity) {
      throw new Error(
        `Not enough stock on ${String(newData.productName || newInventoryId)}. Available: ${newQty}, needed: ${quantity}.`
      );
    }

    const restoredOldQty = oldQty + quantity;
    const nextNewQty = newQty - quantity;
    const oldStatus = restoredOldQty > 0 ? "In Stock" : "Out of Stock";
    const newStatus = nextNewQty > 0 ? "In Stock" : "Out of Stock";

    oldSku = oldData.sku != null ? String(oldData.sku).trim() || null : null;
    oldProductName = oldData.productName != null ? String(oldData.productName) : null;
    newSku = newData.sku != null ? String(newData.sku).trim() || null : null;
    newProductName = newData.productName != null ? String(newData.productName) : "Product";
    const newRetail =
      newData.retailIdentifier != null ? String(newData.retailIdentifier).trim() || null : null;

    tx.update(oldInvRef, {
      quantity: restoredOldQty,
      status: oldStatus,
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(newInvRef, {
      quantity: nextNewQty,
      status: newStatus,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const now = FieldValue.serverTimestamp();
    const creditLog = input.db
      .collection("users")
      .doc(ownerUserId)
      .collection("inventoryChangeLogs")
      .doc();
    tx.set(creditLog, {
      inventoryId: oldInventoryId,
      productName: oldProductName,
      sku: oldSku,
      eventType: "shopify_qf_product_correct_credit",
      qtyBefore: oldQty,
      qtyAfter: restoredOldQty,
      qtyChange: quantity,
      shippedId,
      shopifyOrderId,
      shopifyOrderName,
      details: `Corrected Quick Fulfill — restored mistaken product · ${shopifyOrderName || shippedId}`,
      correctedBy: input.actorUid,
      correctedByName: input.actorName || null,
      at: now,
    });

    const debitLog = input.db
      .collection("users")
      .doc(ownerUserId)
      .collection("inventoryChangeLogs")
      .doc();
    tx.set(debitLog, {
      inventoryId: newInventoryId,
      productName: newProductName,
      sku: newSku,
      eventType: "shopify_qf_product_correct_debit",
      qtyBefore: newQty,
      qtyAfter: nextNewQty,
      qtyChange: -quantity,
      shippedId,
      shopifyOrderId,
      shopifyOrderName,
      details: `Corrected Quick Fulfill — deducted correct product · ${shopifyOrderName || shippedId}`,
      correctedBy: input.actorUid,
      correctedByName: input.actorName || null,
      at: now,
    });

    const nextLine = {
      ...line,
      productId: newInventoryId,
      productName: newProductName,
      sku: newSku,
      retailIdentifier: newRetail,
      remainingQty: nextNewQty,
      boxesShipped: Math.max(0, Math.floor(Number(line.boxesShipped) || quantity)),
      shippedQty: quantity,
      packOf: Math.max(1, Math.floor(Number(line.packOf) || 1)),
    };
    items[lineIndex] = nextLine;

    const rootPatch: Record<string, unknown> = {
      items,
      updatedAt: now,
      warehouseProductCorrectedAt: now,
      warehouseProductCorrectedBy: input.actorUid,
      warehouseProductCorrectedByName: input.actorName || null,
    };
    if (items.length === 1) {
      rootPatch.productName = newProductName;
      rootPatch.remainingQty = nextNewQty;
    }
    tx.set(shippedRef, rootPatch, { merge: true });

    if (oldData.source === "shopify" && oldData.shop && oldData.shopifyVariantId) {
      shopifySyncHints.push({
        shop: String(oldData.shop),
        shopifyVariantId: String(oldData.shopifyVariantId),
        shopifyInventoryItemId: oldData.shopifyInventoryItemId
          ? String(oldData.shopifyInventoryItemId)
          : undefined,
        newQuantity: restoredOldQty,
      });
    }
    if (newData.source === "shopify" && newData.shop && newData.shopifyVariantId) {
      shopifySyncHints.push({
        shop: String(newData.shop),
        shopifyVariantId: String(newData.shopifyVariantId),
        shopifyInventoryItemId: newData.shopifyInventoryItemId
          ? String(newData.shopifyInventoryItemId)
          : undefined,
        newQuantity: nextNewQty,
      });
    }
  });

  let warehouseRestored = 0;
  let warehouseDeducted = 0;
  let warehouseShortfall = 0;

  try {
    const restored = await restoreWarehouseStockForQuickFulfill({
      db: input.db,
      clientUserId: ownerUserId,
      sku: oldSku,
      quantity,
      shopifyOrderId,
      operatorId: input.actorName || input.actorUid,
      productName: oldProductName,
    });
    warehouseRestored = restored.restored;
  } catch (err) {
    console.warn("[correct-qf-product] warehouse restore failed", err);
  }

  try {
    const deducted = await deductWarehouseStockForQuickFulfill({
      db: input.db,
      clientUserId: ownerUserId,
      sku: newSku,
      productName: newProductName,
      quantity,
      operatorId: input.actorName || input.actorUid,
      shopifyOrderId,
      shopifyOrderName,
    });
    warehouseDeducted = deducted.deducted;
    warehouseShortfall = deducted.shortfall;
  } catch (err) {
    console.warn("[correct-qf-product] warehouse deduct failed", err);
    warehouseShortfall = quantity;
  }

  return {
    shippedId,
    oldInventoryId,
    newInventoryId,
    quantity,
    shopifySyncHints,
    warehouseRestored,
    warehouseDeducted,
    warehouseShortfall,
  };
}
