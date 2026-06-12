import type { WarehouseDoc } from "@/types";

/** Normalize carrier label barcode / tracking for comparison. */
export function normalizeCourierScan(raw: string): string {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^0-9A-Za-z]/g, "")
    .toUpperCase();
}

export function courierScansMatch(scanned: string, stored: string): boolean {
  const a = normalizeCourierScan(scanned);
  const b = normalizeCourierScan(stored);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 10 && b.length >= 10) {
    return a.includes(b) || b.includes(a);
  }
  return false;
}

export function knownTrackingNumbers(data: Record<string, unknown>): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    const n = normalizeCourierScan(String(v ?? ""));
    if (n) out.push(n);
  };

  add(data.trackingNumber);
  if (Array.isArray(data.trackingNumbers)) {
    for (const t of data.trackingNumbers) add(t);
  }

  const shipments = data.shipments;
  if (Array.isArray(shipments)) {
    for (const s of shipments) {
      if (s && typeof s === "object") {
        add((s as Record<string, unknown>).trackingNumber);
      }
    }
  }

  return [...new Set(out)];
}

export function trackingMatchesOrder(
  scanned: string,
  data: Record<string, unknown>
): boolean {
  const known = knownTrackingNumbers(data);
  if (known.length === 0) return true;
  return known.some((k) => courierScansMatch(scanned, k));
}

export function formatWarehouseShipFrom(warehouse: WarehouseDoc): string {
  const parts = [
    warehouse.name || warehouse.code,
    [warehouse.street1, warehouse.street2].filter(Boolean).join(" "),
    [warehouse.city, warehouse.stateOrProvince, warehouse.zip].filter(Boolean).join(", "),
  ].filter(Boolean);
  return parts.join(" · ") || warehouse.code;
}

export function shipFromForRequest(
  data: Record<string, unknown>,
  warehouse: WarehouseDoc
): string {
  const explicit = String(data.shipFrom ?? data.sourceLocationName ?? "").trim();
  if (explicit) return explicit;
  return formatWarehouseShipFrom(warehouse);
}

export function shipToForRequest(data: Record<string, unknown>): string {
  return String(data.shipTo ?? "").trim();
}
