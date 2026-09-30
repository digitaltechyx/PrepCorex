import { NextRequest, NextResponse } from "next/server";
import { refreshOpenOutboundTrackerEntries } from "@/lib/outbound-tracking-service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorizeCron(request: NextRequest): boolean {
  const secret =
    process.env.OUTBOUND_TRACKING_CRON_SECRET ||
    process.env.CRON_SECRET ||
    process.env.EBAY_CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const querySecret = request.nextUrl.searchParams.get("secret");
  return (
    !!secret && (authHeader === `Bearer ${secret}` || querySecret === secret)
  );
}

/** Poll Shippo for open outbound trackings (every 1 minute while testing). */
export async function POST(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const refreshed = await refreshOpenOutboundTrackerEntries(1000);
    return NextResponse.json({ success: true, refreshed, intervalMinutes: 1 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Cron refresh failed" },
      { status: 500 }
    );
  }
}
