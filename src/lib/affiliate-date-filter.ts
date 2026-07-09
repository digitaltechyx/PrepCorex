import { format } from "date-fns";

export function startOfAffiliateDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

export function endOfAffiliateDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/** No from/to = all time. Both dates required for a bounded range. */
export function isInAffiliateDateRange(
  date: Date | null | undefined,
  from?: Date,
  to?: Date
): boolean {
  if (!date || Number.isNaN(date.getTime())) return false;
  if (!from && !to) return true;

  const t = date.getTime();
  if (from && to) {
    return t >= startOfAffiliateDay(from).getTime() && t <= endOfAffiliateDay(to).getTime();
  }
  if (from) return t >= startOfAffiliateDay(from).getTime();
  if (to) return t <= endOfAffiliateDay(to).getTime();
  return true;
}

export function affiliateDateRangeLabel(from?: Date, to?: Date): string {
  if (from && to) return `${format(from, "yyyy-MM-dd")}_to_${format(to, "yyyy-MM-dd")}`;
  return "all-time";
}

export function filterByIsoDateRange<T extends { occurredAt: string }>(
  items: T[],
  from?: Date,
  to?: Date
): T[] {
  if (!from && !to) return items;
  const fromMs = from ? startOfAffiliateDay(from).getTime() : null;
  const toMs = to ? endOfAffiliateDay(to).getTime() : null;
  return items.filter((item) => {
    const t = new Date(item.occurredAt).getTime();
    if (Number.isNaN(t)) return false;
    if (fromMs !== null && t < fromMs) return false;
    if (toMs !== null && t > toMs) return false;
    return true;
  });
}
