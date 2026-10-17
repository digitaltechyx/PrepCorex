import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { OutboundPickLine } from "@/lib/warehouse-pick";

export type ClientProductMap = Map<string, { sku: string; productName: string }>;

export async function loadClientProductMap(clientUserId: string): Promise<ClientProductMap> {
  const snap = await getDocs(collection(db, `users/${clientUserId}/inventory`));
  const map = new Map<string, { sku: string; productName: string }>();
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    const productName = String(data.productName ?? data.sku ?? "").trim();
    const sku = String(data.sku ?? "").trim() || productName || d.id;
    if (!sku) continue;
    map.set(d.id, {
      sku,
      productName: productName || sku,
    });
  }
  return map;
}

/** Clients that need an inventory lookup to resolve shipment SKU. */
export function clientIdsNeedingProductLookup(
  requests: Array<{ clientUserId: string; data: Record<string, unknown> }>
): string[] {
  const ids = new Set<string>();
  for (const req of requests) {
    if (requestNeedsProductLookup(req.data)) ids.add(req.clientUserId);
  }
  return [...ids];
}

function requestNeedsProductLookup(data: Record<string, unknown>): boolean {
  const shipments = Array.isArray(data.shipments)
    ? (data.shipments as Array<Record<string, unknown>>)
    : [];
  for (const shipment of shipments) {
    const productId = String(shipment.productId ?? "").trim();
    if (!productId) continue;
    const qty = Math.max(0, Math.floor(Number(shipment.quantity) || 0));
    const packOf = Math.max(1, Math.floor(Number(shipment.packOf) || 1));
    if (qty * packOf < 1) continue;
    if (!String(shipment.sku ?? "").trim()) return true;
  }
  return false;
}

export function formatOutboundPackLine(boxes: number, packOf: number): string {
  const qty = Math.max(0, Math.floor(boxes));
  const pack = Math.max(1, Math.floor(packOf) || 1);
  return `${qty} × pack of ${pack}`;
}

function formatLotExpiryLabel(expiry: string): string {
  const iso = String(expiry || "").trim();
  if (!iso) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    try {
      const [y, m, d] = iso.split("-").map(Number);
      return new Date(y!, m! - 1, d!).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return iso;
    }
  }
  return iso;
}

export type LotAllocationRow = {
  expiry: string;
  expiryLabel: string;
  quantity: number;
  lot?: string | null;
};

/** Parse lotAllocations or consumedExpiryBatches into display rows. */
export function parseLotAllocationRows(raw: unknown): LotAllocationRow[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw
    .map((row) => {
      const rec = row as { expiry?: unknown; quantity?: unknown; lot?: unknown };
      const expiry = String(rec.expiry || "").trim();
      const quantity = Math.max(0, Math.floor(Number(rec.quantity) || 0));
      if (!expiry || quantity <= 0) return null;
      const lot = rec.lot != null && String(rec.lot).trim() ? String(rec.lot).trim() : null;
      return {
        expiry,
        expiryLabel: formatLotExpiryLabel(expiry),
        quantity,
        lot,
      };
    })
    .filter(Boolean) as LotAllocationRow[];
}

/** Prefer explicit client allocations, then consumed batches after reserve. */
export function lotRowsFromShipment(shipment: Record<string, unknown> | null | undefined): LotAllocationRow[] {
  if (!shipment) return [];
  const fromAlloc = parseLotAllocationRows(shipment.lotAllocations);
  if (fromAlloc.length > 0) return fromAlloc;
  return parseLotAllocationRows(shipment.consumedExpiryBatches);
}

export function formatLotAllocationsNote(raw: unknown): string | null {
  const rows = parseLotAllocationRows(raw);
  if (rows.length === 0) return null;
  return rows.map((row) => `${row.quantity}× ${row.expiryLabel}`).join(", ");
}

export function formatOutboundLineLabel(line: {
  sku: string;
  productName: string;
  quantityUnits: number;
  productId?: string;
  lotNote?: string | null;
}): string {
  const sku = String(line.sku ?? "").trim();
  const name = String(line.productName ?? "").trim();
  const productId = String(line.productId ?? "").trim();
  const looksLikeDocId = (value: string) =>
    Boolean(value) &&
    value.length >= 16 &&
    /^[A-Za-z0-9]+$/.test(value) &&
    (value === productId || !/[\s_\-]/.test(value));

  const niceName = name && !looksLikeDocId(name) ? name : "";
  const niceSku = sku && !looksLikeDocId(sku) ? sku : "";
  const lotNote = String(line.lotNote ?? "").trim();

  let base = "";
  if (niceName && niceSku && niceName !== niceSku) {
    base = `${line.quantityUnits}× ${niceName} (${niceSku})`;
  } else if (niceName) {
    base = `${line.quantityUnits}× ${niceName}`;
  } else if (niceSku) {
    base = `${line.quantityUnits}× ${niceSku}`;
  } else {
    // Last resort — avoid dumping raw Firestore IDs in the queue list.
    base = `${line.quantityUnits}× product`;
  }
  return lotNote ? `${base} · Lots: ${lotNote}` : base;
}

