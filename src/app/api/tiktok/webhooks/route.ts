import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Health check for Partner Center / webhook URL verification. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "tiktok-webhooks",
    message: "TikTok webhook endpoint ready. Event handling will be enabled after OAuth connect.",
  });
}

/**
 * POST webhook receiver (stub).
 * Configure in Partner Center → Manage Webhook when ready:
 * https://prepcorex.com/api/tiktok/webhooks
 */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  console.info("[tiktok/webhooks] received", {
    contentType: request.headers.get("content-type"),
    bytes: raw.length,
  });
  // Acknowledge so Partner Center / TikTok can verify delivery during review.
  return NextResponse.json({ ok: true });
}
