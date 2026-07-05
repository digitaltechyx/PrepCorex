/** Pallet-base storage billing — 7 days free, then tiered 30-day cycles. */

export const STORAGE_FREE_DAYS = 7;
export const STORAGE_CYCLE_DAYS = 30;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_PALLET_TIER_RATES = {
  month1Rate: 40,
  month2to6Rate: 50,
  month6PlusRate: 70,
} as const;

export type PalletStorageTierRates = {
  month1Rate: number;
  month2to6Rate: number;
  month6PlusRate: number;
};

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** First invoice is due on day 8 (after 7 free days). */
export function computeFirstInvoiceDate(assignedAt: Date): Date {
  return addDays(assignedAt, STORAGE_FREE_DAYS);
}

export function computeFreeUntil(assignedAt: Date): Date {
  return computeFirstInvoiceDate(assignedAt);
}

export function addStorageCycleDays(date: Date): Date {
  return addDays(date, STORAGE_CYCLE_DAYS);
}

/**
 * paidCycleCount = number of completed paid invoices for this position.
 * 0 → month 1 rate; 1–5 → months 2–6; 6+ → 6+ months rate.
 */
export function getRateForPaidCycle(
  paidCycleCount: number,
  tiers: PalletStorageTierRates = DEFAULT_PALLET_TIER_RATES
): number {
  const n = Math.max(0, Math.floor(paidCycleCount));
  if (n <= 0) return tiers.month1Rate;
  if (n <= 5) return tiers.month2to6Rate;
  return tiers.month6PlusRate;
}

export function tierRatesFromStoragePricingDoc(data: Record<string, unknown> | null | undefined): PalletStorageTierRates {
  if (!data) return { ...DEFAULT_PALLET_TIER_RATES };
  const legacy = Number(data.price);
  const month1 = Number(data.month1Rate);
  const month2 = Number(data.month2to6Rate);
  const month6 = Number(data.month6PlusRate);
  return {
    month1Rate: Number.isFinite(month1) && month1 >= 0 ? month1 : Number.isFinite(legacy) && legacy >= 0 ? legacy : DEFAULT_PALLET_TIER_RATES.month1Rate,
    month2to6Rate: Number.isFinite(month2) && month2 >= 0 ? month2 : DEFAULT_PALLET_TIER_RATES.month2to6Rate,
    month6PlusRate: Number.isFinite(month6) && month6 >= 0 ? month6 : DEFAULT_PALLET_TIER_RATES.month6PlusRate,
  };
}

export function formatTierRatesLabel(tiers: PalletStorageTierRates): string {
  return `$${tiers.month1Rate} / $${tiers.month2to6Rate} / $${tiers.month6PlusRate} per pallet (mo 1 / mo 2–6 / 6+)`;
}
