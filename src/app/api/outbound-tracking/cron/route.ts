import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Scheduled outbound-tracking refresh is disabled (2026-11-02).
 * Refresh runs on Outbound Tracker page load via POST /api/outbound-tracking/refresh-stale.
 */
export async function POST() {
  return NextResponse.json(
    {
      ok: true,
      mode: "disabled",
      message:
        "Scheduled outbound tracking refresh is disabled. Use page-load /api/outbound-tracking/refresh-stale.",
    },
    { status: 410 }
  );
}
