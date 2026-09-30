import { NextRequest, NextResponse } from "next/server";
import {
  assertPublicTrackerAccess,
  publicTrackerAccessDeniedResponse,
} from "@/lib/public-tracker-access";
import { refreshOpenInboundTrackerEntries } from "@/lib/inbound-tracker-service";
import { INBOUND_TRACKER_REFRESH_MS } from "@/lib/inbound-tracker";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Refresh open inbound tracker rows that are older than the refresh interval. */
export async function POST(request: NextRequest) {
  const access = await assertPublicTrackerAccess(request);
  if (!access.ok) return publicTrackerAccessDeniedResponse(access);

  try {
    const refreshed = await refreshOpenInboundTrackerEntries(1000);
    const minutes = Math.round(INBOUND_TRACKER_REFRESH_MS / 60000);
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
