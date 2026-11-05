import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Scheduled inbound-tracking refresh is disabled (2026-11-02).
 * Refresh runs on Inventory page load via POST /api/inbound-tracking/refresh-stale.
 */
export async function POST() {
  return NextResponse.json(
    {
      ok: true,
      mode: "disabled",
      message:
        "Scheduled inbound tracking refresh is disabled. Use page-load /api/inbound-tracking/refresh-stale.",
    },
    { status: 410 }
  );
}
