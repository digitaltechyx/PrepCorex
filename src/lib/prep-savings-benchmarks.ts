export const PREP_SAVINGS_BENCHMARKS_PATH = "appSettings/prepSavingsBenchmarks";

export type PrepSavingsBenchmarks = {
  /** Typical 3PL FBA labeling + standard prep, per unit. */
  fbaPerUnit: number;
  /** Typical 3PL FBM pick / pack, per unit. */
  fbmPerUnit: number;
};

export const DEFAULT_PREP_SAVINGS_BENCHMARKS: PrepSavingsBenchmarks = {
  fbaPerUnit: 1.35,
  fbmPerUnit: 3.5,
};

export type PrepSavingsFamily = "fba" | "fbm";

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
  };
}

export function classifyPrepSavingsFamily(service: unknown): PrepSavingsFamily {
  const value = String(service || "")
    .trim()
    .toUpperCase();
  if (!value) return "fbm";
  if (/(?:FBA|WFS|TFS)/.test(value)) return "fba";
  return "fbm";
}

export function classifyPrepSavingsFamilyFromParts(
  ...parts: unknown[]
): PrepSavingsFamily {
  return classifyPrepSavingsFamily(parts.filter(Boolean).join(" "));
}

export function isPrepSavingsInvoice(data: Record<string, unknown>): boolean {
  const type = String(data.type || "").trim().toLowerCase();
  if (type === "storage" || type === "container_handling") return false;
  if (data.isContainerHandling === true) return false;
  const fbm = String(data.fbm || "").trim().toLowerCase();
  if (
    fbm.includes("storage") ||
    fbm.includes("container") ||
    fbm.includes("return")
  ) {
    return false;
  }
  return true;
}

export function marketPrepRate(
  benchmarks: PrepSavingsBenchmarks,
  family: PrepSavingsFamily
): number {
  return family === "fba" ? benchmarks.fbaPerUnit : benchmarks.fbmPerUnit;
}
