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
  /** Courier tracking from warehouse dispatch or marketplace fulfill. */
  courierTracking?: string;
  trackingCompany?: string;
  /** Marketplace channel on quick-fulfill shipped docs (shopify, ebay, amazon, …). */
  source?: string;
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
      sku: item.sku != null && String(item.sku).trim() ? String(item.sku).trim() : undefined,
      retailIdentifier:
        item.retailIdentifier != null && String(item.retailIdentifier).trim()
          ? String(item.retailIdentifier).trim()
          : undefined,
      shopifyLineTitle:
        item.shopifyLineTitle != null && String(item.shopifyLineTitle).trim()
          ? String(item.shopifyLineTitle).trim()
          : undefined,
      shopifyLineSku:
        item.shopifyLineSku != null && String(item.shopifyLineSku).trim()
          ? String(item.shopifyLineSku).trim()
          : undefined,
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
  const rootSku =
    (shipment as { sku?: unknown }).sku != null &&
    String((shipment as { sku?: unknown }).sku).trim()
      ? String((shipment as { sku?: unknown }).sku).trim()
      : undefined;

  return [
    {
      productName: shipment.productName || "Unknown Item",
      boxesShipped: fallbackBoxes,
      shippedQty: fallbackUnits,
      packOf: coerceNumber(shipment.packOf, 1),
      unitPrice: shipment.unitPrice,
      remainingQty: shipment.remainingQty,
      sku: rootSku,
      ...((shipment as { totalPrice?: unknown }).totalPrice != null
        ? { totalPrice: (shipment as { totalPrice?: unknown }).totalPrice }
        : {}),
    } as NormalizedShipmentItem,
  ];
}

/** One table row per SKU — expands multi-item `shipped` docs for list views. */
export type ShippedDisplayRow = ShippedItem & {
  displayRowId: string;
  /** Firestore parent doc when this row is a line from a multi-SKU shipment. */
  parentShippedItem?: ShippedItem;
};

