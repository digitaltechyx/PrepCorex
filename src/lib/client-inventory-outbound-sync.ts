import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  Timestamp,
  where,
  deleteField,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { InventoryItem } from "@/types";

export type ClientInventoryDeductionTiming = "create" | "confirm" | "dispatch";

/** True when client sellable qty was already reserved (create-time or earlier deduct). */
export function hasClientInventoryDeducted(data: Record<string, unknown>): boolean {
  return Boolean(data.clientInventoryDeductedAt);
}

function shipmentLineIsPrepOnly(shipment: Record<string, unknown>): boolean {
  const productId = String(shipment.productId ?? "").trim();
  const inboundId = String(shipment.sourceInventoryRequestId ?? "").trim();
  if (inboundId) return true;
  return productId.startsWith("prep:");
}

export type ShopifyInventorySyncHint = {
  productId: string;
  newQuantity: number;
  shop?: string;
  shopifyVariantId?: string;
  shopifyInventoryItemId?: string;
  source?: string;
  woocommerceConnectionId?: string;
  woocommerceProductId?: string;
  woocommerceVariationId?: string;
  tiktokConnectionId?: string;
  tiktokProductId?: string;
  tiktokSkuId?: string;
  tiktokShopId?: string;
  ebayConnectionId?: string;
  ebayOfferId?: string;
  ebayListingId?: string;
};

function removeUndefined(obj: unknown): unknown {
  if (obj === null || obj === undefined) return null;
  if (obj && typeof obj === "object" && ("seconds" in obj || "toDate" in obj)) return obj;
  if (obj instanceof Date) return obj;
  if (Array.isArray(obj)) {
    return obj.map(removeUndefined).filter((item) => item !== undefined);
  }
  if (typeof obj === "object") {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (value !== undefined) cleaned[key] = removeUndefined(value);
    }
    return cleaned;
  }
  return obj;
}

function timestampFromUnknown(value: unknown): Timestamp {
  if (value instanceof Timestamp) return value;
  if (value && typeof value === "object" && "seconds" in value) {
    return Timestamp.fromMillis(Number((value as { seconds: number }).seconds) * 1000);
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return Timestamp.fromDate(parsed);
  }
  return Timestamp.now();
}

function isCustomProductRequest(data: Record<string, unknown>): boolean {
  return (
    String(data.productType || "").toLowerCase() === "custom" &&
    String(data.shipmentType || "").toLowerCase() === "product"
  );
}

function effectivePackOfForShipment(
  data: Record<string, unknown>,
  shipment: Record<string, unknown>,
  index: number
): number {
  const isCustom = isCustomProductRequest(data);
  const customPricing = data.adminCustomProductPricing as
    | Record<number, { packOf?: number }>
    | undefined;
  if (isCustom && customPricing?.[index]?.packOf) {
    return Math.max(1, Math.floor(Number(customPricing[index].packOf) || 1));
  }
  return Math.max(1, Math.floor(Number(shipment.packOf) || 1));
}

export function shipmentUnits(
  data: Record<string, unknown>,
  shipment: Record<string, unknown>,
  index: number
): number {
  const qty = Math.max(0, Math.floor(Number(shipment.quantity) || 0));
  return qty * effectivePackOfForShipment(data, shipment, index);
}

function shipmentBoxes(
  shipment: Record<string, unknown>
): number {
  return Math.max(0, Math.floor(Number(shipment.quantity) || 0));
}

function outboundPackDetailsLine(boxes: number, packOf: number): string {
  return `qty ${boxes} pack of ${packOf}`;
}

function serviceLabelForRequest(data: Record<string, unknown>): string {
  if (data.shipmentType === "box") return "Box Forwarding";
  if (data.shipmentType === "pallet") {
    if (data.palletSubType === "forwarding") return "Pallet Forwarding";
    if (data.palletSubType === "existing_inventory") return "Pallet Existing Inventory";
    return "Pallet Forwarding";
  }
  return String(data.service || "FBA/WFS/TFS");
}

/** Units reserved by confirmed orders waiting for warehouse dispatch (not yet deducted from client inventory). */
export async function getCommittedOutboundUnits(
  clientUserId: string,
  productId: string,
  excludeRequestId?: string
): Promise<number> {
  const snap = await getDocs(
    query(
      collection(db, `users/${clientUserId}/shipmentRequests`),
      where("status", "==", "confirmed")
    )
  );

  let committed = 0;
  for (const reqDoc of snap.docs) {
    if (excludeRequestId && reqDoc.id === excludeRequestId) continue;
    const data = reqDoc.data() as Record<string, unknown>;
    // Create-time reservations already reduced inventory.quantity — do not double-count.
    if (hasClientInventoryDeducted(data)) continue;
    if (data.clientInventoryDeductionTiming !== "dispatch") continue;
    if (data.warehouseDispatchStatus === "dispatched") continue;

    const shipments = Array.isArray(data.shipments)
      ? (data.shipments as Array<Record<string, unknown>>)
      : [];
    shipments.forEach((shipment, index) => {
      if (String(shipment.productId ?? "") !== productId) return;
      committed += shipmentUnits(data, shipment, index);
    });
  }
  return committed;
}

export function defersClientInventoryDeduction(data: Record<string, unknown>): boolean {
  return data.clientInventoryDeductionTiming === "dispatch";
}

