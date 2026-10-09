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

export type RawClientReceiveLogDoc = {
  id: string;
  data: Record<string, unknown>;
};

function text(value: string | unknown): string {
  return String(value ?? "").trim();
}

export function fefoExpiryIso(value: unknown): string | null {
  if (!value) return null;
  let date: Date | null = null;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    date = new Date(trimmed.includes("T") ? trimmed : `${trimmed}T12:00:00`);
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

function addBatchQty(target: Map<string, number>, expiry: string, quantity: number) {
  const qty = Math.max(0, Math.floor(quantity));
  if (!expiry || qty <= 0) return;
  target.set(expiry, (target.get(expiry) || 0) + qty);
}

/**
 * Reconstructs current FEFO batches from the user's own inventory, receive logs,
 * and approved inbound requests.
 *
 * When stored batch totals exceed on-hand quantity (legacy ships that did not
 * reduce expiryBatches), leftover units are kept on the *newest* expiry dates —
 * i.e. FEFO already consumed the earliest lots. Live outbound now updates
 * expiryBatches directly, so totals usually match quantity.
 */
export function buildClientFefoStockRows(
  inventoryDocs: RawClientInventoryDoc[],
  requestDocs: RawClientInboundRequestDoc[],
  today = new Date(),
  receiveLogDocs: RawClientReceiveLogDoc[] = []
): ClientFefoStockRow[] {
  type InventoryGroup = {
    key: string;
    sku: string;
    productTitle: string;
    quantity: number;
    batchCandidates: Map<string, number>;
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
        batchCandidates: new Map(),
        fallbackExpiries: [],
        inventoryIds: new Set(),
      };
      inventoryGroups.set(groupKey, group);
    }
    group.quantity += quantity;
    group.inventoryIds.add(inventoryDoc.id);
    groupByInventoryId.set(inventoryDoc.id, group);
    groupByProductName.set(productTitle.toLowerCase(), group);

    // Preferred: explicit per-receive batches on the inventory doc.
    if (Array.isArray(data.expiryBatches)) {
      for (const raw of data.expiryBatches) {
        if (!raw || typeof raw !== "object") continue;
        const batch = raw as { expiry?: unknown; quantity?: unknown };
        const expiry = fefoExpiryIso(batch.expiry);
        const batchQty = Math.max(0, Number(batch.quantity) || 0);
        if (expiry && batchQty > 0) addBatchQty(group.batchCandidates, expiry, batchQty);
      }
    }

    const expiry = fefoExpiryIso(data.expiryDate);
    if (expiry) group.fallbackExpiries.push({ expiry, quantity });
  }

  // Receive logs are the ground truth for each putaway lot when available.
  for (const logDoc of receiveLogDocs) {
    const data = logDoc.data;
    const goodQty = Math.max(0, Number(data.goodQty) || 0);
    if (goodQty <= 0) continue;
    const expiry = fefoExpiryIso(data.expiry);
    if (!expiry) continue;

    const inventoryId = text(data.inventoryId);
    const requestSku = text(data.sku);
    const requestName = text(data.productName);
    const group =
      (inventoryId ? groupByInventoryId.get(inventoryId) : undefined) ||
      (requestSku ? inventoryGroups.get(`sku:${requestSku.toLowerCase()}`) : undefined) ||
      (requestName ? groupByProductName.get(requestName.toLowerCase()) : undefined);
    if (!group) continue;
    // Only add from logs when the inventory doc has no expiryBatches yet
    // (legacy stock). Otherwise batches already include these receives.
    if (group.batchCandidates.size > 0) continue;
    addBatchQty(group.batchCandidates, expiry, goodQty);
  }

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
    // Prefer inventory expiryBatches / receive logs when present.
    if (group.batchCandidates.size > 0) continue;

    const usesWarehouseWorkflow =
      Number(data.inboundWorkflowVersion) >= 2 ||
      ["open", "closed", "complete", "completed"].includes(
        text(data.fulfillmentStatus).toLowerCase()
      );
    const batchQuantity = Math.max(
      0,
      usesWarehouseWorkflow
        ? Number(data.warehouseGoodReceivedQty) || 0
        : Number(data.receivedQuantity) || Number(data.quantity) || 0
    );
    if (batchQuantity <= 0) continue;
    addBatchQty(group.batchCandidates, expiry, batchQuantity);
  }

  const rows: ClientFefoStockRow[] = [];
  for (const group of inventoryGroups.values()) {
    let remaining = group.quantity;
    const candidates = new Map(group.batchCandidates);
    const candidateTotal = Array.from(candidates.values()).reduce(
      (sum, quantity) => sum + quantity,
      0
    );
    let fallbackNeeded = Math.max(0, group.quantity - candidateTotal);
    for (const fallback of group.fallbackExpiries.sort((a, b) =>
      a.expiry.localeCompare(b.expiry)
    )) {
      if (fallbackNeeded <= 0) break;
      const quantity = Math.min(fallbackNeeded, fallback.quantity);
      addBatchQty(candidates, fallback.expiry, quantity);
      fallbackNeeded -= quantity;
    }

    // Newest expiry first so surplus (shipped) is attributed to earliest FEFO lots.
    for (const [expiry, batchQuantity] of Array.from(candidates).sort(([a], [b]) =>
      b.localeCompare(a)
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