export function expandShippedItemsForDisplay(items: ShippedItem[]): ShippedDisplayRow[] {
  const rows: ShippedDisplayRow[] = [];
  for (const item of items) {
    const lines = normalizeShipmentItems(item);
    if (lines.length <= 1) {
      const line = lines[0];
      rows.push({
        ...item,
        displayRowId: item.id,
        ...(line
          ? {
              productName: line.productName,
              shippedQty: line.shippedQty,
              boxesShipped: line.boxesShipped,
              packOf: line.packOf,
              unitPrice: line.unitPrice ?? item.unitPrice,
              remainingQty: line.remainingQty ?? item.remainingQty,
            }
          : {}),
      });
      continue;
    }
    lines.forEach((line, index) => {
      rows.push({
        ...item,
        displayRowId: `${item.id}-${line.productId || index}`,
        productName: line.productName,
        shippedQty: line.shippedQty,
        boxesShipped: line.boxesShipped,
        packOf: line.packOf,
        unitPrice: line.unitPrice ?? item.unitPrice,
        remainingQty: line.remainingQty ?? item.remainingQty,
        parentShippedItem: item,
      });
    });
  }
  return rows;
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

/** Resolve courier tracking from a shipped doc and/or linked outbound request. */
export function resolveShippedCourierTracking(input: {
  shipment?: ShippedItem | null;
  request?: Pick<ShipmentRequest, "warehouseCourierTracking"> | null;
}): { courierTracking?: string; trackingCompany?: string } {
  const fromRequest = String(input.request?.warehouseCourierTracking || "").trim();
  const fromShipped = String(input.shipment?.trackingNumber || "").trim();
  const company = String(input.shipment?.trackingCompany || "").trim();
  const courierTracking = fromRequest || fromShipped || undefined;
  return {
    ...(courierTracking ? { courierTracking } : {}),
    ...(company ? { trackingCompany: company } : {}),
  };
}

/** Build line items + totals for the shipped-order details dialog. */
export function buildShippedOrderDetails(
  shipment: ShippedItem,
  options?: {
    status?: string;
    dateLabel?: string;
    courierTracking?: string;
    trackingCompany?: string;
    source?: string;
    request?: Pick<ShipmentRequest, "warehouseCourierTracking"> | null;
  }
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
  const tracking = resolveShippedCourierTracking({
    shipment,
    request: options?.request,
  });
  const courierTracking =
    String(options?.courierTracking || "").trim() || tracking.courierTracking;
  const trackingCompany =
    String(options?.trackingCompany || "").trim() || tracking.trackingCompany;
  const source =
    String(options?.source || shipment.source || "").trim() || undefined;
  return {
    title: summary.title,
    dateLabel: options?.dateLabel,
    shipTo: shipment.shipTo,
    service: shipment.service,
    productType: shipment.productType,
    status: options?.status,
    remarks: shipment.remarks,
    ...(courierTracking ? { courierTracking } : {}),
    ...(trackingCompany ? { trackingCompany } : {}),
    ...(source ? { source } : {}),
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

/** Fill missing warehouse SKU / retail ID from live inventory (older shipped docs). */
export function enrichShippedOrderDetailsFromInventory(
  details: ShippedOrderDetails,
  inventory: Array<{ id: string; sku?: string | null; retailIdentifier?: string | null }>
): ShippedOrderDetails {
  if (!inventory?.length) return details;
  const byId = new Map(inventory.map((item) => [item.id, item]));
  return {
    ...details,
    lines: details.lines.map((line) => {
      const inv = line.productId ? byId.get(line.productId) : undefined;
      if (!inv) return line;
      return {
        ...line,
        sku: line.sku || (inv.sku != null && String(inv.sku).trim() ? String(inv.sku).trim() : undefined),
        retailIdentifier:
          line.retailIdentifier ||
          (inv.retailIdentifier != null && String(inv.retailIdentifier).trim()
            ? String(inv.retailIdentifier).trim()
            : undefined),
      };
    }),
  };
}

/** Normalized additional-services payload used on shipped docs and Create Invoice seeding. */
export type OutboundAdditionalServicesPayload = {
  bubbleWrapFeet?: number;
  stickerRemovalItems?: number;
  warningLabels?: number;
  pricePerFoot?: number;
  pricePerItem?: number;
  pricePerLabel?: number;
  total?: number;
  extraServiceQuantities?: Record<string, number>;
  extraServiceUnitPrices?: Record<string, number>;
};

function positiveInt(value: unknown): number {
  const n = Math.floor(coerceNumber(value));
  return n > 0 ? n : 0;
}

function hasOutboundAdditionalServices(
  add: OutboundAdditionalServicesPayload | null | undefined
): boolean {
  if (!add) return false;
  if (positiveInt(add.bubbleWrapFeet) > 0) return true;
  if (positiveInt(add.stickerRemovalItems) > 0) return true;
  if (positiveInt(add.warningLabels) > 0) return true;
  if (coerceNumber(add.total) > 0) return true;
  const extras = add.extraServiceQuantities;
  if (extras && typeof extras === "object") {
    return Object.values(extras).some((q) => positiveInt(q) > 0);
  }
  return false;
}

function normalizeOutboundAdditionalServices(
  raw: Record<string, unknown> | null | undefined
): OutboundAdditionalServicesPayload | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const extraRaw = raw.extraServiceQuantities;
  const extraPricesRaw = raw.extraServiceUnitPrices;
  const extraServiceQuantities: Record<string, number> = {};
  if (extraRaw && typeof extraRaw === "object" && !Array.isArray(extraRaw)) {
    Object.entries(extraRaw as Record<string, unknown>).forEach(([key, qty]) => {
      const n = positiveInt(qty);
      if (key && n > 0) extraServiceQuantities[key] = n;
    });
  }
  const extraServiceUnitPrices: Record<string, number> = {};
  if (extraPricesRaw && typeof extraPricesRaw === "object" && !Array.isArray(extraPricesRaw)) {
    Object.entries(extraPricesRaw as Record<string, unknown>).forEach(([key, price]) => {
      const n = coerceNumber(price);
      if (key && n > 0) extraServiceUnitPrices[key] = n;
    });
  }
  const payload: OutboundAdditionalServicesPayload = {
    bubbleWrapFeet: positiveInt(raw.bubbleWrapFeet) || undefined,
    stickerRemovalItems: positiveInt(raw.stickerRemovalItems) || undefined,
    warningLabels: positiveInt(raw.warningLabels) || undefined,
    pricePerFoot: coerceNumber(raw.pricePerFoot) || undefined,
    pricePerItem: coerceNumber(raw.pricePerItem) || undefined,
    pricePerLabel: coerceNumber(raw.pricePerLabel) || undefined,
    total: coerceNumber(raw.total) || undefined,
    ...(Object.keys(extraServiceQuantities).length > 0 ? { extraServiceQuantities } : {}),
    ...(Object.keys(extraServiceUnitPrices).length > 0 ? { extraServiceUnitPrices } : {}),
  };
  return hasOutboundAdditionalServices(payload) ? payload : undefined;
}

/**
 * Resolve additional services for invoice / CRM draft seeding.
 * Prefers admin-approved payload, then client request-level qty, then per-line qty maps.
 */
export function resolveOutboundAdditionalServicesPayload(
  source: unknown
): OutboundAdditionalServicesPayload | undefined {
  if (!source || typeof source !== "object") return undefined;
  const root = source as Record<string, unknown>;

  const approved =
    normalizeOutboundAdditionalServices(
      (root.additionalServices as Record<string, unknown> | undefined) || undefined
    ) ||
    normalizeOutboundAdditionalServices(
      (root.adminAdditionalServices as Record<string, unknown> | undefined) || undefined
    );
  if (approved) return approved;

  let bubble = positiveInt(root.bubbleWrapFeet);
  let sticker = positiveInt(root.stickerRemovalItems);
  let warning = positiveInt(root.warningLabels);
  const extras: Record<string, number> = {};

  const addKeyQty = (key: string, qty: number) => {
    const n = positiveInt(qty);
    if (!key || n <= 0) return;
    if (key === "bubbleWrap") bubble += n;
    else if (key === "stickerRemoval") sticker += n;
    else if (key === "warningLabels") warning += n;
    else extras[key] = (extras[key] || 0) + n;
  };

  const requestLevelSelected = Array.isArray(root.selectedAdditionalServices)
    ? (root.selectedAdditionalServices as unknown[]).map((k) => String(k || "").trim()).filter(Boolean)
    : [];
  // Request-level selected flags without explicit qty already counted via bubbleWrapFeet fields.
  requestLevelSelected.forEach((key) => {
    if (key === "bubbleWrap" && bubble <= 0) bubble = 1;
    else if (key === "stickerRemoval" && sticker <= 0) sticker = 1;
    else if (key === "warningLabels" && warning <= 0) warning = 1;
    else if (key !== "bubbleWrap" && key !== "stickerRemoval" && key !== "warningLabels") {
      if (!extras[key]) extras[key] = 1;
    }
  });

  const requestQtyMap =
    root.additionalServiceQuantities &&
    typeof root.additionalServiceQuantities === "object" &&
    !Array.isArray(root.additionalServiceQuantities)
      ? (root.additionalServiceQuantities as Record<string, unknown>)
      : null;
  if (requestQtyMap) {
    Object.entries(requestQtyMap).forEach(([key, qty]) => addKeyQty(key, qty as number));
  }

  const shipments = Array.isArray(root.shipments) ? root.shipments : [];
  shipments.forEach((raw) => {
    if (!raw || typeof raw !== "object") return;
    const line = raw as Record<string, unknown>;
    const qtyMap =
      line.additionalServiceQuantities &&
      typeof line.additionalServiceQuantities === "object" &&
      !Array.isArray(line.additionalServiceQuantities)
        ? (line.additionalServiceQuantities as Record<string, unknown>)
        : {};
    const selected = Array.isArray(line.selectedAdditionalServices)
      ? (line.selectedAdditionalServices as unknown[]).map((k) => String(k || "").trim()).filter(Boolean)
      : Object.keys(qtyMap);
    selected.forEach((key) => {
      const fromMap = positiveInt(qtyMap[key]);
      addKeyQty(key, fromMap > 0 ? fromMap : 1);
    });
  });

  const payload: OutboundAdditionalServicesPayload = {
    ...(bubble > 0 ? { bubbleWrapFeet: bubble } : {}),
    ...(sticker > 0 ? { stickerRemovalItems: sticker } : {}),
    ...(warning > 0 ? { warningLabels: warning } : {}),
    ...(Object.keys(extras).length > 0 ? { extraServiceQuantities: extras } : {}),
  };
  return hasOutboundAdditionalServices(payload) ? payload : undefined;
}

/** Attach catalog unit prices + total onto an additional-services payload. */
export function applyCatalogPricesToAdditionalServices(
  payload: OutboundAdditionalServicesPayload | undefined,
  priceForKey: (key: string) => number
): OutboundAdditionalServicesPayload | undefined {
  if (!payload) return undefined;
  const pricePerFoot = coerceNumber(payload.pricePerFoot) || priceForKey("bubbleWrap");
  const pricePerItem = coerceNumber(payload.pricePerItem) || priceForKey("stickerRemoval");
  const pricePerLabel = coerceNumber(payload.pricePerLabel) || priceForKey("warningLabels");
  const extraServiceUnitPrices: Record<string, number> = {
    ...(payload.extraServiceUnitPrices || {}),
  };
  const extras = payload.extraServiceQuantities || {};
  Object.keys(extras).forEach((key) => {
    if (!(coerceNumber(extraServiceUnitPrices[key]) > 0)) {
      const p = priceForKey(key);
      if (p > 0) extraServiceUnitPrices[key] = p;
    }
  });
  const bubble = positiveInt(payload.bubbleWrapFeet);
  const sticker = positiveInt(payload.stickerRemovalItems);
  const warning = positiveInt(payload.warningLabels);
  let total =
    bubble * pricePerFoot + sticker * pricePerItem + warning * pricePerLabel;
  Object.entries(extras).forEach(([key, qty]) => {
    total += positiveInt(qty) * coerceNumber(extraServiceUnitPrices[key]);
  });
  return {
    ...payload,
    ...(bubble > 0 ? { bubbleWrapFeet: bubble, pricePerFoot } : {}),
    ...(sticker > 0 ? { stickerRemovalItems: sticker, pricePerItem } : {}),
    ...(warning > 0 ? { warningLabels: warning, pricePerLabel } : {}),
    ...(Object.keys(extras).length > 0 ? { extraServiceQuantities: extras } : {}),
    ...(Object.keys(extraServiceUnitPrices).length > 0 ? { extraServiceUnitPrices } : {}),
    ...(total > 0 ? { total } : {}),
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
      sku: typeof s.sku === "string" && s.sku.trim() ? s.sku.trim() : undefined,
      retailIdentifier:
        typeof s.retailIdentifier === "string" && s.retailIdentifier.trim()
          ? s.retailIdentifier.trim()
          : undefined,
      shopifyLineTitle:
        typeof s.shopifyLineTitle === "string" && s.shopifyLineTitle.trim()
          ? s.shopifyLineTitle.trim()
          : undefined,
      shopifyLineSku:
        typeof s.shopifyLineSku === "string" && s.shopifyLineSku.trim()
          ? s.shopifyLineSku.trim()
          : undefined,
    } as ShipmentProductItem & { totalPrice?: number };
  });

  const first = items[0];
  const additionalServices = resolveOutboundAdditionalServicesPayload(req);
  const courierTracking = String(req.warehouseCourierTracking || "").trim();
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
    ...(courierTracking ? { trackingNumber: courierTracking } : {}),
    shipmentRequestId: req.id || undefined,
    ...(additionalServices
      ? { additionalServices: additionalServices as ShippedItem["additionalServices"] }
      : {}),
  };
}
