import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Quarantine auto-dispose by age is disabled.
 * Operators dispose manually from Warehouse Ops → Quarantine
 * (or putaway / send to pack for shipping).
 *
 * Endpoint kept so existing cron schedules do not 404.
 */
export async function POST(request: NextRequest) {
  const secret =
    process.env.QUARANTINE_CRON_SECRET ||
    process.env.CRON_SECRET ||
    process.env.INVOICE_CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const querySecret = request.nextUrl.searchParams.get("secret");
  const ok =
    !!secret &&
    (authHeader === `Bearer ${secret}` || querySecret === secret);

  if (!ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    success: true,
    disabled: true,
    message:
      "Quarantine auto-dispose is disabled. Operators dispose manually from Warehouse Ops.",
    disposed: 0,
  });
}

export async function GET(request: NextRequest) {
  return POST(request);
}
