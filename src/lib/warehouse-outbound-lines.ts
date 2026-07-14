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

export function buildOrderLinesFromRequestData(
  data: Record<string, unknown>,
  products: ClientProductMap
): OutboundPickLine[] {
  const shipments = Array.isArray(data.shipments)
    ? (data.shipments as Array<Record<string, unknown>>)
    : [];
  const lines: OutboundPickLine[] = [];
  for (const shipment of shipments) {
    const productId = String(shipment.productId ?? "").trim();
    if (!productId) continue;
    const product = products.get(productId);
    // Requests usually store productId only; resolve SKU from inventory when loaded.
    // Fall back to productId so Pending review still shows qty while inventory loads.
    const sku = String(shipment.sku ?? product?.sku ?? "").trim() || productId;
    const qty = Math.max(0, Math.floor(Number(shipment.quantity) || 0));
    const packOf = Math.max(1, Math.floor(Number(shipment.packOf) || 1));
    const quantityUnits = qty * packOf;
    if (quantityUnits < 1) continue;
    lines.push({
      sku,
      productName:
        String(shipment.productName ?? product?.productName ?? sku).trim() || sku,
      quantityUnits,
      productId,
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