function applyLocationDeduction(
  currentInventory: Omit<InventoryItem, "id">,
  totalUnits: number,
  selectedSourceLocationId: string
): {
  newQuantity: number;
  newStatus: string;
  locationQuantities: Record<string, number>;
  nextPrimaryLocationId: string;
} {
  const incoming = (currentInventory as InventoryItem & { locationQuantities?: Record<string, number> })
    .locationQuantities;
  const locationQuantities: Record<string, number> = {};
  if (incoming && typeof incoming === "object") {
    for (const [key, value] of Object.entries(incoming)) {
      const id = String(key || "").trim();
      const qtyValue = Number(value);
      if (!id || !Number.isFinite(qtyValue) || qtyValue <= 0) continue;
      locationQuantities[id] = qtyValue;
    }
  }
  const fallbackLocationId = String(currentInventory.locationId || "").trim();
  if (Object.keys(locationQuantities).length === 0 && fallbackLocationId) {
    locationQuantities[fallbackLocationId] = Number(currentInventory.quantity) || 0;
  }
  const hasTrackedLocations = Object.keys(locationQuantities).length > 0;

  const newQuantity = currentInventory.quantity - totalUnits;
  const newStatus = newQuantity > 0 ? "In Stock" : "Out of Stock";

  if (hasTrackedLocations && selectedSourceLocationId) {
    const currentSourceQty = Number(locationQuantities[selectedSourceLocationId] || 0);
    locationQuantities[selectedSourceLocationId] = Math.max(0, currentSourceQty - totalUnits);
    if (locationQuantities[selectedSourceLocationId] <= 0) {
      delete locationQuantities[selectedSourceLocationId];
    }
  }

  const nextPrimaryLocationId =
    (currentInventory.locationId && locationQuantities[currentInventory.locationId]
      ? String(currentInventory.locationId)
      : "") ||
    Object.keys(locationQuantities)[0] ||
    String(currentInventory.locationId || "").trim();

  return { newQuantity, newStatus, locationQuantities, nextPrimaryLocationId };
}

function applyLocationRestore(
  currentInventory: Omit<InventoryItem, "id">,
  totalUnits: number,
  selectedSourceLocationId: string
): {
  newQuantity: number;
  newStatus: string;
  locationQuantities: Record<string, number>;
  nextPrimaryLocationId: string;
} {
  const incoming = (currentInventory as InventoryItem & { locationQuantities?: Record<string, number> })
    .locationQuantities;
  const locationQuantities: Record<string, number> = {};
  if (incoming && typeof incoming === "object") {
    for (const [key, value] of Object.entries(incoming)) {
      const id = String(key || "").trim();
      const qtyValue = Number(value);
      if (!id || !Number.isFinite(qtyValue) || qtyValue <= 0) continue;
      locationQuantities[id] = qtyValue;
    }
  }
  const fallbackLocationId = String(currentInventory.locationId || "").trim();
  if (Object.keys(locationQuantities).length === 0 && fallbackLocationId) {
    locationQuantities[fallbackLocationId] = Number(currentInventory.quantity) || 0;
  }

  const restoreLocationId =
    selectedSourceLocationId ||
    fallbackLocationId ||
    Object.keys(locationQuantities)[0] ||
    "";

  if (restoreLocationId) {
    locationQuantities[restoreLocationId] =
      Number(locationQuantities[restoreLocationId] || 0) + totalUnits;
  }

  const newQuantity = currentInventory.quantity + totalUnits;
  const newStatus = newQuantity > 0 ? "In Stock" : "Out of Stock";
  const nextPrimaryLocationId =
    String(currentInventory.locationId || "").trim() ||
    restoreLocationId ||
    Object.keys(locationQuantities)[0] ||
    "";

  return { newQuantity, newStatus, locationQuantities, nextPrimaryLocationId };
}

/**
 * Create a pending outbound request and reserve client sellable inventory immediately.
 * Warehouse cartons/bins are untouched. Prep-only lines skip inventory deduction.
 */
