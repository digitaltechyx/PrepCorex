import type { ShippedItem, ShipmentProductItem, ShipmentRequest } from "@/types";

export interface NormalizedShipmentItem extends ShipmentProductItem {
  productName: string;
  boxesShipped: number;
  shippedQty: number;
  packOf: number;
}

export type ShippedOrderDetailLine = NormalizedShipmentItem & {
  unitPrice: number;
  lineTotal: number;
};

export type ShippedOrderDetails = {
  title: string;
  dateLabel?: string;
  shipTo?: string;
  service?: string;
  productType?: string;
  status?: string;
  remarks?: string;
  lines: ShippedOrderDetailLine[];
  totalBoxes: number;
  totalUnits: number;
  totalSkus: number;
  productsTotal: number;
  additionalServicesTotal: number;
  additionalServiceLines: string[];
  shipmentTotal: number;
};

function coerceNumber(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function normalizeShipmentItems(shipment: ShippedItem): NormalizedShipmentItem[] {
  if (shipment.items && shipment.items.length > 0) {
    return shipment.items.map((item) => ({
      productId: item.productId,
      productName: item.productName || "Unknown Item",
      boxesShipped: coerceNumber(item.boxesShipped),
      shippedQty: coerceNumber(item.shippedQty),
      packOf: coerceNumber(item.packOf, 1),
      unitPrice: item.unitPrice,
      remainingQty: item.remainingQty,
      ...(typeof (item as { totalPrice?: unknown }).totalPrice !== "undefined"
        ? { totalPrice: (item as { totalPrice?: unknown }).totalPrice }
        : {}),
    })) as NormalizedShipmentItem[];
  }

  const fallbackBoxes =
    coerceNumber((shipment as { boxesShipped?: unknown })?.boxesShipped) ||
    coerceNumber(shipment.unitsForPricing) ||
    coerceNumber(shipment.shippedQty);
  const fallbackUnits = coerceNumber(shipment.shippedQty, fallbackBoxes);

  return [
    {
      productName: shipment.productName || "Unknown Item",
      boxesShipped: fallbackBoxes,
      shippedQty: fallbackUnits,
      packOf: coerceNumber(shipment.packOf, 1),
      unitPrice: shipment.unitPrice,
      remainingQty: shipment.remainingQty,
      ...((shipment as { totalPrice?: unknown }).totalPrice != null
        ? { totalPrice: (shipment as { totalPrice?: unknown }).totalPrice }
        : {}),
    } as NormalizedShipmentItem,
  ];
}

export function getShipmentSummary(shipment: ShippedItem) {
  const items = normalizeShipmentItems(shipment);
  const totalBoxes = items.reduce((sum, item) => sum + (item.boxesShipped || 0), 0);
  const totalUnits = items.reduce((sum, item) => sum + (item.shippedQty || 0), 0);
  const totalSkus = items.length;

  const code = String(
    (shipment as ShippedItem & { crossdockUnitCode?: string | null }).crossdockUnitCode || ""
  ).trim();
  const primaryName = items[0]?.productName || shipment.productName || "Shipment";
  const title =
    code && !primaryName.includes(code)
      ? totalSkus <= 1
        ? `${code} · ${primaryName}`
        : `${code} · ${primaryName} + ${totalSkus - 1} more`
      : totalSkus <= 1
        ? primaryName
        : `${primaryName} + ${totalSkus - 1} more`;

  return {
    items,
    totalBoxes,
    totalUnits,
    totalSkus,
    title,
    primaryPackOf: totalSkus === 1 ? items[0]?.packOf : undefined,
  };
}

function additionalServicesBreakdown(add: ShippedItem["additionalServices"] | null | undefined): {
  lines: string[];
  total: number;
} {
  if (!add) return { lines: [], total: 0 };
  const lines: string[] = [];
  const bubble = coerceNumber(add.bubbleWrapFeet);
  const sticker = coerceNumber(add.stickerRemovalItems);
  const warning = coerceNumber(add.warningLabels);
  if (bubble > 0) {
    lines.push(
      `Bubble wrap: ${bubble} ft` +
        (add.pricePerFoot ? ` × $${coerceNumber(add.pricePerFoot).toFixed(2)}` : "")
    );
  }
  if (sticker > 0) {
    lines.push(
      `Sticker removal: ${sticker} items` +
        (add.pricePerItem ? ` × $${coerceNumber(add.pricePerItem).toFixed(2)}` : "")
    );
  }
  if (warning > 0) {
    lines.push(
      `Warning labels: ${warning}` +
        (add.pricePerLabel ? ` × $${coerceNumber(add.pricePerLabel).toFixed(2)}` : "")
    );
  }
  let total = coerceNumber(add.total);
  if (total <= 0) {
    total =
      bubble * coerceNumber(add.pricePerFoot) +
      sticker * coerceNumber(add.pricePerItem) +
      warning * coerceNumber(add.pricePerLabel);
  }
  return { lines, total };
}

function lineMoney(item: NormalizedShipmentItem & { totalPrice?: unknown }): {
  unitPrice: number;
  lineTotal: number;
} {
  const boxes = coerceNumber(item.boxesShipped);
  const unitPrice = coerceNumber(item.unitPrice);
  const explicitTotal = coerceNumber(item.totalPrice);
  if (explicitTotal > 0) {
    return {
      unitPrice: unitPrice > 0 ? unitPrice : boxes > 0 ? explicitTotal / boxes : 0,
      lineTotal: explicitTotal,
    };
  }
  return { unitPrice, lineTotal: unitPrice * boxes };
}

/** Build line items + totals for the shipped-order details dialog. */
export function buildShippedOrderDetails(
  shipment: ShippedItem,
  options?: { status?: string; dateLabel?: string }
): ShippedOrderDetails {
  const summary = getShipmentSummary(shipment);
  const lines: ShippedOrderDetailLine[] = summary.items.map((item) => {
    const money = lineMoney(item as NormalizedShipmentItem & { totalPrice?: unknown });
    return {
      ...item,
      unitPrice: money.unitPrice,
      lineTotal: money.lineTotal,
    };
  });
  const productsTotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const add = additionalServicesBreakdown(shipment.additionalServices);
  return {
    title: summary.title,
    dateLabel: options?.dateLabel,
    shipTo: shipment.shipTo,
    service: shipment.service,
    productType: shipment.productType,
    status: options?.status,
    remarks: shipment.remarks,
    lines,
    totalBoxes: summary.totalBoxes,
    totalUnits: summary.totalUnits,
    totalSkus: summary.totalSkus,
    productsTotal,
    additionalServicesTotal: add.total,
    additionalServiceLines: add.lines,
    shipmentTotal: productsTotal + add.total,
  };
}

/** Map an outbound request into a ShippedItem-shaped payload for details. */
export function shippedItemFromShipmentRequest(req: ShipmentRequest): ShippedItem {
  const items = (req.shipments || []).map((raw) => {
    const s = raw as Record<string, unknown>;
    const quantity = coerceNumber(s.quantity ?? s.boxesShipped, 1);
    const packOf = coerceNumber(s.packOf, 1);
    const shippedQty = coerceNumber(s.shippedQty, quantity * packOf);
    return {
      productId: typeof s.productId === "string" ? s.productId : undefined,
      productName: String(s.productName ?? "").trim() || "Unknown Product",
      boxesShipped: quantity,
      shippedQty,
      packOf,
      unitPrice: coerceNumber(s.unitPrice),
      totalPrice: coerceNumber(s.totalPrice),
    } as ShipmentProductItem & { totalPrice?: number };
  });

  const first = items[0];
  return {
    id: req.id || "request",
    productName: first?.productName,
    date: (req.date || req.requestedAt || "") as ShippedItem["date"],
    shipTo: req.shipTo || "",
    remarks: req.remarks,
    service: req.service,
    productType: req.productType,
    shipmentPreference: req.shipmentPreference,
    items,
    boxesShipped: first?.boxesShipped,
    shippedQty: first?.shippedQty,
    packOf: first?.packOf,
    unitPrice: first?.unitPrice,
    additionalServices: (req as { additionalServices?: ShippedItem["additionalServices"] })
      .additionalServices,
  };
}
