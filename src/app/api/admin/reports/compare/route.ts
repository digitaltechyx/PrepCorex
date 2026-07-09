import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-admin-auth";
import { buildAdminReportComparison } from "@/lib/admin-reports-server";
import { reportEndOfDay, reportStartOfDay } from "@/lib/admin-reports-utils";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const fromA = request.nextUrl.searchParams.get("from");
  const toA = request.nextUrl.searchParams.get("to");
  const fromB = request.nextUrl.searchParams.get("compareFrom");
  const toB = request.nextUrl.searchParams.get("compareTo");
  const clientId = request.nextUrl.searchParams.get("clientId")?.trim() || undefined;

  if (!fromA || !toA || !fromB || !toB) {
    return NextResponse.json(
      {
        error:
          "Comparison requires two date ranges: from/to (Period A) and compareFrom/compareTo (Period B).",
      },
      { status: 400 }
    );
  }

  try {
    const comparison = await buildAdminReportComparison({
      callerUid: auth.uid,
      clientId,
      periodA: {
        from: reportStartOfDay(new Date(fromA)),
        to: reportEndOfDay(new Date(toA)),
      },
      periodB: {
        from: reportStartOfDay(new Date(fromB)),
        to: reportEndOfDay(new Date(toB)),
      },
    });
    return NextResponse.json({ comparison });
  } catch (e) {
    console.error("[GET /api/admin/reports/compare]", e);
    return NextResponse.json(
      { error: "Failed to build comparison report.", detail: e instanceof Error ? e.message : "Unknown" },
      { status: 500 }
    );
  }
}