export async function createOutboundRequestWithClientReserve(input: {
  clientUserId: string;
  requestData: Record<string, unknown>;
}): Promise<{ requestId: string; reservedProductIds: string[] }> {
  const requestRef = doc(collection(db, `users/${input.clientUserId}/shipmentRequests`));
  const reservedProductIds: string[] = [];
  const reservedAt = Timestamp.now();

  await runTransaction(db, async (transaction) => {
    const shipments = Array.isArray(input.requestData.shipments)
      ? (input.requestData.shipments as Array<Record<string, unknown>>)
      : [];

    const deductible = shipments
      .map((shipment, index) => ({ shipment, index }))
      .filter(({ shipment }) => !shipmentLineIsPrepOnly(shipment));

    const inventoryReads = await Promise.all(
      deductible.map(async ({ shipment, index }) => {
        const productId = String(shipment.productId ?? "").trim();
        if (!productId) throw new Error("Missing product on shipment line.");
        const inventoryRef = doc(db, `users/${input.clientUserId}/inventory`, productId);
        const inventorySnap = await transaction.get(inventoryRef);
        if (!inventorySnap.exists()) {
          throw new Error(`Product ${productId} not found in inventory.`);
        }
        return {
          shipment,
          index,
          productId,
          inventoryRef,
          inventorySnap,
          totalUnits: shipmentUnits(input.requestData, shipment, index),
        };
      })
    );

    for (const row of inventoryReads) {
      const currentInventory = row.inventorySnap.data() as Omit<InventoryItem, "id">;
      if (currentInventory.quantity < row.totalUnits) {
        throw new Error(
          `Not enough stock for ${currentInventory.productName}. Available: ${currentInventory.quantity}, Requested: ${row.totalUnits}.`
        );
      }

      const selectedSourceLocationId = String(
        (row.shipment as Record<string, unknown>).sourceLocationId || ""
      ).trim();
      const applied = applyLocationDeduction(
        currentInventory,
        row.totalUnits,
        selectedSourceLocationId
      );

      transaction.update(row.inventoryRef, {
        quantity: applied.newQuantity,
        status: applied.newStatus,
        locationId: applied.nextPrimaryLocationId,
        locationQuantities: applied.locationQuantities,
      });

      const changeLogRef = doc(
        db,
        "users",
        input.clientUserId,
        "inventoryChangeLogs",
        `${requestRef.id}_${row.productId}`
      );
      const service = serviceLabelForRequest(input.requestData);
      const packOf = effectivePackOfForShipment(input.requestData, row.shipment, row.index);
      const boxesShipped = shipmentBoxes(row.shipment);
      transaction.set(changeLogRef, {
        inventoryId: row.productId,
        productName: currentInventory.productName,
        sku: currentInventory.sku ?? null,
        eventType: "outbound_awaiting_ship",
        qtyBefore: currentInventory.quantity,
        qtyAfter: applied.newQuantity,
        qtyChange: -row.totalUnits,
        shipmentRequestId: requestRef.id,
        shippedId: null,
        service,
        shipTo: null,
        packOf,
        boxesShipped,
        details: [
          outboundPackDetailsLine(boxesShipped, packOf),
          "Outbound awaiting ship",
          service ? `Service: ${service}` : "",
          applied.newStatus === "Out of Stock" ? "Now out of stock" : "",
        ]
          .filter(Boolean)
          .join(" · "),
        at: reservedAt,
      });

      reservedProductIds.push(row.productId);
    }

    const requestPayload: Record<string, unknown> = {
      ...input.requestData,
      status: input.requestData.status ?? "pending",
    };

    if (reservedProductIds.length > 0) {
      requestPayload.clientInventoryDeductionTiming = "create";
      requestPayload.clientInventoryDeductedAt = reservedAt;
    }

    transaction.set(requestRef, removeUndefined(requestPayload) as Record<string, unknown>);
  });

  return { requestId: requestRef.id, reservedProductIds };
}

/** Open outbound statuses eligible for reserve backfill (not finished). */
export const OPEN_OUTBOUND_STATUSES_FOR_RESERVE_BACKFILL = new Set([
  "pending",
  "awaiting_label_upload",
  "awaiting_label",
  "confirmed",
]);

export function isOpenOutboundEligibleForReserveBackfill(
  data: Record<string, unknown>
): boolean {
  const status = String(data.status || "").toLowerCase();
  if (!OPEN_OUTBOUND_STATUSES_FOR_RESERVE_BACKFILL.has(status)) return false;
  if (data.warehouseDispatchStatus === "dispatched") return false;
  return true;
}

export type ReserveBackfillItemResult = {
  requestId: string;
  outcome:
    | "reserved"
    | "skipped_already_reserved"
    | "skipped_not_open"
    | "skipped_no_deductible_lines"
    | "failed";
  error?: string;
  reservedProductIds?: string[];
};

/**
 * Reserve client sellable qty for one existing open outbound that predates create-time reserve.
 * Only pending / awaiting_label_upload / confirmed (and not dispatched). Idempotent.
 */
