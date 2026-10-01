import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-admin-auth";
import { resolveClientUserIdsForDashboard } from "@/lib/admin-dashboard-finance-server";
import { countPendingRequests } from "@/lib/admin-dashboard-summary-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Pending tab count for Notifications — shared by sidebar badge + dashboard card. */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { userIds } = await resolveClientUserIdsForDashboard(auth.uid);
    const pendingRequestsCount = await countPendingRequests(new Set(userIds));
    return NextResponse.json({ pendingRequestsCount });
  } catch (e) {
    console.error("[admin/pending-requests-count]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to count pending requests" },
      { status: 500 }
    );
  }
}
