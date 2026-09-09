import { NextRequest, NextResponse } from "next/server";
import { refreshOpenInboundTrackerEntries } from "@/lib/inbound-tracker-service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorizeCron(request: NextRequest): boolean {
  const secret =
    process.env.INBOUND_TRACKER_CRON_SECRET ||
    process.env.CRON_SECRET ||
    process.env.EBAY_CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const querySecret = request.nextUrl.searchParams.get("secret");
  return (
    !!secret && (authHeader === `Bearer ${secret}` || querySecret === secret)
  );
}

/** Poll Shippo for open inbound trackings (every 6 hours). */
export async function POST(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const refreshed = await refreshOpenInboundTrackerEntries(500);
    return NextResponse.json({ success: true, refreshed });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Cron refresh failed" },
      { status: 500 }
    );
  }
}
