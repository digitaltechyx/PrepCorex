const STORAGE_KEY = "prepcorex:buy-label-parcel-prefill";

export type BuyLabelParcelPrefill = {
  productName?: string;
  length?: number;
  width?: number;
  height?: number;
  distanceUnit?: "in" | "ft" | "cm" | "m";
  weightPounds?: number;
  weightOunces?: number;
};

function parsePositive(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function weightLbToPoundsOunces(weightLb: number): { weightPounds: number; weightOunces: number } {
  // Unit measurements are stored/entered in pounds — put the full value in the lbs field
  // (including fractions like 0.33), not as remainder ounces. Match formatUnitWeight (2 dp).
  const weightPounds = Math.round(Math.max(0, weightLb) * 100) / 100;
  return { weightPounds, weightOunces: 0 };
}

/** Build parcel prefill from inventory / inbound unit measurements (inches + lb). */
export function buildBuyLabelParcelPrefillFromSource(
  source: Record<string, unknown> | null | undefined,
  meta?: { productName?: string | null }
): BuyLabelParcelPrefill | null {
  if (!source) return null;

  const length = parsePositive(source.unitLengthIn);
  const width = parsePositive(source.unitWidthIn);
  const height = parsePositive(source.unitHeightIn);
  const weightLb = parsePositive(source.unitWeightLb);

  if (length == null && width == null && height == null && weightLb == null) {
    return null;
  }

  const prefill: BuyLabelParcelPrefill = {
    distanceUnit: "in",
  };
  const name = meta?.productName?.trim();
  if (name) prefill.productName = name;
  if (length != null) prefill.length = length;
  if (width != null) prefill.width = width;
  if (height != null) prefill.height = height;
  if (weightLb != null) {
    const w = weightLbToPoundsOunces(weightLb);
    prefill.weightPounds = w.weightPounds;
    prefill.weightOunces = w.weightOunces;
  }
  return prefill;
}

export function saveBuyLabelParcelPrefill(prefill: BuyLabelParcelPrefill): boolean {
  if (typeof sessionStorage === "undefined") return false;
  if (
    prefill.length == null &&
    prefill.width == null &&
    prefill.height == null &&
    prefill.weightPounds == null &&
    prefill.weightOunces == null
  ) {
    return false;
  }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(prefill));
  return true;
}

export function loadBuyLabelParcelPrefillFromSession(): BuyLabelParcelPrefill | null {
  if (typeof sessionStorage === "undefined") return null;
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BuyLabelParcelPrefill;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearBuyLabelParcelPrefillFromSession(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(STORAGE_KEY);
}
