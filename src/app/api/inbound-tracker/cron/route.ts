import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Scheduled inbound-tracker refresh is disabled (2026-11-02).
 * Refresh runs on Inbound Tracker page load via POST /api/inbound-tracker/refresh-stale.
 */
export async function POST() {
  return NextResponse.json(
    {
      ok: true,
      mode: "disabled",
      message:
        "Scheduled inbound tracker refresh is disabled. Use page-load /api/inbound-tracker/refresh-stale.",
    },
    { status: 410 }
  );
}
