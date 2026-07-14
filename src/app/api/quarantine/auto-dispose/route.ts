import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import {
  QUARANTINE_HOLD_DAYS,
  autoDisposeExpiredQuarantine,
} from "@/lib/warehouse-quarantine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const runtime = "nodejs";

/**
 * Daily quarantine auto-dispose: damaged receive stock past 10 days
 * is disposed and written to the client's recycledInventory with remarks.
 *
 * Secured with CRON_SECRET / QUARANTINE_CRON_SECRET.
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

  try {
    // Client SDK helpers still need Admin listing of warehouses for the job scope,
    // then autoDisposeExpiredQuarantine uses the client Firebase app (same Firestore).
    const snap = await adminDb().collection("warehouses").get();
    const warehouseIds = snap.docs
      .filter((d: { data: () => Record<string, unknown>; id: string }) => d.data()?.active !== false)
      .map((d: { id: string }) => d.id);

    let disposed = 0;
    const errors: string[] = [];
    for (const warehouseId of warehouseIds) {
      const result = await autoDisposeExpiredQuarantine(warehouseId);
      disposed += result.disposed;
      errors.push(...result.errors);
    }

    return NextResponse.json({
      success: true,
      holdDays: QUARANTINE_HOLD_DAYS,
      warehouses: warehouseIds.length,
      disposed,
      errors,
    });
  } catch (e) {
    console.error("[quarantine/auto-dispose]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Auto-dispose failed" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
