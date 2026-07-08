import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-admin-auth";
import { buildAdminReportCsv } from "@/lib/admin-reports-csv";
import { buildAdminReport } from "@/lib/admin-reports-server";
import type { AdminReportType } from "@/lib/admin-reports-types";
import { reportEndOfDay, reportStartOfDay } from "@/lib/admin-reports-utils";
import { endOfMonth, format, startOfMonth, subMonths } from "date-fns";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const fromParam = request.nextUrl.searchParams.get("from");
  const toParam = request.nextUrl.searchParams.get("to");
  const preset = request.nextUrl.searchParams.get("preset");
  const clientId = request.nextUrl.searchParams.get("clientId")?.trim() || undefined;
  const reportType = (request.nextUrl.searchParams.get("reportType")?.trim() ||
    "overview") as AdminReportType;

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

  try {
    const summary = await buildAdminReport({
      from: reportStartOfDay(from),
      to: reportEndOfDay(to),
      clientId,
      reportType,
      callerUid: auth.uid,
    });
    const csv = buildAdminReportCsv(summary, reportType);
    const scope = summary.scope.allClients ? "all-clients" : (summary.scope.clientName || "client").replace(/\s+/g, "-");
    const filename = `prepcorex-report_${reportType}_${scope}_${format(new Date(from), "yyyy-MM-dd")}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    console.error("[GET /api/admin/reports/export/csv]", e);
    return NextResponse.json({ error: "Failed to export CSV." }, { status: 500 });
  }
}
