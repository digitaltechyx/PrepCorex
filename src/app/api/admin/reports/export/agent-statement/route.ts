import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-admin-auth";
import { buildAgentStatement } from "@/lib/agent-statement-server";
import { buildAgentStatementCsv } from "@/lib/agent-statement-csv";
import { buildAgentStatementPdf } from "@/lib/agent-statement-pdf";
import { parseReportDateRange, statementFilename } from "@/lib/admin-reports-request-utils";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const agentId = request.nextUrl.searchParams.get("agentId")?.trim();
  if (!agentId) {
    return NextResponse.json(
      { error: "Select a commission agent to export an agent statement." },
      { status: 400 }
    );
  }

  const exportFormat = request.nextUrl.searchParams.get("format") || "pdf";
  const { from, to, allTime } = parseReportDateRange(request);

  try {
    const statement = await buildAgentStatement({ agentId, from, to, allTime });
    if (!statement) {
      return NextResponse.json({ error: "Commission agent not found." }, { status: 404 });
    }

    const agentLabel = statement.agent.name;

    if (exportFormat === "csv") {
      const csv = buildAgentStatementCsv(statement);
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${statementFilename("agent-statement", agentLabel, from, "csv", allTime)}"`,
        },
      });
    }

    const pdf = buildAgentStatementPdf(statement);
    return new NextResponse(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${statementFilename("agent-statement", agentLabel, from, "pdf", allTime)}"`,
      },
    });
  } catch (e) {
    console.error("[GET /api/admin/reports/export/agent-statement]", e);
    return NextResponse.json({ error: "Failed to export agent statement." }, { status: 500 });
  }
}
