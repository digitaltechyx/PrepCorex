import type { WarehouseCartonDoc } from "@/types";
import { isCrossdockClosedCarton, isCrossdockClosedSku } from "@/lib/warehouse-crossdock";

export function manifestSkuCount(carton: WarehouseCartonDoc): number {
  const lines = carton.lines ?? [];
  return new Set(lines.map((l) => l.sku.trim()).filter(Boolean)).size;
}

export function manifestDamagedQty(carton: WarehouseCartonDoc): number {
  return (carton.lines ?? [])
    .filter((l) => l.condition === "damaged")
    .reduce((sum, l) => sum + Math.max(0, l.quantity), 0);
}

export function resolveManifestLotLabel(carton: WarehouseCartonDoc): string | null {
  if (carton.lot?.trim()) return carton.lot.trim();
  const lots = [
    ...new Set(
      (carton.lines ?? [])
        .map((l) => l.lot?.trim())
        .filter((lot): lot is string => !!lot)
    ),
  ];
  if (lots.length === 0) return null;
  if (lots.length === 1) return lots[0];
  return `MULTI (${lots.length} lots)`;
}

/** True when label/putaway should show SKU line manifest (not closed placeholder only). */
export function showsSkuManifest(carton: WarehouseCartonDoc): boolean {
  if (carton.isLoose) return true;
  if (isCrossdockClosedCarton(carton)) return false;
  const lines = carton.lines ?? [];
  if (lines.length === 0) return false;
  if (lines.length === 1 && isCrossdockClosedSku(lines[0]?.sku)) return false;
  return true;
}
