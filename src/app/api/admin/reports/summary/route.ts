import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-admin-auth";
import { buildAdminReport } from "@/lib/admin-reports-server";
import { buildAgentStatement } from "@/lib/agent-statement-server";
import type { AdminReportType } from "@/lib/admin-reports-types";
import { reportEndOfDay, reportStartOfDay } from "@/lib/admin-reports-utils";
import { startOfMonth, endOfMonth, subMonths } from "date-fns";

export const dynamic = "force-dynamic";

function parseReportParams(request: NextRequest, callerUid: string) {
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

  return {
    from: reportStartOfDay(from),
    to: reportEndOfDay(to),
    clientId,
    reportType,
    callerUid,
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const agentId = request.nextUrl.searchParams.get("agentId")?.trim() || undefined;

  try {
    const params = parseReportParams(request, auth.uid);
    const summary = await buildAdminReport(params);
    const agentStatement = agentId
      ? await buildAgentStatement({ agentId, from: params.from, to: params.to })
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