export async function reserveClientInventoryForExistingOpenOutbound(input: {
  clientUserId: string;
  shipmentRequestId: string;
}): Promise<ReserveBackfillItemResult & { shopifyHints: ShopifyInventorySyncHint[] }> {
  const requestRef = doc(
    db,
    `users/${input.clientUserId}/shipmentRequests`,
    input.shipmentRequestId
  );
  const shopifyHints: ShopifyInventorySyncHint[] = [];
  let outcome: ReserveBackfillItemResult["outcome"] = "failed";
  let reservedProductIds: string[] = [];
  let error: string | undefined;

  try {
    await runTransaction(db, async (transaction) => {
      const requestSnap = await transaction.get(requestRef);
      if (!requestSnap.exists()) throw new Error("Order not found.");

      const data = requestSnap.data() as Record<string, unknown>;
      if (hasClientInventoryDeducted(data)) {
        outcome = "skipped_already_reserved";
        return;
      }
      if (!isOpenOutboundEligibleForReserveBackfill(data)) {
        outcome = "skipped_not_open";
        return;
      }
      if (
        data.crossdockFulfillment === true ||
        String(data.crossdockLinkedUnitId ?? "").trim()
      ) {
        outcome = "skipped_no_deductible_lines";
        return;
      }

      const shipments = Array.isArray(data.shipments)
        ? (data.shipments as Array<Record<string, unknown>>)
        : [];
      const deductible = shipments
        .map((shipment, index) => ({ shipment, index }))
        .filter(({ shipment }) => !shipmentLineIsPrepOnly(shipment));

      if (deductible.length === 0) {
        outcome = "skipped_no_deductible_lines";
        return;
      }

      const inventoryReads = await Promise.all(
        deductible.map(async ({ shipment, index }) => {
          const productId = String(shipment.productId ?? "").trim();
          if (!productId) throw new Error("Missing product on shipment line.");
          const inventoryRef = doc(db, `users/${input.clientUserId}/inventory`, productId);
          const inventorySnap = await transaction.get(inventoryRef);
          if (!inventorySnap.exists()) {
            throw new Error(`Product ${productId} not found in inventory.`);
          }
          return {
            shipment,
            index,
            productId,
            inventoryRef,
            inventorySnap,
            totalUnits: shipmentUnits(data, shipment, index),
          };
        })
      );

      const reservedAt = Timestamp.now();
      const service = serviceLabelForRequest(data);

      for (const row of inventoryReads) {
        const currentInventory = row.inventorySnap.data() as Omit<InventoryItem, "id">;
        if (currentInventory.quantity < row.totalUnits) {
          throw new Error(
            `Not enough stock for ${currentInventory.productName}. Available: ${currentInventory.quantity}, Requested: ${row.totalUnits}.`
          );
        }

        const selectedSourceLocationId = String(
          (row.shipment as Record<string, unknown>).sourceLocationId || ""
        ).trim();
        const applied = applyLocationDeduction(
          currentInventory,
          row.totalUnits,
          selectedSourceLocationId
        );

        transaction.update(row.inventoryRef, {
          quantity: applied.newQuantity,
          status: applied.newStatus,
          locationId: applied.nextPrimaryLocationId,
          locationQuantities: applied.locationQuantities,
        });

        const changeLogRef = doc(
          db,
          "users",
          input.clientUserId,
          "inventoryChangeLogs",
          `${input.shipmentRequestId}_${row.productId}`
        );
        const packOf = effectivePackOfForShipment(data, row.shipment, row.index);
        const boxesShipped = shipmentBoxes(row.shipment);
        transaction.set(changeLogRef, {
          inventoryId: row.productId,
          productName: currentInventory.productName,
          sku: currentInventory.sku ?? null,
          eventType: "outbound_awaiting_ship",
          qtyBefore: currentInventory.quantity,
          qtyAfter: applied.newQuantity,
          qtyChange: -row.totalUnits,
          shipmentRequestId: input.shipmentRequestId,
          shippedId: null,
          service,
          shipTo: null,
          packOf,
          boxesShipped,
          details: [
            outboundPackDetailsLine(boxesShipped, packOf),
            "Outbound awaiting ship (legacy open-request reserve)",
            service ? `Service: ${service}` : "",
            applied.newStatus === "Out of Stock" ? "Now out of stock" : "",
          ]
            .filter(Boolean)
            .join(" · "),
          at: reservedAt,
        });

        reservedProductIds.push(row.productId);

        if (
          currentInventory.source === "shopify" &&
          currentInventory.shop &&
          currentInventory.shopifyVariantId
        ) {
          shopifyHints.push({
            productId: row.productId,
            newQuantity: applied.newQuantity,
            source: currentInventory.source,
            shop: currentInventory.shop,
            shopifyVariantId: currentInventory.shopifyVariantId,
            shopifyInventoryItemId: currentInventory.shopifyInventoryItemId,
          });
        }
        if (
          currentInventory.source === "woocommerce" &&
          currentInventory.woocommerceConnectionId &&
          currentInventory.woocommerceProductId
        ) {
          shopifyHints.push({
            productId: row.productId,
            newQuantity: applied.newQuantity,
            source: currentInventory.source,
            woocommerceConnectionId: currentInventory.woocommerceConnectionId,
            woocommerceProductId: currentInventory.woocommerceProductId,
            woocommerceVariationId: currentInventory.woocommerceVariationId,
          });
        }
        if (
          currentInventory.source === "tiktok" &&
          currentInventory.tiktokProductId &&
          currentInventory.tiktokSkuId &&
          (currentInventory.tiktokConnectionId || currentInventory.tiktokShopId)
        ) {
          shopifyHints.push({
            productId: row.productId,
            newQuantity: applied.newQuantity,
            source: currentInventory.source,
            tiktokConnectionId: currentInventory.tiktokConnectionId,
            tiktokProductId: currentInventory.tiktokProductId,
            tiktokSkuId: currentInventory.tiktokSkuId,
            tiktokShopId: currentInventory.tiktokShopId,
          });
        }
        if (
          currentInventory.source === "ebay" &&
          currentInventory.ebayConnectionId &&
          (currentInventory.ebayOfferId || currentInventory.ebayListingId)
        ) {
          shopifyHints.push({
            productId: row.productId,
            newQuantity: applied.newQuantity,
            source: currentInventory.source,
            ebayConnectionId: currentInventory.ebayConnectionId,
            ebayOfferId: currentInventory.ebayOfferId,
            ebayListingId: currentInventory.ebayListingId,
          });
        }
      }

      transaction.update(requestRef, {
        clientInventoryDeductionTiming: "create",
        clientInventoryDeductedAt: reservedAt,
        clientInventoryReserveBackfilledAt: reservedAt,
      });
      outcome = "reserved";
    });
  } catch (e) {
    outcome = "failed";
    error = e instanceof Error ? e.message : "Reserve backfill failed.";
  }

  return {
    requestId: input.shipmentRequestId,
    outcome,
    error,
    reservedProductIds: reservedProductIds.length ? reservedProductIds : undefined,
    shopifyHints,
  };
}

