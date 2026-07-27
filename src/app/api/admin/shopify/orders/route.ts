import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { ShopifyReconnectRequired } from "@/lib/shopify-access-token";
import {
  loadAdminShopifyOrdersFromCache,
  syncAdminShopifyOrdersLive,
} from "@/lib/shopify-admin-orders";

export const dynamic = "force-dynamic";

function isAdminOrSubAdmin(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  const role = data.role as string;
  const roles = data.roles as string[] | undefined;
  return (
    role === "admin" ||
    role === "sub_admin" ||
    (Array.isArray(roles) && (roles.includes("admin") || roles.includes("sub_admin")))
  );
}

async function requireAdmin(request: NextRequest): Promise<NextResponse | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = authHeader.slice(7).trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const decoded = await adminAuth().verifyIdToken(token);
    if (!decoded.uid) throw new Error("No uid");
    const callerDoc = await adminDb().collection("users").doc(decoded.uid).get();
    if (!isAdminOrSubAdmin(callerDoc.data() as Record<string, unknown> | undefined)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }
  return null;
}

/**
 * GET /api/admin/shopify/orders?userId=all|{uid}&source=live|cache
 * Admin dashboard: all Shopify orders across clients (or one client).
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId")?.trim() || "all";
  const source = searchParams.get("source")?.trim() || "cache";

  try {
    const db = adminDb();
    if (source === "live") {
      const result = await syncAdminShopifyOrdersLive(db, {
        userId: userId === "all" ? undefined : userId,
      });
      return NextResponse.json({
        orders: result.orders,
        source: "live",
        syncedUsers: result.syncedUsers,
        errors: result.errors,
      });
    }

    const orders = await loadAdminShopifyOrdersFromCache(db, {
      userId: userId === "all" ? undefined : userId,
    });
    return NextResponse.json({ orders, source: "cache" });
  } catch (err: unknown) {
    if (err instanceof ShopifyReconnectRequired) {
      return NextResponse.json({ error: err.message, reconnect: true }, { status: 401 });
    }
    console.error("[admin/shopify/orders GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}

/** POST: live sync for admin dashboard (all clients or one). */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const userId =
    String(body.userId || new URL(request.url).searchParams.get("userId") || "all").trim() || "all";

  try {
    const result = await syncAdminShopifyOrdersLive(adminDb(), {
      userId: userId === "all" ? undefined : userId,
    });
    return NextResponse.json({
      ok: true,
      orders: result.orders,
      syncedUsers: result.syncedUsers,
      errors: result.errors,
    });
  } catch (err: unknown) {
    console.error("[admin/shopify/orders POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
