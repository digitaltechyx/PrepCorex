import { endOfMonth, format, startOfMonth, subMonths } from "date-fns";
import { NextRequest } from "next/server";
import { reportEndOfDay, reportStartOfDay } from "@/lib/admin-reports-utils";

export function parseReportDateRange(request: NextRequest): { from: Date; to: Date } {
  const fromParam = request.nextUrl.searchParams.get("from");
  const toParam = request.nextUrl.searchParams.get("to");
  const preset = request.nextUrl.searchParams.get("preset");

  let from: Date;
  let to: Date;

  if (preset === "this_month") {
    from = startOfMonth(new Date());
    to = endOfMonth(new Date());
  } else if (preset === "last_month") {
    const d = subMonths(new Date(), 1);
    from = startOfMonth(d);
    to = endOfMonth(d);
  } else if (fromParam && toParam) {
    from = new Date(fromParam);
    to = new Date(toParam);
  } else {
    from = startOfMonth(new Date());
    to = new Date();
  }

  return { from: reportStartOfDay(from), to: reportEndOfDay(to) };
}

export function statementFilename(prefix: string, label: string, from: Date, ext: string): string {
  const safe = label.replace(/[^\w\-]+/g, "-").replace(/-+/g, "-").slice(0, 40);
  return `${prefix}_${safe}_${format(from, "yyyy-MM-dd")}.${ext}`;
}
