import { format } from "date-fns";
import type { Commission } from "@/types";

export type AffiliateTier = "Bronze" | "Silver" | "Gold";

export const AFFILIATE_TIER_RATES: Record<AffiliateTier, number> = {
  Bronze: 5,
  Silver: 7,
  Gold: 8,
};

export const SILVER_MONTHLY_TARGET = 25000;
export const GOLD_MONTHLY_TARGET = 50000;
export const SILVER_STREAK_MONTHS = 3;
export const GOLD_STREAK_MONTHS = 6;
export const CLIENT_COMMISSION_WINDOW_MONTHS = 12;

export function parseCommissionDate(
  value: Commission["createdAt"] | Commission["paidAt"] | undefined | null
): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object" && "seconds" in value) {
    return new Date(value.seconds * 1000);
  }
  return null;
}

export function buildMonthlyRevenueMap(
  commissions: Pick<Commission, "invoiceAmount" | "createdAt">[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const commission of commissions) {
    const date = parseCommissionDate(commission.createdAt);
    if (!date) continue;
    const key = format(date, "yyyy-MM");
    map.set(key, (map.get(key) || 0) + (commission.invoiceAmount || 0));
  }
  return map;
}

export function buildMonthSeries(
  monthlyRevenueMap: Map<string, number>,
  monthCount = 12
): { key: string; month: string; revenue: number }[] {
  const list: { key: string; month: string; revenue: number }[] = [];
  const today = new Date();
  for (let i = monthCount - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const key = format(d, "yyyy-MM");
    list.push({
      key,
      month: format(d, "MMM yyyy"),
      revenue: monthlyRevenueMap.get(key) || 0,
    });
  }
  return list;
}

function countTrailingStreak(
  monthSeries: { revenue: number }[],
  threshold: number
): number {
  let streak = 0;
  for (let i = monthSeries.length - 1; i >= 0; i--) {
    if ((monthSeries[i]?.revenue || 0) >= threshold) streak += 1;
    else break;
  }
  return streak;
}

export function computeAgentTier(
  commissions: Pick<Commission, "invoiceAmount" | "createdAt">[],
  options?: { monthCount?: number }
): {
  tier: AffiliateTier;
  rate: number;
  monthSeries: { key: string; month: string; revenue: number }[];
  silverStreak: number;
  goldStreak: number;
  currentMonthRevenue: number;
} {
  const monthlyRevenueMap = buildMonthlyRevenueMap(commissions);
  const monthSeries = buildMonthSeries(monthlyRevenueMap, options?.monthCount ?? 12);
  const silverStreak = countTrailingStreak(monthSeries, SILVER_MONTHLY_TARGET);
  const goldStreak = countTrailingStreak(monthSeries, GOLD_MONTHLY_TARGET);

  const tier: AffiliateTier =
    goldStreak >= GOLD_STREAK_MONTHS
      ? "Gold"
      : silverStreak >= SILVER_STREAK_MONTHS
        ? "Silver"
        : "Bronze";

  return {
    tier,
    rate: AFFILIATE_TIER_RATES[tier],
    monthSeries,
    silverStreak,
    goldStreak,
    currentMonthRevenue: monthSeries[monthSeries.length - 1]?.revenue || 0,
  };
}

export function getTierBadgeClass(tier: AffiliateTier): string {
  switch (tier) {
    case "Gold":
      return "bg-yellow-100 text-yellow-800 border-yellow-300";
    case "Silver":
      return "bg-slate-100 text-slate-800 border-slate-300";
    default:
      return "bg-amber-100 text-amber-800 border-amber-300";
  }
}

export function isClientWithinCommissionWindow(
  clientCommissions: Pick<Commission, "createdAt">[],
  asOf: Date = new Date()
): boolean {
  if (clientCommissions.length === 0) return true;

  const dates = clientCommissions
    .map((c) => parseCommissionDate(c.createdAt))
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime());

  if (dates.length === 0) return true;

  const firstPaid = dates[0];
  const expiresOn = new Date(firstPaid);
  expiresOn.setFullYear(expiresOn.getFullYear() + 1);
  return asOf <= expiresOn;
}

export function getClientCommissionWindow(
  clientCommissions: Pick<Commission, "createdAt">[]
): { firstPaid: Date | null; expiresOn: Date | null; active: boolean } {
  const dates = clientCommissions
    .map((c) => parseCommissionDate(c.createdAt))
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime());

  if (dates.length === 0) {
    return { firstPaid: null, expiresOn: null, active: false };
  }

  const firstPaid = dates[0];
  const expiresOn = new Date(firstPaid);
  expiresOn.setFullYear(expiresOn.getFullYear() + 1);
  return {
    firstPaid,
    expiresOn,
    active: new Date() <= expiresOn,
  };
}
