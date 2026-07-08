import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-admin-auth";
import { buildAdminReport } from "@/lib/admin-reports-server";
import { buildClientStatementCsv } from "@/lib/client-statement-csv";
import { buildClientStatementPdf } from "@/lib/client-statement-pdf";
import { parseReportDateRange, statementFilename } from "@/lib/admin-reports-request-utils";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const clientId = request.nextUrl.searchParams.get("clientId")?.trim();
  if (!clientId) {
    return NextResponse.json(
      { error: "Select a single client to export a client statement." },
      { status: 400 }
    );
  }

  const exportFormat = request.nextUrl.searchParams.get("format") || "pdf";
  const { from, to, allTime } = parseReportDateRange(request);

  try {
    const summary = await buildAdminReport({
      from,
      to,
      allTime,
      clientId,
      reportType: "financial",
      callerUid: auth.uid,
    });

    if (summary.scope.allClients || !summary.rows.invoices) {
      return NextResponse.json({ error: "Client not found or not accessible." }, { status: 404 });
    }

    const clientLabel = summary.scope.clientName || clientId;

    if (exportFormat === "csv") {
      const csv = buildClientStatementCsv(summary);
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${statementFilename("client-statement", clientLabel, from, "csv", allTime)}"`,
        },
      });
    }

    const pdf = buildClientStatementPdf(summary);
    return new NextResponse(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${statementFilename("client-statement", clientLabel, from, "pdf", allTime)}"`,
      },
    });
  } catch (e) {
    console.error("[GET /api/admin/reports/export/client-statement]", e);
    return NextResponse.json({ error: "Failed to export client statement." }, { status: 500 });
  }
}
