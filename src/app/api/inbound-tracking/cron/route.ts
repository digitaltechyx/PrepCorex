import { NextRequest, NextResponse } from "next/server";
import { refreshStaleInboundTrackingIndex } from "@/lib/inbound-tracking-service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled refresh (every 1 minute while testing). Secured with CRON_SECRET or INBOUND_TRACKING_CRON_SECRET.
 */
export async function POST(request: NextRequest) {
  const secret =
    process.env.INBOUND_TRACKING_CRON_SECRET ||
    process.env.CRON_SECRET ||
    process.env.EBAY_CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const querySecret = request.nextUrl.searchParams.get("secret");
  const ok =
    !!secret &&
    (authHeader === `Bearer ${secret}` || querySecret === secret);

  if (!ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const refreshed = await refreshStaleInboundTrackingIndex(1000);
    return NextResponse.json({
      success: true,
      refreshed,
      intervalMinutes: 1,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Cron refresh failed" },
      { status: 500 }
    );
  }
}
