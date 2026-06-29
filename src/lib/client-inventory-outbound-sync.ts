import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { InventoryItem } from "@/types";

export type ClientInventoryDeductionTiming = "confirm" | "dispatch";

export type ShopifyInventorySyncHint = {
  productId: string;
  newQuantity: number;
  shop?: string;
  shopifyVariantId?: string;
  shopifyInventoryItemId?: string;
  source?: string;
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

function shipmentUnits(data: Record<string, unknown>, shipment: Record<string, unknown>, index: number): number {
  const qty = Math.max(0, Math.floor(Number(shipment.quantity) || 0));
  return qty * effectivePackOfForShipment(data, shipment, index);
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
    if (data.clientInventoryDeductionTiming !== "dispatch") continue;
    if (data.clientInventoryDeductedAt) continue;
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

/** Deduct client inventory and create shipped record when warehouse dispatch completes. Idempotent. */
export async function applyClientInventoryOnDispatch(input: {
  clientUserId: string;
  shipmentRequestId: string;
  shippingDate?: Date | null;
}): Promise<ShopifyInventorySyncHint[]> {
  const requestRef = doc(db, `users/${input.clientUserId}/shipmentRequests`, input.shipmentRequestId);
  const logRef = doc(db, `users/${input.clientUserId}/outboundDispatchLogs`, input.shipmentRequestId);
  const shopifyHints: ShopifyInventorySyncHint[] = [];

  await runTransaction(db, async (transaction) => {
    const requestSnap = await transaction.get(requestRef);
    if (!requestSnap.exists()) throw new Error("Order not found.");

    const data = requestSnap.data() as Record<string, unknown>;
    if (data.status !== "confirmed") throw new Error("Order is not confirmed.");

    const logSnap = await transaction.get(logRef);
    if (logSnap.exists()) return;

    if (!defersClientInventoryDeduction(data)) return;
    if (data.crossdockFulfillment === true || String(data.crossdockLinkedUnitId ?? "").trim()) {
      return;
    }

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

      if (currentInventory.quantity < totalUnitsShipped) {
        throw new Error(
          `Not enough stock for ${currentInventory.productName}. Available: ${currentInventory.quantity}, Requested: ${totalUnitsShipped}.`
        );
      }

      const selectedSourceLocationId = String((row.shipment as Record<string, unknown>).sourceLocationId || "").trim();
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

      const newQuantity = currentInventory.quantity - totalUnitsShipped;
      const newStatus = newQuantity > 0 ? "In Stock" : "Out of Stock";

      if (hasTrackedLocations && selectedSourceLocationId) {
        const currentSourceQty = Number(locationQuantities[selectedSourceLocationId] || 0);
        locationQuantities[selectedSourceLocationId] = Math.max(0, currentSourceQty - totalUnitsShipped);
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

      transaction.update(row.inventoryRef, {
        quantity: newQuantity,
        status: newStatus,
        locationId: nextPrimaryLocationId,
        locationQuantities,
      });

      const productId = String(row.shipment.productId ?? "").trim();
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
        qtyAfter: newQuantity,
        qtyChange: -totalUnitsShipped,
        shipmentRequestId: input.shipmentRequestId,
        shippedId: shippedRef.id,
        service,
        shipTo,
        details: [
          `Outbound dispatch`,
          service ? `Service: ${service}` : "",
          shipTo ? `Ship to: ${shipTo}` : "",
          newStatus === "Out of Stock" ? "Now out of stock" : "",
        ]
          .filter(Boolean)
          .join(" · "),
        at: dispatchedAt,
      });

      if (currentInventory.source === "shopify" && currentInventory.shop && currentInventory.shopifyVariantId) {
        shopifyHints.push({
          productId: String(row.shipment.productId),
          newQuantity,
          source: currentInventory.source,
          shop: currentInventory.shop,
          shopifyVariantId: currentInventory.shopifyVariantId,
          shopifyInventoryItemId: currentInventory.shopifyInventoryItemId,
        });
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
        remainingQty: newQuantity,
        shippedFromLocationId: selectedSourceLocationId || "",
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
        ? (firstProduct?.quantity ?? 0) - firstRow.totalUnits
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
      clientInventoryDeductedAt: dispatchedAt,
    });

    transaction.set(logRef, {
      shipmentRequestId: input.shipmentRequestId,
      shippedId: shippedRef.id,
      at: dispatchedAt,
    });
  });

  return shopifyHints;
}