export type EditableOutboundShipmentLine = {
  lineIndex: number;
  sku: string;
  productName: string;
  boxes: number;
  packOf: number;
  quantityUnits: number;
  unitPrice: number;
  productId?: string;
  isPrepOnly: boolean;
  removedAtWarehouse: boolean;
  /** Client-chosen / reserved expiry lots for this line. */
  lotRows: LotAllocationRow[];
  stockRotationPolicy?: string | null;
};

export function buildEditableShipmentLines(
  data: Record<string, unknown>,
  products: ClientProductMap
): EditableOutboundShipmentLine[] {
  const shipments = Array.isArray(data.shipments)
    ? (data.shipments as Array<Record<string, unknown>>)
    : [];
  const lines: EditableOutboundShipmentLine[] = [];
  shipments.forEach((shipment, lineIndex) => {
    const productId = String(shipment.productId ?? "").trim();
    const inboundId = String(shipment.sourceInventoryRequestId ?? "").trim();
    const isPrep = Boolean(inboundId) || productId.startsWith("prep:");
    const removedAtWarehouse = Boolean(shipment.warehouseLineRemoved);
    const product = productId ? products.get(productId) : undefined;
    const sku =
      String(shipment.sku ?? product?.sku ?? "").trim() ||
      (productId && !productId.startsWith("prep:") ? productId : "") ||
      "pending";
    const boxes = Math.max(0, Math.floor(Number(shipment.quantity) || 0));
    const packOf = Math.max(1, Math.floor(Number(shipment.packOf) || 1));
    const quantityUnits = boxes * packOf;
    const unitPrice = Number(shipment.unitPrice);
    if (!productId && !isPrep) return;
    const lotRows = lotRowsFromShipment(shipment);
    lines.push({
      lineIndex,
      sku,
      productName:
        String(shipment.productName ?? product?.productName ?? sku).trim() || sku,
      boxes,
      packOf,
      quantityUnits,
      unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
      productId: productId || undefined,
      isPrepOnly: isPrep,
      removedAtWarehouse,
      lotRows,
      stockRotationPolicy:
        String(shipment.stockRotationPolicy ?? shipment.stockRotationPolicyApplied ?? "").trim() ||
        null,
    });
  });
  return lines;
}

export function buildOrderLinesFromRequestData(
  data: Record<string, unknown>,
  products: ClientProductMap
): OutboundPickLine[] {
  const shipments = Array.isArray(data.shipments)
    ? (data.shipments as Array<Record<string, unknown>>)
    : [];
  const lines: OutboundPickLine[] = [];
  for (const shipment of shipments) {
    if (Boolean(shipment.warehouseLineRemoved)) continue;
    const productId = String(shipment.productId ?? "").trim();
    const inboundId = String(shipment.sourceInventoryRequestId ?? "").trim();
    const isPrep = Boolean(inboundId) || productId.startsWith("prep:");
    if (!productId && !isPrep) continue;
    const product = productId ? products.get(productId) : undefined;
    // Requests usually store productId only; resolve SKU from inventory when loaded.
    // Pre outbound lines often have productName/sku on the shipment before inventory exists.
    const sku =
      String(shipment.sku ?? product?.sku ?? "").trim() ||
      (productId && !productId.startsWith("prep:") ? productId : "") ||
      "pending";
    const qty = Math.max(0, Math.floor(Number(shipment.quantity) || 0));
    const packOf = Math.max(1, Math.floor(Number(shipment.packOf) || 1));
    const quantityUnits = qty * packOf;
    if (quantityUnits < 1) continue;
    const lotRows = lotRowsFromShipment(shipment);
    const lotNote = formatLotAllocationsNote(lotRows);
    lines.push({
      sku,
      productName:
        String(shipment.productName ?? product?.productName ?? sku).trim() || sku,
      quantityUnits,
      productId: productId || sku,
      lotNote,
      ...(lotRows.length > 0
        ? {
            lotAllocations: lotRows.map((row) => ({
              expiry: row.expiry,
              quantity: row.quantity,
            })),
          }
        : {}),
    });
  }
  return lines;
}

export async function preloadClientProductMaps(
  clientUserIds: string[]
): Promise<Map<string, ClientProductMap>> {
  const unique = [...new Set(clientUserIds.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const entries = await Promise.all(
    unique.map(async (uid) => [uid, await loadClientProductMap(uid)] as const)
  );
  return new Map(entries);
}

export async function orderLinesForRequests(
  requests: Array<{ clientUserId: string; data: Record<string, unknown> }>
): Promise<OutboundPickLine[][]> {
  const lookupIds = clientIdsNeedingProductLookup(requests);
  const productMaps = await preloadClientProductMaps(lookupIds);

  return requests.map((req) =>
    buildOrderLinesFromRequestData(
      req.data,
      productMaps.get(req.clientUserId) ?? new Map()
    )
  );
}
