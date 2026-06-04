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

/** `LOT-CRD` + receive date (YYYYMMDD) + 3-digit random, e.g. LOT-CRD20260603042 */
export function generateCrossdockReceiveLot(at = new Date()): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  const rnd = String(Math.floor(Math.random() * 1000)).padStart(3, "0");
  return `LOT-CRD${y}${m}${d}${rnd}`;
}

export function closedCrossdockProductTitle(clientDisplayName?: string | null): string {
  const name = String(clientDisplayName ?? "").trim();
  return name ? `Closed cross-dock — ${name}` : CROSSDOCK_CLOSED_TITLE;
}

export function buildClosedCrossdockLine(input?: {
  lot?: string | null;
  clientId?: string | null;
  clientDisplayName?: string | null;
}): WarehouseCartonLine {
  const clientId = input?.clientId?.trim() || null;
  return {
    lineId: "L1",
    sku: CROSSDOCK_CLOSED_SKU,
    productTitle: closedCrossdockProductTitle(input?.clientDisplayName),
    quantity: 1,
    lot: input?.lot?.trim() || null,
    expiry: null,
    condition: "good",
    binId: null,
    allocationStatus: clientId ? "allocated" : "unallocated",
    clientId,
    inventoryRequestId: null,
  };
}
