import { NextRequest, NextResponse } from "next/server";
import {
  assertPublicTrackerAccess,
  publicTrackerAccessDeniedResponse,
} from "@/lib/public-tracker-access";
import { refreshOpenOutboundTrackerEntries } from "@/lib/outbound-tracking-service";
import { OUTBOUND_TRACKING_REFRESH_MS } from "@/lib/outbound-tracking";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Refresh open outbound tracker rows that are older than the refresh interval. */
export async function POST(request: NextRequest) {
  const access = await assertPublicTrackerAccess(request);
  if (!access.ok) return publicTrackerAccessDeniedResponse(access);

  try {
    const refreshed = await refreshOpenOutboundTrackerEntries(1000);
    const minutes = Math.round(OUTBOUND_TRACKING_REFRESH_MS / 60000);
    return NextResponse.json({
      success: true,
      refreshed,
      message:
        refreshed > 0
          ? `Refreshed ${refreshed} open tracking(s).`
          : `All open trackings are up to date (checked within ${minutes} min).`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Refresh failed" },
      { status: 500 }
    );
  }
}
