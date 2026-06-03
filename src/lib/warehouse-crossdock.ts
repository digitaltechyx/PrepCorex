import type { WarehouseCartonDoc, WarehouseCartonLine } from "@/types";

/** Placeholder SKU for cross-dock cartons received closed (contents captured at putaway). */
export const CROSSDOCK_CLOSED_SKU = "CLOSED";

export const CROSSDOCK_CLOSED_TITLE = "Closed — contents at putaway";

export function isCrossdockClosedSku(sku: string | null | undefined): boolean {
  return String(sku ?? "").trim().toUpperCase() === CROSSDOCK_CLOSED_SKU;
}

export function isCrossdockClosedCarton(carton: WarehouseCartonDoc): boolean {
  if (carton.isClosedCrossdock === true) return true;
  if (carton.receiveMode !== "crossdock") return false;
  const lines = carton.lines ?? [];
  return lines.length === 1 && isCrossdockClosedSku(lines[0]?.sku);
}

export function buildClosedCrossdockLine(): WarehouseCartonLine {
  return {
    lineId: "L1",
    sku: CROSSDOCK_CLOSED_SKU,
    productTitle: CROSSDOCK_CLOSED_TITLE,
    quantity: 1,
    lot: null,
    expiry: null,
    condition: "good",
    binId: null,
    allocationStatus: "unallocated",
    clientId: null,
    inventoryRequestId: null,
  };
}
