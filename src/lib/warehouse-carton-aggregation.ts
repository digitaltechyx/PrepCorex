import type { WarehouseCartonDoc, WarehouseCartonStatus } from "@/types";
import { isCartonPickable } from "@/lib/warehouse-carton-states";

export type SkuStockBucketKey = string;

/** Identity bucket: SKU + lot + expiry + bin (see barcode docs). */
export function stockBucketKey(carton: Pick<WarehouseCartonDoc, "sku" | "lot" | "expiry" | "binId">): SkuStockBucketKey {
  const lot = (carton.lot ?? "").trim() || "_";
  const exp = (carton.expiry ?? "").trim().slice(0, 10) || "_";
  const bin = carton.binId ?? "_unassigned";
  return `${carton.sku}|${lot}|${exp}|${bin}`;
}

export type SkuStockBucketSummary = {
  key: SkuStockBucketKey;
  sku: string;
  lot?: string;
  expiry?: string;
  binId?: string;
  quantity: number;
  cartonCount: number;
  pickableQuantity: number;
};

export type SkuTotalsSummary = {
  sku: string;
  totalQuantity: number;
  pickableQuantity: number;
  cartonCount: number;
  byBucket: SkuStockBucketSummary[];
};

const COUNTABLE_STATUSES: WarehouseCartonStatus[] = [
  "receiving",
  "received",
  "stowed",
  "stowed_partial",
  "available",
  "quarantine",
  "damaged",
  "on_hold",
  "reserved",
];

/** Sum carton qty into per-SKU and per-bucket totals (excludes expired by default). */
export function aggregateCartonsToSkuTotals(
  cartons: WarehouseCartonDoc[],
  options?: { includeExpired?: boolean; statuses?: WarehouseCartonStatus[] }
): SkuTotalsSummary[] {
  const allowed = new Set(options?.statuses ?? COUNTABLE_STATUSES);
  const bySku = new Map<string, Map<SkuStockBucketKey, SkuStockBucketSummary>>();

  for (const c of cartons) {
    if (!options?.includeExpired && c.status === "expired") continue;
    if (!allowed.has(c.status)) continue;
    const qty = Math.max(0, c.quantity);
    const pickable = isCartonPickable(c.status) ? qty : 0;
    const key = stockBucketKey(c);

    let buckets = bySku.get(c.sku);
    if (!buckets) {
      buckets = new Map();
      bySku.set(c.sku, buckets);
    }

    const existing = buckets.get(key);
    if (existing) {
      existing.quantity += qty;
      existing.pickableQuantity += pickable;
      existing.cartonCount += 1;
    } else {
      buckets.set(key, {
        key,
        sku: c.sku,
        lot: c.lot ?? undefined,
        expiry: c.expiry ?? undefined,
        binId: c.binId ?? undefined,
        quantity: qty,
        pickableQuantity: pickable,
        cartonCount: 1,
      });
    }
  }

  const out: SkuTotalsSummary[] = [];
  for (const [sku, buckets] of bySku) {
    const list = [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key));
    out.push({
      sku,
      totalQuantity: list.reduce((s, b) => s + b.quantity, 0),
      pickableQuantity: list.reduce((s, b) => s + b.pickableQuantity, 0),
      cartonCount: list.reduce((s, b) => s + b.cartonCount, 0),
      byBucket: list,
    });
  }
  return out.sort((a, b) => a.sku.localeCompare(b.sku));
}

/** Per-binId qty map for legacy `locationQuantities` style reads. */
export function aggregateCartonsToBinQuantities(
  cartons: WarehouseCartonDoc[],
  options?: { pickableOnly?: boolean }
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const c of cartons) {
    if (!c.binId) continue;
    if (options?.pickableOnly && !isCartonPickable(c.status)) continue;
    if (c.status === "expired") continue;
    map[c.binId] = (map[c.binId] ?? 0) + Math.max(0, c.quantity);
  }
  return map;
}