/**
 * Backfill create-time reserve for all open outbounds for one client.
 * Only pending / awaiting_label_upload / confirmed and not yet dispatched.
 */
export async function backfillClientInventoryReserveForOpenOutbounds(input: {
  clientUserId: string;
}): Promise<{
  reserved: number;
  skipped: number;
  failed: number;
  results: ReserveBackfillItemResult[];
  shopifyHints: ShopifyInventorySyncHint[];
}> {
  const snap = await getDocs(collection(db, `users/${input.clientUserId}/shipmentRequests`));
  const results: ReserveBackfillItemResult[] = [];
  const shopifyHints: ShopifyInventorySyncHint[] = [];
  let reserved = 0;
  let skipped = 0;
  let failed = 0;

  for (const reqDoc of snap.docs) {
    const data = reqDoc.data() as Record<string, unknown>;
    if (hasClientInventoryDeducted(data)) {
      results.push({ requestId: reqDoc.id, outcome: "skipped_already_reserved" });
      skipped += 1;
      continue;
    }
    if (!isOpenOutboundEligibleForReserveBackfill(data)) {
      results.push({ requestId: reqDoc.id, outcome: "skipped_not_open" });
      skipped += 1;
      continue;
    }

    const item = await reserveClientInventoryForExistingOpenOutbound({
      clientUserId: input.clientUserId,
      shipmentRequestId: reqDoc.id,
    });
    results.push({
      requestId: item.requestId,
      outcome: item.outcome,
      error: item.error,
      reservedProductIds: item.reservedProductIds,
    });
    shopifyHints.push(...item.shopifyHints);
    if (item.outcome === "reserved") reserved += 1;
    else if (item.outcome === "failed") failed += 1;
    else skipped += 1;
  }

  return { reserved, skipped, failed, results, shopifyHints };
}

/**
 * Restore client sellable inventory when an outbound request is cancelled or rejected
 * before warehouse dispatch. Idempotent when inventory was never reserved.
 */
