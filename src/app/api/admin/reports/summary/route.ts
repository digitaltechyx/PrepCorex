import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-admin-auth";
import { buildAdminReport } from "@/lib/admin-reports-server";
import { buildAgentStatement } from "@/lib/agent-statement-server";
import type { AdminReportType } from "@/lib/admin-reports-types";
import { parseReportDateRange } from "@/lib/admin-reports-request-utils";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const agentId = request.nextUrl.searchParams.get("agentId")?.trim() || undefined;
  const reportType = (request.nextUrl.searchParams.get("reportType")?.trim() ||
    "overview") as AdminReportType;
  const clientId = request.nextUrl.searchParams.get("clientId")?.trim() || undefined;

  try {
    const { from, to, allTime } = parseReportDateRange(request);
    const summary = await buildAdminReport({
      from,
      to,
      allTime,
      clientId,
      reportType,
      callerUid: auth.uid,
    });
    const agentStatement = agentId
      ? await buildAgentStatement({ agentId, from, to, allTime })
      : null;
    return NextResponse.json({ summary, agentStatement });
  } catch (e) {
    console.error("[GET /api/admin/reports/summary]", e);
    return NextResponse.json(
      { error: "Failed to build report.", detail: e instanceof Error ? e.message : "Unknown" },
      { status: 500 }
    );
  }
}
