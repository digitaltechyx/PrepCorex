import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-admin-auth";
import { buildAdminDashboardFinanceMetrics } from "@/lib/admin-dashboard-finance-server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const fromParam = request.nextUrl.searchParams.get("from");
  const toParam = request.nextUrl.searchParams.get("to");
  const topClientsDays = Number(request.nextUrl.searchParams.get("topClientsDays") || "30");
  const topClientsOnly = request.nextUrl.searchParams.get("topClientsOnly") === "true";

  const from = fromParam ? new Date(fromParam) : undefined;
  const to = toParam ? new Date(toParam) : undefined;
  const allTime = topClientsOnly || !(from && to && !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()));

  try {
    const metrics = await buildAdminDashboardFinanceMetrics({
      callerUid: auth.uid,
      from: allTime ? undefined : from,
      to: allTime ? undefined : to,
      allTime,
      topClientsDays: Number.isFinite(topClientsDays) ? topClientsDays : 30,
    });
    return NextResponse.json(metrics);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load finance metrics" },
      { status: 500 }
    );
  }
}
