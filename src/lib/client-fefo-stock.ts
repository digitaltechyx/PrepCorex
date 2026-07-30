export type ClientFefoStockRow = {
  key: string;
  sku: string;
  productTitle: string;
  expiry: string;
  quantity: number;
  expired: boolean;
};

export type RawClientInventoryDoc = {
  id: string;
  data: Record<string, unknown>;
};

export type RawClientInboundRequestDoc = {
  id: string;
  data: Record<string, unknown>;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

export function fefoExpiryIso(value: unknown): string | null {
  if (!value) return null;
  let date: Date | null = null;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "string") {
    date = new Date(value);
  } else if (typeof value === "object" && value !== null) {
    const timestamp = value as { seconds?: unknown; toDate?: () => Date };
    if (typeof timestamp.toDate === "function") date = timestamp.toDate();
    else if (Number.isFinite(Number(timestamp.seconds))) {
      date = new Date(Number(timestamp.seconds) * 1000);
    }
  }
  if (!date || Number.isNaN(date.getTime())) return null;
  return todayIso(date);
}

function todayIso(today: Date): string {
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Reconstructs current FEFO batches from the user's own inventory and approved
 * inbound requests. Current quantity is allocated against the oldest expiry
 * batches first, so shipped stock is removed in FEFO order.
 */
export function buildClientFefoStockRows(
  inventoryDocs: RawClientInventoryDoc[],
  requestDocs: RawClientInboundRequestDoc[],
  today = new Date()
): ClientFefoStockRow[] {
  type InventoryGroup = {
    key: string;
    sku: string;
    productTitle: string;
    quantity: number;
    fallbackExpiries: Array<{ expiry: string; quantity: number }>;
    inventoryIds: Set<string>;
  };

  const inventoryGroups = new Map<string, InventoryGroup>();
  const groupByInventoryId = new Map<string, InventoryGroup>();
  const groupByProductName = new Map<string, InventoryGroup>();
  const currentDate = todayIso(today);

  for (const inventoryDoc of inventoryDocs) {
    const data = inventoryDoc.data;
    const quantity = Math.max(0, Number(data.quantity) || 0);
    if (quantity <= 0) continue;
    const sku = text(data.sku);
    const productTitle = text(data.productName) || sku || "Inventory item";
    const groupKey = sku ? `sku:${sku.toLowerCase()}` : `name:${productTitle.toLowerCase()}`;
    let group = inventoryGroups.get(groupKey);
    if (!group) {
      group = {
        key: groupKey,
        sku: sku || "—",
        productTitle,
        quantity: 0,
        fallbackExpiries: [],
        inventoryIds: new Set(),
      };
      inventoryGroups.set(groupKey, group);
    }
    group.quantity += quantity;
    group.inventoryIds.add(inventoryDoc.id);
    groupByInventoryId.set(inventoryDoc.id, group);
    groupByProductName.set(productTitle.toLowerCase(), group);
    const expiry = fefoExpiryIso(data.expiryDate);
    if (expiry) group.fallbackExpiries.push({ expiry, quantity });
  }

  const batchesByGroup = new Map<string, Map<string, number>>();
  for (const requestDoc of requestDocs) {
    const data = requestDoc.data;
    if (text(data.status).toLowerCase() !== "approved") continue;
    const expiry = fefoExpiryIso(data.expiryDate);
    if (!expiry) continue;

    const productId = text(data.productId);
    const requestSku = text(data.sku);
    const requestName = text(data.productName);
    const group =
      (productId ? groupByInventoryId.get(productId) : undefined) ||
      (requestSku ? inventoryGroups.get(`sku:${requestSku.toLowerCase()}`) : undefined) ||
      (requestName ? groupByProductName.get(requestName.toLowerCase()) : undefined);
    if (!group) continue;

    const usesWarehouseWorkflow =
      Number(data.inboundWorkflowVersion) >= 2 || text(data.fulfillmentStatus) === "open";
    const batchQuantity = Math.max(
      0,
      usesWarehouseWorkflow
        ? Number(data.warehouseGoodReceivedQty) || 0
        : Number(data.receivedQuantity) || Number(data.quantity) || 0
    );
    if (batchQuantity <= 0) continue;
    const groupBatches = batchesByGroup.get(group.key) || new Map<string, number>();
    groupBatches.set(expiry, (groupBatches.get(expiry) || 0) + batchQuantity);
    batchesByGroup.set(group.key, groupBatches);
  }

  const rows: ClientFefoStockRow[] = [];
  for (const group of inventoryGroups.values()) {
    let remaining = group.quantity;
    const requestBatches = batchesByGroup.get(group.key) || new Map<string, number>();
    const candidates = new Map(requestBatches);
    const requestTotal = Array.from(requestBatches.values()).reduce(
      (sum, quantity) => sum + quantity,
      0
    );
    let fallbackNeeded = Math.max(0, group.quantity - requestTotal);
    for (const fallback of group.fallbackExpiries.sort((a, b) =>
      a.expiry.localeCompare(b.expiry)
    )) {
      if (fallbackNeeded <= 0) break;
      const quantity = Math.min(fallbackNeeded, fallback.quantity);
      candidates.set(fallback.expiry, (candidates.get(fallback.expiry) || 0) + quantity);
      fallbackNeeded -= quantity;
    }

    for (const [expiry, batchQuantity] of Array.from(candidates).sort(([a], [b]) =>
      a.localeCompare(b)
    )) {
      if (remaining <= 0) break;
      const quantity = Math.min(remaining, batchQuantity);
      rows.push({
        key: `${group.key}|${expiry}`,
        sku: group.sku,
        productTitle: group.productTitle,
        expiry,
        quantity,
        expired: expiry < currentDate,
      });
      remaining -= quantity;
    }
  }

  return rows.sort(
    (a, b) =>
      a.expiry.localeCompare(b.expiry) ||
      a.productTitle.localeCompare(b.productTitle)
  );
}