export async function restoreClientInventoryForOutboundRequest(input: {
  clientUserId: string;
  shipmentRequestId: string;
  reason?: string;
}): Promise<ShopifyInventorySyncHint[]> {
  const requestRef = doc(db, `users/${input.clientUserId}/shipmentRequests`, input.shipmentRequestId);
  const shopifyHints: ShopifyInventorySyncHint[] = [];

  await runTransaction(db, async (transaction) => {
    const requestSnap = await transaction.get(requestRef);
    if (!requestSnap.exists()) throw new Error("Order not found.");

    const data = requestSnap.data() as Record<string, unknown>;
    if (!hasClientInventoryDeducted(data)) return;
    if (data.warehouseDispatchStatus === "dispatched") {
      throw new Error("Cannot restore inventory after dispatch.");
    }
    if (data.crossdockFulfillment === true || String(data.crossdockLinkedUnitId ?? "").trim()) {
      return;
    }

    const shipments = Array.isArray(data.shipments)
      ? (data.shipments as Array<Record<string, unknown>>)
      : [];
    const deductible = shipments
      .map((shipment, index) => ({ shipment, index }))
      .filter(({ shipment }) => !shipmentLineIsPrepOnly(shipment));

    const inventoryReads = await Promise.all(
      deductible.map(async ({ shipment, index }) => {
        const productId = String(shipment.productId ?? "").trim();
        if (!productId) return null;
        const inventoryRef = doc(db, `users/${input.clientUserId}/inventory`, productId);
        const inventorySnap = await transaction.get(inventoryRef);
        if (!inventorySnap.exists()) return null;
        return {
          shipment,
          index,
          productId,
          inventoryRef,
          inventorySnap,
          totalUnits: shipmentUnits(data, shipment, index),
        };
      })
    );

    const restoredAt = Timestamp.now();
    const service = serviceLabelForRequest(data);

    for (const row of inventoryReads) {
      if (!row) continue;
      const currentInventory = row.inventorySnap.data() as Omit<InventoryItem, "id">;
      const selectedSourceLocationId = String(
        (row.shipment as Record<string, unknown>).sourceLocationId || ""
      ).trim();
      const applied = applyLocationRestore(
        currentInventory,
        row.totalUnits,
        selectedSourceLocationId
      );

      transaction.update(row.inventoryRef, {
        quantity: applied.newQuantity,
        status: applied.newStatus,
        locationId: applied.nextPrimaryLocationId,
        locationQuantities: applied.locationQuantities,
      });

      const changeLogRef = doc(
        db,
        "users",
        input.clientUserId,
        "inventoryChangeLogs",
        `${input.shipmentRequestId}_${row.productId}_restored`
      );
      transaction.set(changeLogRef, {
        inventoryId: row.productId,
        productName: currentInventory.productName,
        sku: currentInventory.sku ?? null,
        eventType: "outbound_restored",
        qtyBefore: currentInventory.quantity,
        qtyAfter: applied.newQuantity,
        qtyChange: row.totalUnits,
        shipmentRequestId: input.shipmentRequestId,
        shippedId: null,
        service,
        shipTo: null,
        details: [
          "Outbound cancelled — stock restored",
          input.reason ? `Reason: ${input.reason}` : "",
          service ? `Service: ${service}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        at: restoredAt,
      });

      if (currentInventory.source === "shopify" && currentInventory.shop && currentInventory.shopifyVariantId) {
        shopifyHints.push({
          productId: row.productId,
          newQuantity: applied.newQuantity,
          source: currentInventory.source,
          shop: currentInventory.shop,
          shopifyVariantId: currentInventory.shopifyVariantId,
          shopifyInventoryItemId: currentInventory.shopifyInventoryItemId,
        });
      }
      if (
        currentInventory.source === "woocommerce" &&
        currentInventory.woocommerceConnectionId &&
        currentInventory.woocommerceProductId
      ) {
        shopifyHints.push({
          productId: row.productId,
          newQuantity: applied.newQuantity,
          source: currentInventory.source,
          woocommerceConnectionId: currentInventory.woocommerceConnectionId,
          woocommerceProductId: currentInventory.woocommerceProductId,
          woocommerceVariationId: currentInventory.woocommerceVariationId,
        });
      }
      if (
        currentInventory.source === "tiktok" &&
        currentInventory.tiktokProductId &&
        currentInventory.tiktokSkuId &&
        (currentInventory.tiktokConnectionId || currentInventory.tiktokShopId)
      ) {
        shopifyHints.push({
          productId: row.productId,
          newQuantity: applied.newQuantity,
          source: currentInventory.source,
          tiktokConnectionId: currentInventory.tiktokConnectionId,
          tiktokProductId: currentInventory.tiktokProductId,
          tiktokSkuId: currentInventory.tiktokSkuId,
          tiktokShopId: currentInventory.tiktokShopId,
        });
      }
      if (
        currentInventory.source === "ebay" &&
        currentInventory.ebayConnectionId &&
        (currentInventory.ebayOfferId || currentInventory.ebayListingId)
      ) {
        shopifyHints.push({
          productId: row.productId,
          newQuantity: applied.newQuantity,
          source: currentInventory.source,
          ebayConnectionId: currentInventory.ebayConnectionId,
          ebayOfferId: currentInventory.ebayOfferId,
          ebayListingId: currentInventory.ebayListingId,
        });
      }
    }

    transaction.update(requestRef, {
      clientInventoryDeductedAt: deleteField(),
      clientInventoryRestoredAt: restoredAt,
    });
  });

  return shopifyHints;
}

/** Deduct client inventory (if not already reserved) and create shipped record when warehouse dispatch completes. Idempotent. */
export async function applyClientInventoryOnDispatch(input: {
  clientUserId: string;
  shipmentRequestId: string;
  shippingDate?: Date | null;
}): Promise<ShopifyInventorySyncHint[]> {
  const requestRef = doc(db, `users/${input.clientUserId}/shipmentRequests`, input.shipmentRequestId);
  const logRef = doc(db, `users/${input.clientUserId}/outboundDispatchLogs`, input.shipmentRequestId);
  const shopifyHints: ShopifyInventorySyncHint[] = [];
  const oosInventoryIds: string[] = [];

  await runTransaction(db, async (transaction) => {
    const requestSnap = await transaction.get(requestRef);
    if (!requestSnap.exists()) throw new Error("Order not found.");

    const data = requestSnap.data() as Record<string, unknown>;
    if (data.status !== "confirmed") throw new Error("Order is not confirmed.");

    const logSnap = await transaction.get(logRef);
    if (logSnap.exists()) return;

    if (data.crossdockFulfillment === true || String(data.crossdockLinkedUnitId ?? "").trim()) {
      return;
    }

    const alreadyReserved = hasClientInventoryDeducted(data);
    // Legacy dispatch-timing orders still deduct here. Create-time reservations skip qty change.
    const shouldDeductInventory =
      !alreadyReserved &&
      (defersClientInventoryDeduction(data) || data.clientInventoryDeductionTiming == null);

    if (!alreadyReserved && !shouldDeductInventory) return;

    const shipments = Array.isArray(data.shipments)
      ? (data.shipments as Array<Record<string, unknown>>)
      : [];
    if (shipments.length === 0) throw new Error("Order has no line items.");

    const inventoryReads = await Promise.all(
      shipments.map(async (shipment, index) => {
        const productId = String(shipment.productId ?? "").trim();
        if (!productId) throw new Error("Missing product on shipment line.");
        const inventoryRef = doc(db, `users/${input.clientUserId}/inventory`, productId);
        const inventorySnap = await transaction.get(inventoryRef);
        if (!inventorySnap.exists()) {
          throw new Error(`Product ${productId} not found in inventory.`);
        }
        return {
          shipment,
          index,
          inventoryRef,
          inventorySnap,
          totalUnits: shipmentUnits(data, shipment, index),
        };
      })
    );

    const isCustom = isCustomProductRequest(data);
    const customPricing = data.adminCustomProductPricing as
      | Record<number, { unitPrice?: number; packOf?: number; packOfPrice?: number }>
      | undefined;
    const adminAdditionalServices = (data.adminAdditionalServices as Record<string, unknown>) ?? {};
    const allItems: Array<Record<string, unknown>> = [];
    let totalBoxes = 0;
    let totalUnits = 0;
    const shippedRef = doc(collection(db, `users/${input.clientUserId}/shipped`));
    const service = serviceLabelForRequest(data);
    const shipTo = data.shipTo != null ? String(data.shipTo) : null;
    const dispatchedAt = Timestamp.now();

    for (const row of inventoryReads) {
      const currentInventory = row.inventorySnap.data() as Omit<InventoryItem, "id">;
      const totalUnitsShipped = row.totalUnits;
      const selectedSourceLocationId = String(
        (row.shipment as Record<string, unknown>).sourceLocationId || ""
      ).trim();
      const productId = String(row.shipment.productId ?? "").trim();

      let remainingQty = currentInventory.quantity;

      if (shouldDeductInventory) {
        if (currentInventory.quantity < totalUnitsShipped) {
          throw new Error(
            `Not enough stock for ${currentInventory.productName}. Available: ${currentInventory.quantity}, Requested: ${totalUnitsShipped}.`
          );
        }

        const applied = applyLocationDeduction(
          currentInventory,
          totalUnitsShipped,
          selectedSourceLocationId
        );
        remainingQty = applied.newQuantity;

        if (applied.newStatus === "Out of Stock" && productId) {
          oosInventoryIds.push(productId);
        }

        transaction.update(row.inventoryRef, {
          quantity: applied.newQuantity,
          status: applied.newStatus,
          locationId: applied.nextPrimaryLocationId,
          locationQuantities: applied.locationQuantities,
        });

        const changeLogRef = doc(
          db,
          "users",
          input.clientUserId,
          "inventoryChangeLogs",
          `${input.shipmentRequestId}_${productId}`
        );
        transaction.set(changeLogRef, {
          inventoryId: productId,
          productName: currentInventory.productName,
          sku: currentInventory.sku ?? null,
          eventType: "outbound_dispatch",
          qtyBefore: currentInventory.quantity,
          qtyAfter: applied.newQuantity,
          qtyChange: -totalUnitsShipped,
          shipmentRequestId: input.shipmentRequestId,
          shippedId: shippedRef.id,
          service,
          shipTo,
          details: [
            `Outbound dispatch`,
            service ? `Service: ${service}` : "",
            shipTo ? `Ship to: ${shipTo}` : "",
            applied.newStatus === "Out of Stock" ? "Now out of stock" : "",
          ]
            .filter(Boolean)
            .join(" · "),
          at: dispatchedAt,
        });

        if (currentInventory.source === "shopify" && currentInventory.shop && currentInventory.shopifyVariantId) {
          shopifyHints.push({
            productId: String(row.shipment.productId),
            newQuantity: applied.newQuantity,
            source: currentInventory.source,
            shop: currentInventory.shop,
            shopifyVariantId: currentInventory.shopifyVariantId,
            shopifyInventoryItemId: currentInventory.shopifyInventoryItemId,
          });
        }

        if (
          currentInventory.source === "woocommerce" &&
          currentInventory.woocommerceConnectionId &&
          currentInventory.woocommerceProductId
        ) {
          shopifyHints.push({
            productId: String(row.shipment.productId),
            newQuantity: applied.newQuantity,
            source: currentInventory.source,
            woocommerceConnectionId: currentInventory.woocommerceConnectionId,
            woocommerceProductId: currentInventory.woocommerceProductId,
            woocommerceVariationId: currentInventory.woocommerceVariationId,
          });
        }

        if (
          currentInventory.source === "tiktok" &&
          currentInventory.tiktokProductId &&
          currentInventory.tiktokSkuId &&
          (currentInventory.tiktokConnectionId || currentInventory.tiktokShopId)
        ) {
          shopifyHints.push({
            productId: String(row.shipment.productId),
            newQuantity: applied.newQuantity,
            source: currentInventory.source,
            tiktokConnectionId: currentInventory.tiktokConnectionId,
            tiktokProductId: currentInventory.tiktokProductId,
            tiktokSkuId: currentInventory.tiktokSkuId,
            tiktokShopId: currentInventory.tiktokShopId,
          });
        }

        if (
          currentInventory.source === "ebay" &&
          currentInventory.ebayConnectionId &&
          (currentInventory.ebayOfferId || currentInventory.ebayListingId)
        ) {
          shopifyHints.push({
            productId: String(row.shipment.productId),
            newQuantity: applied.newQuantity,
            source: currentInventory.source,
            ebayConnectionId: currentInventory.ebayConnectionId,
            ebayOfferId: currentInventory.ebayOfferId,
            ebayListingId: currentInventory.ebayListingId,
          });
        }
      } else {
        // Already reserved at create — finalize history as dispatched without another qty change.
        const changeLogRef = doc(
          db,
          "users",
          input.clientUserId,
          "inventoryChangeLogs",
          `${input.shipmentRequestId}_${productId}`
        );
        transaction.set(
          changeLogRef,
          {
            eventType: "outbound_dispatch",
            shippedId: shippedRef.id,
            service,
            shipTo,
            details: [
              "Outbound dispatched",
              service ? `Service: ${service}` : "",
              shipTo ? `Ship to: ${shipTo}` : "",
              "(reserved at request create)",
            ]
              .filter(Boolean)
              .join(" · "),
            at: dispatchedAt,
          },
          { merge: true }
        );

        if (currentInventory.quantity <= 0 && productId) {
          oosInventoryIds.push(productId);
        }
      }

      let finalUnitPrice = Number(row.shipment.unitPrice) || 0;
      if (isCustom && customPricing?.[row.index]?.unitPrice) {
        finalUnitPrice = Number(customPricing[row.index].unitPrice) || finalUnitPrice;
      }
      const finalPackOf = effectivePackOfForShipment(data, row.shipment, row.index);
      const finalPackOfPrice =
        isCustom && customPricing?.[row.index]?.packOfPrice
          ? Number(customPricing[row.index].packOfPrice) || 0
          : 0;

      allItems.push({
        productId: row.shipment.productId,
        productName: currentInventory.productName,
        boxesShipped: row.shipment.quantity,
        shippedQty: totalUnitsShipped,
        packOf: finalPackOf,
        unitPrice: finalUnitPrice,
        packOfPrice: finalPackOfPrice,
        remainingQty,
        shippedFromLocationId: selectedSourceLocationId || "",
        sku: currentInventory.sku ?? row.shipment.sku ?? null,
        retailIdentifier: currentInventory.retailIdentifier ?? null,
      });

      totalBoxes += Math.max(0, Number(row.shipment.quantity) || 0);
      totalUnits += totalUnitsShipped;
    }

    const confirmedAt = timestampFromUnknown(data.confirmedAt);
    const createdAt = dispatchedAt;
    const firstProduct = inventoryReads[0]?.inventorySnap.data() as Omit<InventoryItem, "id"> | undefined;
    const firstRow = inventoryReads[0];
    const additionalServicesTotal = Number(adminAdditionalServices.total) || 0;

    const unitPrice = (() => {
      if (isCustom && customPricing) {
        let totalPrice = 0;
        inventoryReads.forEach((d) => {
          const price =
            customPricing[d.index]?.unitPrice && Number(customPricing[d.index].unitPrice) > 0
              ? Number(customPricing[d.index].unitPrice)
              : Number(d.shipment.unitPrice) || 0;
          totalPrice += price * (Number(d.shipment.quantity) || 0);
        });
        return totalBoxes > 0 ? totalPrice / totalBoxes : 0;
      }
      const weighted = inventoryReads.reduce((sum, d) => {
        return sum + (Number(d.shipment.unitPrice) || 0) * d.totalUnits;
      }, 0);
      return totalUnits > 0 ? weighted / totalUnits : 0;
    })();

    const shipmentDoc: Record<string, unknown> = {
      productName: firstProduct?.productName || "Multiple Products",
      date: input.shippingDate ? Timestamp.fromDate(input.shippingDate) : timestampFromUnknown(data.date),
      createdAt,
      shippedQty: totalUnits,
      boxesShipped: totalBoxes,
      unitsForPricing: totalBoxes,
      remainingQty: firstRow
        ? shouldDeductInventory
          ? (firstProduct?.quantity ?? 0) - firstRow.totalUnits
          : (firstProduct?.quantity ?? 0)
        : 0,
      packOf: firstRow ? effectivePackOfForShipment(data, firstRow.shipment, 0) : 1,
      unitPrice,
      packOfPrice: isCustom && customPricing?.[0]?.packOfPrice ? Number(customPricing[0].packOfPrice) || 0 : 0,
      remarks: String(data.adminRemarks ?? data.remarks ?? ""),
      service,
      productType: data.productType ?? "Standard",
      shipmentType: data.shipmentType ?? "product",
      labelUrl: data.labelUrl ?? "",
      customDimensions: data.customDimensions,
      customProductPricing: isCustom && customPricing ? customPricing : undefined,
      additionalServices: adminAdditionalServices,
      additionalServicesTotal,
      items: allItems,
      totalBoxes,
      totalUnits,
      totalSkus: inventoryReads.length,
      requestedBy: data.requestedBy,
      confirmedBy: data.confirmedBy,
      confirmedAt,
      shipmentRequestId: input.shipmentRequestId,
    };

    if (data.palletSubType) {
      shipmentDoc.palletSubType = data.palletSubType;
    }

    transaction.set(shippedRef, removeUndefined(shipmentDoc) as Record<string, unknown>);

    transaction.update(requestRef, {
      ...(shouldDeductInventory ? { clientInventoryDeductedAt: dispatchedAt } : {}),
      warehouseDispatchedClientSyncAt: dispatchedAt,
    });

    transaction.set(logRef, {
      shipmentRequestId: input.shipmentRequestId,
      shippedId: shippedRef.id,
      at: dispatchedAt,
      clientInventoryAlreadyReserved: alreadyReserved,
    });
  });

  for (const inventoryId of [...new Set(oosInventoryIds)]) {
    try {
      const { closeBillingPalletsForOutOfStockInventory } = await import(
        "@/lib/pallet-storage-receive-billing"
      );
      await closeBillingPalletsForOutOfStockInventory({
        userId: input.clientUserId,
        inventoryId,
      });
    } catch (err) {
      console.error("[applyClientInventoryOnDispatch] storage close failed", err);
    }
  }

  return shopifyHints;
}
