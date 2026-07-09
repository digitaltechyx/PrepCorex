import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-admin-auth";
import { buildAdminDashboardSummary } from "@/lib/admin-dashboard-summary-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function parseDateParam(value: string | null): Date | undefined {
  if (!value?.trim()) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const from = parseDateParam(request.nextUrl.searchParams.get("from"));
  const to = parseDateParam(request.nextUrl.searchParams.get("to"));
  const topClientsDays = Number(request.nextUrl.searchParams.get("topClientsDays") || "30");
  const allTime = !(from && to);

  try {
    const summary = await buildAdminDashboardSummary({
      callerUid: auth.uid,
      from: allTime ? undefined : from,
      to: allTime ? undefined : to,
      allTime,
      topClientsDays: Number.isFinite(topClientsDays) ? topClientsDays : 30,
    });
    return NextResponse.json(summary);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load dashboard summary" },
      { status: 500 }
    );
  }
}
