import { getBuyLabelRateDisplay } from "@/lib/buy-label-rate-display";

export const LABEL_SAVINGS_BENCHMARKS_PATH = "appSettings/labelSavingsBenchmarks";

export type LabelSavingsCourierId = "usps" | "ups" | "fedex";

export type LabelSavingsBenchmarks = {
  usps: number;
  ups: number;
  fedex: number;
};

export const DEFAULT_LABEL_SAVINGS_BENCHMARKS: LabelSavingsBenchmarks = {
  usps: 6.45,
  ups: 8.9,
  fedex: 9.2,
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

export function normalizeLabelSavingsBenchmarks(
  raw: Partial<LabelSavingsBenchmarks> | null | undefined
): LabelSavingsBenchmarks {
  return {
    usps: money(raw?.usps, DEFAULT_LABEL_SAVINGS_BENCHMARKS.usps),
    ups: money(raw?.ups, DEFAULT_LABEL_SAVINGS_BENCHMARKS.ups),
    fedex: money(raw?.fedex, DEFAULT_LABEL_SAVINGS_BENCHMARKS.fedex),
  };
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
