import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import {
  loadAdminAmazonOrdersFromCache,
  syncAdminAmazonOrdersLive,
} from "@/lib/amazon-admin-orders";
import { requireAdminAmazonRoute } from "@/lib/amazon-route-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await requireAdminAmazonRoute(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId")?.trim() || "all";
  const source = searchParams.get("source")?.trim() || "cache";

  try {
    const db = adminDb();
    if (source === "live") {
      const result = await syncAdminAmazonOrdersLive(db, {
        userId: userId === "all" ? undefined : userId,
      });
      return NextResponse.json({
        orders: result.orders,
        source: "live",
        syncedUsers: result.syncedUsers,
        errors: result.errors,
      });
    }

    const orders = await loadAdminAmazonOrdersFromCache(db, {
      userId: userId === "all" ? undefined : userId,
    });
    return NextResponse.json({ orders, source: "cache" });
  } catch (err: unknown) {
    console.error("[admin/amazon/orders GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireAdminAmazonRoute(request);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || "all").trim() || "all";

  try {
    const result = await syncAdminAmazonOrdersLive(adminDb(), {
      userId: userId === "all" ? undefined : userId,
    });
    return NextResponse.json({
      ok: true,
      synced: result.orders.length,
      orders: result.orders,
      syncedUsers: result.syncedUsers,
      errors: result.errors,
    });
  } catch (err: unknown) {
    console.error("[admin/amazon/orders POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
