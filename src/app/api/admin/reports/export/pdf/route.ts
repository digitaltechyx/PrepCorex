import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-admin-auth";
import { buildAdminReportPdf } from "@/lib/admin-reports-pdf";
import { buildAdminReport } from "@/lib/admin-reports-server";
import { parseReportDateRange } from "@/lib/admin-reports-request-utils";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const clientId = request.nextUrl.searchParams.get("clientId")?.trim() || undefined;

  try {
    const { from, to, allTime } = parseReportDateRange(request);
    const summary = await buildAdminReport({
      from,
      to,
      allTime,
      clientId,
      reportType: "overview",
      callerUid: auth.uid,
    });
    const pdfBytes = buildAdminReportPdf(summary);
    const scope = summary.scope.allClients ? "all-clients" : (summary.scope.clientName || "client").replace(/\s+/g, "-");
    const filename = allTime
      ? `prepcorex-summary_${scope}_all-time.pdf`
      : `prepcorex-summary_${scope}_${format(from, "yyyy-MM-dd")}.pdf`;

    return new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    console.error("[GET /api/admin/reports/export/pdf]", e);
    return NextResponse.json({ error: "Failed to export PDF." }, { status: 500 });
  }
}
