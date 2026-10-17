import {
  earliestExpiryFromBatches,
  mergeExpiryBatch,
  preserveKnownExpiryLots,
  type ExpiryBatch,
} from "@/lib/inventory-expiry-batches";

export type MergeInventoryProductInput = {
  target: {
    id: string;
    quantity?: number;
    status?: string;
    expiryDate?: unknown;
    expiryBatches?: ExpiryBatch[] | null;
    locationId?: string | null;
    locationQuantities?: Record<string, number> | null;
    mergedFromInventoryIds?: string[] | null;
  };
  source: {
    id: string;
    quantity?: number;
    expiryDate?: unknown;
    expiryBatches?: ExpiryBatch[] | null;
    locationId?: string | null;
    locationQuantities?: Record<string, number> | null;
    sku?: string | null;
    productName?: string | null;
    receivingDate?: unknown;
  };
};

export type MergeInventoryProductResult = {
  targetPatch: Record<string, unknown>;
  sourcePatch: Record<string, unknown>;
  changeLog: {
    eventType: "inventory_product_merge";
    inventoryId: string;
    productName: string | null;
    sku: string | null;
    qtyBefore: number;
    qtyAfter: number;
    qtyChange: number;
    sourceInventoryId: string;
    sourceSku: string | null;
    sourceProductName: string | null;
    sourceQtyMerged: number;
    details: string;
  };
};

function mergeLocationQuantities(
  target: Record<string, number> | null | undefined,
  source: Record<string, number> | null | undefined
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(target || {})) {
    const id = String(key || "").trim();
    const qty = Math.max(0, Math.floor(Number(value) || 0));
    if (!id || qty <= 0) continue;
    out[id] = qty;
  }
  for (const [key, value] of Object.entries(source || {})) {
    const id = String(key || "").trim();
    const qty = Math.max(0, Math.floor(Number(value) || 0));
    if (!id || qty <= 0) continue;
    out[id] = (out[id] || 0) + qty;
  }
  return out;
}

function mergeExpiryLotsFromSource(
  targetBatches: ExpiryBatch[] | null | undefined,
  sourceBatches: ExpiryBatch[] | null | undefined,
  sourceLegacyExpiry?: unknown
): ExpiryBatch[] {
  const sourceList = Array.isArray(sourceBatches) ? sourceBatches : [];
  let next = preserveKnownExpiryLots(
    targetBatches,
    sourceList.map((b) => b.expiry).concat([String(sourceLegacyExpiry || "")])
  );
  for (const batch of sourceList) {
    const expiry = String(batch.expiry || "").trim();
    const qty = Math.max(0, Math.floor(Number(batch.quantity) || 0));
    if (!expiry) continue;
    if (qty > 0) {
      next = mergeExpiryBatch(next, {
        expiry,
        quantity: qty,
        lot: batch.lot ?? null,
        requestId: batch.requestId ?? null,
      });
    } else {
      next = preserveKnownExpiryLots(next, [expiry]);
    }
  }
  return next;
}

/**
 * Merge source inventory row into target (keeper).
 * Does not rewrite restock/ship history — source stays at 0 with mergedInto link;
 * target gains qty + lots + mergedFromInventoryIds for history display.
 */
export function buildClientInventoryProductMerge(
  input: MergeInventoryProductInput
): MergeInventoryProductResult {
  const targetId = String(input.target.id || "").trim();
  const sourceId = String(input.source.id || "").trim();
  if (!targetId || !sourceId) throw new Error("Target and source inventory ids are required.");
  if (targetId === sourceId) throw new Error("Cannot merge a product into itself.");

  const targetQty = Math.max(0, Math.floor(Number(input.target.quantity) || 0));
  const sourceQty = Math.max(0, Math.floor(Number(input.source.quantity) || 0));
  const newQty = targetQty + sourceQty;

  const expiryBatches = mergeExpiryLotsFromSource(
    input.target.expiryBatches,
    input.source.expiryBatches,
    input.source.expiryDate
  );
  const earliest = earliestExpiryFromBatches(expiryBatches);

  const mergedFrom = Array.from(
    new Set([...(input.target.mergedFromInventoryIds || []), sourceId].map((id) => String(id).trim()).filter(Boolean))
  );

  const locationQuantities = mergeLocationQuantities(
    input.target.locationQuantities,
    input.source.locationQuantities
  );
  const nextPrimaryLocationId =
    (input.target.locationId && locationQuantities[String(input.target.locationId)]
      ? String(input.target.locationId)
      : "") ||
    Object.keys(locationQuantities)[0] ||
    String(input.target.locationId || input.source.locationId || "").trim() ||
    null;

  const sourceSku = input.source.sku ? String(input.source.sku) : null;
  const sourceName = input.source.productName ? String(input.source.productName) : null;

  const sourceReceivingDate = input.source.receivingDate ?? null;

  return {
    targetPatch: {
      quantity: newQty,
      status: newQty > 0 ? "In Stock" : "Out of Stock",
      expiryBatches,
      expiryDate: earliest,
      mergedFromInventoryIds: mergedFrom,
      // Keeper takes the merged-in product’s receiving date (source trail).
      ...(sourceReceivingDate != null ? { receivingDate: sourceReceivingDate } : {}),
      ...(Object.keys(locationQuantities).length > 0 ? { locationQuantities } : {}),
      ...(nextPrimaryLocationId ? { locationId: nextPrimaryLocationId } : {}),
    },
    sourcePatch: {
      quantity: 0,
      status: "Out of Stock",
      locationQuantities: {},
      mergedIntoInventoryId: targetId,
      // Keep source expiryBatches as-is so its own history/expiry story stays readable.
    },
    changeLog: {
      eventType: "inventory_product_merge",
      inventoryId: targetId,
      productName: null,
      sku: null,
      qtyBefore: targetQty,
      qtyAfter: newQty,
      qtyChange: sourceQty,
      sourceInventoryId: sourceId,
      sourceSku,
      sourceProductName: sourceName,
      sourceQtyMerged: sourceQty,
      details: `Merged ${sourceQty} units from ${sourceSku || sourceName || sourceId} (${sourceId}). Source restock/ship history stays on that row.`,
    },
  };
}
