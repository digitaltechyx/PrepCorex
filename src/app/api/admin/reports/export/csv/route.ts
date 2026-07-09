import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-admin-auth";
import { buildAdminReportComparisonCsv, buildAdminReportCsv } from "@/lib/admin-reports-csv";
import { buildAdminReport, buildAdminReportComparison } from "@/lib/admin-reports-server";
import type { AdminReportType } from "@/lib/admin-reports-types";
import { parseReportDateRange } from "@/lib/admin-reports-request-utils";
import { reportEndOfDay, reportStartOfDay } from "@/lib/admin-reports-utils";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const clientId = request.nextUrl.searchParams.get("clientId")?.trim() || undefined;
  const reportType = (request.nextUrl.searchParams.get("reportType")?.trim() ||
    "overview") as AdminReportType;

  try {
    const { from, to, allTime } = parseReportDateRange(request);

    if (reportType === "comparison") {
      const compareFrom = request.nextUrl.searchParams.get("compareFrom");
      const compareTo = request.nextUrl.searchParams.get("compareTo");
      if (!from || !to || !compareFrom || !compareTo || allTime) {
        return NextResponse.json(
          { error: "Comparison CSV requires from/to and compareFrom/compareTo date ranges." },
          { status: 400 }
        );
      }
      const comparison = await buildAdminReportComparison({
        callerUid: auth.uid,
        clientId,
        periodA: { from: reportStartOfDay(from), to: reportEndOfDay(to) },
        periodB: { from: reportStartOfDay(new Date(compareFrom)), to: reportEndOfDay(new Date(compareTo)) },
      });
      const csv = buildAdminReportComparisonCsv(comparison);
      const scope = comparison.scope.allClients
        ? "all-clients"
        : (comparison.scope.clientName || "client").replace(/\s+/g, "-");
      const filename = `prepcorex-report_comparison_${scope}_${format(from, "yyyy-MM-dd")}_vs_${format(new Date(compareFrom), "yyyy-MM-dd")}.csv`;
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    const summary = await buildAdminReport({
      from,
      to,
      allTime,
      clientId,
      reportType,
      callerUid: auth.uid,
    });
    const csv = buildAdminReportCsv(summary, reportType);
    const scope = summary.scope.allClients ? "all-clients" : (summary.scope.clientName || "client").replace(/\s+/g, "-");
    const filename = allTime
      ? `prepcorex-report_${reportType}_${scope}_all-time.csv`
      : `prepcorex-report_${reportType}_${scope}_${format(from, "yyyy-MM-dd")}.csv`;

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
