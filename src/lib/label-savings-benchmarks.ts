import { getBuyLabelRateDisplay } from "@/lib/buy-label-rate-display";

export const LABEL_SAVINGS_BENCHMARKS_PATH = "appSettings/labelSavingsBenchmarks";

export type LabelSavingsCourierId = "usps" | "ups" | "fedex";

export type LabelSavingsWeightBand = {
  /** Inclusive max weight in pounds. `null` is the catch-all (heavier than the last numbered band). */
  maxLb: number | null;
  label: string;
  usps: number;
  ups: number;
  fedex: number;
};

export type LabelSavingsBenchmarks = {
  bands: LabelSavingsWeightBand[];
};

/** Lightest-band defaults kept for the original 1 lb example (GOFO ~$3.45 vs USPS ~$6.45). */
export const DEFAULT_LABEL_SAVINGS_BANDS: LabelSavingsWeightBand[] = [
  { maxLb: 1, label: "Up to 1 lb", usps: 6.45, ups: 8.9, fedex: 9.2 },
  { maxLb: 3, label: "Up to 3 lb", usps: 9.85, ups: 14.2, fedex: 14.8 },
  { maxLb: 5, label: "Up to 5 lb", usps: 13.4, ups: 19.5, fedex: 20.2 },
  { maxLb: 10, label: "Up to 10 lb", usps: 19.8, ups: 28.9, fedex: 30.1 },
  { maxLb: null, label: "Over 10 lb", usps: 29.5, ups: 44, fedex: 46 },
];

export const DEFAULT_LABEL_SAVINGS_BENCHMARKS: LabelSavingsBenchmarks = {
  bands: DEFAULT_LABEL_SAVINGS_BANDS.map((b) => ({ ...b })),
};

export const LABEL_SAVINGS_COURIERS: Array<{
  id: LabelSavingsCourierId;
  label: string;
}> = [
  { id: "usps", label: "USPS" },
  { id: "ups", label: "UPS" },
  { id: "fedex", label: "FedEx" },
];

function money(n: unknown, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return fallback;
  return Math.round(v * 100) / 100;
}

function sortBands(bands: LabelSavingsWeightBand[]): LabelSavingsWeightBand[] {
  return [...bands].sort((a, b) => {
    if (a.maxLb == null) return 1;
    if (b.maxLb == null) return -1;
    return a.maxLb - b.maxLb;
  });
}

function normalizeBand(
  raw: Partial<LabelSavingsWeightBand> | null | undefined,
  fallback: LabelSavingsWeightBand
): LabelSavingsWeightBand {
  const maxRaw = raw?.maxLb;
  const maxLb =
    maxRaw === null || maxRaw === undefined
      ? fallback.maxLb
      : Number.isFinite(Number(maxRaw)) && Number(maxRaw) > 0
        ? Math.round(Number(maxRaw) * 100) / 100
        : fallback.maxLb;
  return {
    maxLb,
    label: String(raw?.label || fallback.label).trim() || fallback.label,
    usps: money(raw?.usps, fallback.usps),
    ups: money(raw?.ups, fallback.ups),
    fedex: money(raw?.fedex, fallback.fedex),
  };
}

type LegacyFlatBenchmarks = {
  usps?: number;
  ups?: number;
  fedex?: number;
  bands?: LabelSavingsWeightBand[];
};

export type LabelSavingsBenchmarksInput = Partial<LabelSavingsBenchmarks> & LegacyFlatBenchmarks;

export function normalizeLabelSavingsBenchmarks(
  raw: LabelSavingsBenchmarksInput | null | undefined
): LabelSavingsBenchmarks {
  if (Array.isArray(raw?.bands) && raw.bands.length > 0) {
    const bands = sortBands(
      raw.bands.map((band, i) =>
        normalizeBand(band, DEFAULT_LABEL_SAVINGS_BANDS[Math.min(i, DEFAULT_LABEL_SAVINGS_BANDS.length - 1)])
      )
    );
    return { bands };
  }

  // Legacy single-price card: keep those dollars on the 1 lb band only.
  // Heavier packages use the weight table so USPS/UPS savings are not stuck at $0.
  const first = DEFAULT_LABEL_SAVINGS_BANDS[0];
  return {
    bands: DEFAULT_LABEL_SAVINGS_BANDS.map((band, i) =>
      i === 0
        ? {
            ...band,
            usps: money(raw?.usps, first.usps),
            ups: money(raw?.ups, first.ups),
            fedex: money(raw?.fedex, first.fedex),
          }
        : { ...band }
    ),
  };
}

export function parcelWeightPounds(parcel: unknown): number {
  if (!parcel || typeof parcel !== "object") return 1;
  const p = parcel as { weight?: unknown; weightUnit?: unknown };
  const w = Number(p.weight);
  if (!Number.isFinite(w) || w <= 0) return 1;
  const unit = String(p.weightUnit || "lb").toLowerCase();
  if (unit === "oz") return w / 16;
  if (unit === "kg") return w * 2.20462;
  if (unit === "g") return w / 453.59237;
  return w;
}

export function benchmarksForWeight(
  benchmarks: LabelSavingsBenchmarks,
  weightLb: number
): LabelSavingsWeightBand {
  const bands = sortBands(benchmarks.bands?.length ? benchmarks.bands : DEFAULT_LABEL_SAVINGS_BANDS);
  const w = Number.isFinite(weightLb) && weightLb > 0 ? weightLb : 1;
  return bands.find((b) => b.maxLb == null || w <= b.maxLb) ?? bands[bands.length - 1];
}

/** True when the purchased label is PrepCorex GOFO (not Shippo / ShipBest USPS). */
export function isPrepCorexGofoPurchase(data: Record<string, unknown>): boolean {
  const selected =
    data.selectedRate && typeof data.selectedRate === "object"
      ? (data.selectedRate as Record<string, unknown>)
      : {};
  const display = getBuyLabelRateDisplay({
    provider: String(selected.provider ?? data.provider ?? ""),
    serviceLevel: String(selected.serviceLevel ?? selected.servicelevel ?? ""),
    labelProvider: String(data.labelProvider ?? selected.labelProvider ?? ""),
    objectId: String(selected.objectId ?? selected.object_id ?? ""),
  });
  return display.provider === "PrepCorex";
}

export function labelPurchasePaidDollars(data: Record<string, unknown>): number {
  const cents = Number(data.paymentAmount);
  if (Number.isFinite(cents) && cents > 0) {
    return Math.round(cents) / 100;
  }
  const selected =
    data.selectedRate && typeof data.selectedRate === "object"
      ? (data.selectedRate as Record<string, unknown>)
      : {};
  const amount = Number(selected.amount);
  if (Number.isFinite(amount) && amount > 0) return Math.round(amount * 100) / 100;
  return 0;
}

export function estimatedSavings(paid: number, benchmark: number): number {
  return Math.max(0, Math.round((benchmark - paid) * 100) / 100);
}
