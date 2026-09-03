import { NextRequest, NextResponse } from "next/server";
import { runOutboundTrackerDailyDigest } from "@/lib/outbound-tracking-service";

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

/** Daily 7am EDT digest to info@prepservicesfba.com. */
export async function POST(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runOutboundTrackerDailyDigest();
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Daily digest failed" },
      { status: 500 }
    );
  }
}
