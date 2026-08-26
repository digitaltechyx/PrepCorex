export const PREP_SAVINGS_BENCHMARKS_PATH = "appSettings/prepSavingsBenchmarks";

export type PrepSavingsBenchmarks = {
  /** Typical 3PL FBA labeling + standard prep, per unit. */
  fbaPerUnit: number;
  /** Typical 3PL FBM pick / pack, per unit. */
  fbmPerUnit: number;
  /** Typical 3PL cross-dock handling, per unit. */
  crossdockPerUnit: number;
  /** Typical 3PL product return handling, per unit. */
  returnsPerUnit: number;
};

export const DEFAULT_PREP_SAVINGS_BENCHMARKS: PrepSavingsBenchmarks = {
  fbaPerUnit: 1.35,
  fbmPerUnit: 3.5,
  crossdockPerUnit: 2.5,
  returnsPerUnit: 2.0,
};

export type PrepSavingsFamily = "fba" | "fbm" | "crossdock" | "returns";

function money(n: unknown, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return fallback;
  return Math.round(v * 100) / 100;
}

export function normalizePrepSavingsBenchmarks(
  raw: Partial<PrepSavingsBenchmarks> | null | undefined
): PrepSavingsBenchmarks {
  return {
    fbaPerUnit: money(raw?.fbaPerUnit, DEFAULT_PREP_SAVINGS_BENCHMARKS.fbaPerUnit),
    fbmPerUnit: money(raw?.fbmPerUnit, DEFAULT_PREP_SAVINGS_BENCHMARKS.fbmPerUnit),
    crossdockPerUnit: money(
      raw?.crossdockPerUnit,
      DEFAULT_PREP_SAVINGS_BENCHMARKS.crossdockPerUnit
    ),
    returnsPerUnit: money(raw?.returnsPerUnit, DEFAULT_PREP_SAVINGS_BENCHMARKS.returnsPerUnit),
  };
}

function normalizedText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

export function classifyPrepSavingsFamily(service: unknown): PrepSavingsFamily {
  const value = normalizedText(service);
  if (!value) return "fbm";
  if (/CROSS[\s-]?DOCK|CROSSDOCK/.test(value)) return "crossdock";
  if (/RETURN|PRODUCT RETURN/.test(value)) return "returns";
  if (/(?:FBA|WFS|TFS)/.test(value)) return "fba";
  return "fbm";
}

export function classifyPrepSavingsFamilyFromParts(
  ...parts: unknown[]
): PrepSavingsFamily {
  return classifyPrepSavingsFamily(parts.filter(Boolean).join(" "));
}

/** Classify a shipped record for prep savings (cross-dock / returns / FBA / FBM). */
export function classifyPrepFamilyFromShipped(
  data: Record<string, unknown>
): PrepSavingsFamily {
  if (String(data.returnRequestId ?? "").trim()) return "returns";

  const serviceFamily = classifyPrepSavingsFamilyFromParts(
    data.service,
    data.shipmentType,
    data.remarks,
    data.productName
  );

  const isCrossdock =
    data.crossdockFulfillment === true ||
    String(data.crossdockUnitCode ?? "").trim() ||
    String(data.crossdockLinkedUnitId ?? "").trim();

  if (isCrossdock) {
    // Cross-dock linked outbound prep is billed as FBA/FBM; pure forwarding stays cross-dock.
    if (serviceFamily === "fba" || serviceFamily === "fbm") return serviceFamily;
    return "crossdock";
  }

  return serviceFamily;
}

/** Classify an invoice for prep savings inclusion and default family. */
export function classifyPrepFamilyFromInvoice(
  data: Record<string, unknown>
): PrepSavingsFamily | null {
  const type = String(data.type || "").trim().toLowerCase();
  if (type === "storage" || type === "container_handling") return null;
  if (data.isContainerHandling === true) return null;

  const fbm = normalizedText(data.fbm);
  if (fbm.includes("STORAGE") || fbm.includes("CONTAINER")) return null;
  if (type === "product_return" || fbm.includes("RETURN")) return "returns";

  return classifyPrepSavingsFamilyFromParts(data.fbm, data.service, type);
}

export function isPrepSavingsInvoice(data: Record<string, unknown>): boolean {
  return classifyPrepFamilyFromInvoice(data) != null;
}

export function marketPrepRate(
  benchmarks: PrepSavingsBenchmarks,
  family: PrepSavingsFamily
): number {
  switch (family) {
    case "fba":
      return benchmarks.fbaPerUnit;
    case "crossdock":
      return benchmarks.crossdockPerUnit;
    case "returns":
      return benchmarks.returnsPerUnit;
    default:
      return benchmarks.fbmPerUnit;
  }
}

export function prepFamilyLabel(family: PrepSavingsFamily): string {
  switch (family) {
    case "fba":
      return "FBA prep";
    case "crossdock":
      return "Cross-dock";
    case "returns":
      return "Returns";
    default:
      return "FBM pick/pack";
  }
}

function shippedUnits(data: Record<string, unknown>): number {
  return (
    Math.max(0, Math.floor(Number(data.shippedQty) || 0)) ||
    Math.max(0, Math.floor(Number(data.totalUnits) || 0)) ||
    Math.max(0, Math.floor(Number(data.boxesShipped) || 0)) ||
    0
  );
}

function crossdockBillableUnits(data: Record<string, unknown>): number {
  return (
    Math.max(1, Math.floor(Number(data.boxesShipped) || 0)) ||
    Math.max(1, Math.floor(Number(data.totalBoxes) || 0)) ||
    1
  );
}

/** Typical 3PL prep cost for a shipped record (admin market benchmarks). */
export function estimateShippedPrepMarket(
  data: Record<string, unknown>,
  benchmarks: PrepSavingsBenchmarks
): { family: PrepSavingsFamily; unitCount: number; estimated: number } | null {
  const family = classifyPrepFamilyFromShipped(data);
  if (family === "returns") return null;

  if (family === "crossdock") {
    const billable = crossdockBillableUnits(data);
    const rate = marketPrepRate(benchmarks, "crossdock");
    return { family, unitCount: billable, estimated: billable * rate };
  }

  const qty = shippedUnits(data);
  if (qty <= 0) return null;

  const rate = marketPrepRate(benchmarks, family);
  return { family, unitCount: qty, estimated: qty * rate };
}

/** Typical 3PL return handling cost (admin market benchmarks). */
export function estimateReturnPrepMarket(
  qty: number,
  benchmarks: PrepSavingsBenchmarks
): { unitCount: number; estimated: number } {
  const units = Math.max(0, Math.floor(qty));
  if (units <= 0) return { unitCount: 0, estimated: 0 };
  const rate = marketPrepRate(benchmarks, "returns");
  return { unitCount: units, estimated: units * rate };
}
