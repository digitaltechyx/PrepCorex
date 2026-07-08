import { endOfMonth, format, startOfMonth, subMonths } from "date-fns";
import { NextRequest } from "next/server";
import { reportEndOfDay, reportStartOfDay } from "@/lib/admin-reports-utils";

export type ParsedReportRange = {
  /** When true, report includes all historical data (no date filter). */
  allTime: boolean;
  from: Date;
  to: Date;
};

export function parseReportDateRange(request: NextRequest): ParsedReportRange {
  const fromParam = request.nextUrl.searchParams.get("from");
  const toParam = request.nextUrl.searchParams.get("to");
  const preset = request.nextUrl.searchParams.get("preset");

  if (preset === "this_month") {
    const from = startOfMonth(new Date());
    const to = endOfMonth(new Date());
    return { allTime: false, from: reportStartOfDay(from), to: reportEndOfDay(to) };
  }

  if (preset === "last_month") {
    const d = subMonths(new Date(), 1);
    const from = startOfMonth(d);
    const to = endOfMonth(d);
    return { allTime: false, from: reportStartOfDay(from), to: reportEndOfDay(to) };
  }

  if (fromParam && toParam) {
    const from = new Date(fromParam);
    const to = new Date(toParam);
    return { allTime: false, from: reportStartOfDay(from), to: reportEndOfDay(to) };
  }

  // No date range selected — all-time report (matches admin dashboard when no range is picked).
  const now = new Date();
  return { allTime: true, from: reportStartOfDay(now), to: reportEndOfDay(now) };
}

export function statementFilename(prefix: string, label: string, from: Date, ext: string, allTime = false): string {
  const safe = label.replace(/[^\w\-]+/g, "-").replace(/-+/g, "-").slice(0, 40);
  const datePart = allTime ? "all-time" : format(from, "yyyy-MM-dd");
  return `${prefix}_${safe}_${datePart}.${ext}`;
}
