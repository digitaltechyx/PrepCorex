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

function formatCreatedAtDate(value: unknown): string {
  if (!value) return "unknown date";
  let d: Date | null = null;
  if (typeof value === "string") {
    const parsed = new Date(value);
    d = Number.isNaN(parsed.getTime()) ? null : parsed;
  } else if (value instanceof Date) {
    d = value;
  } else if (typeof value === "object") {
    const asAny = value as { toDate?: () => Date; seconds?: number };
    if (typeof asAny.toDate === "function") {
      try {
        d = asAny.toDate();
      } catch {
        d = null;
      }
    } else if (typeof asAny.seconds === "number") {
      d = new Date(asAny.seconds * 1000);
    }
  }
  if (!d || Number.isNaN(d.getTime())) return "unknown date";
  try {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export type PalletCycleInvoiceLabelInput = {
  id?: string | null;
  assignedAt?: unknown;
  paidCycleCount?: number | null;
  positionLabel?: string | null;
  palletSequence?: number | null;
  cartonCount?: number | null;
  source?: string | null;
};

/**
 * Product line for pallet-base storage invoices.
 * Example: "Storage - Pallet created at Jul 31, 2026 - Cycle 1"
 */
export function formatStoragePalletInvoiceProductName(cycle: PalletCycleInvoiceLabelInput): string {
  const paidCycleCount = Math.max(0, Number(cycle.paidCycleCount) || 0);
  const cycleNumber = paidCycleCount + 1;
  const createdAt = formatCreatedAtDate(cycle.assignedAt);
  return `Storage - Pallet created at ${createdAt} - Cycle ${cycleNumber}`;
}

/**
 * Clean already-generated invoice lines that embedded a Firestore cycle id
 * as "Storage — Pallet {id} (cycle N)".
 */
export function sanitizeStorageInvoiceProductName(productName: string): string {
  const raw = String(productName || "").trim();
  if (!raw) return raw;
  const match = raw.match(/\(cycle\s+(\d+)\)/i);
  const cycleNumber = match?.[1];
  if (
    /Storage\s*[—\-]\s*Pallet\s+[A-Za-z0-9_-]{16,}/i.test(raw) &&
    cycleNumber
  ) {
    return `Storage - Pallet created at unknown date - Cycle ${cycleNumber}`;
  }
  return raw;
}
