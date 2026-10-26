import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import {
  EtsyReconnectRequired,
  getValidEtsyAccessToken,
} from "@/lib/etsy-access-token";
import { etsyApiRequest, type EtsyReceipt } from "@/lib/etsy-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/etsy/orders?connectionId=...
 * Recent shop receipts (orders).
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let uid: string;
  let isAdmin = false;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    uid = decoded.uid;
    if (!uid) throw new Error("No uid");
    const userDoc = await adminDb().collection("users").doc(uid).get();
    const data = userDoc.data();
    const role = data?.role as string;
    const roles = data?.roles as string[] | undefined;
    isAdmin =
      role === "admin" ||
      role === "sub_admin" ||
      (Array.isArray(roles) && (roles.includes("admin") || roles.includes("sub_admin")));
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const connectionId = searchParams.get("connectionId")?.trim();
  const userIdParam = searchParams.get("userId")?.trim();
  const userId = isAdmin && userIdParam ? userIdParam : uid;

  if (!connectionId) {
    return NextResponse.json({ error: "Missing connectionId" }, { status: 400 });
  }

  try {
    const db = adminDb();
    const ref = db
      .collection("users")
      .doc(userId)
      .collection("etsyConnections")
      .doc(connectionId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    const data = snap.data()!;
    const shopId = String(data.shopId || "");
    if (!shopId) {
      return NextResponse.json({ error: "Shop id missing" }, { status: 400 });
    }
    const accessToken = await getValidEtsyAccessToken(ref, data);

    const res = await etsyApiRequest<{ count?: number; results?: EtsyReceipt[] }>({
      path: `/shops/${encodeURIComponent(shopId)}/receipts`,
      accessToken,
      query: {
        limit: 50,
        offset: 0,
        was_paid: true,
        was_shipped: false,
      },
    });

    const orders = (res.results ?? []).map((r) => {
      const divisor = Math.max(1, Number(r.grandtotal?.divisor ?? 100));
      const amount = Number(r.grandtotal?.amount ?? 0) / divisor;
      return {
        receiptId: String(r.receipt_id ?? ""),
        status: r.status ?? null,
        isPaid: Boolean(r.is_paid),
        isShipped: Boolean(r.is_shipped),
        createdAt: r.created_timestamp
          ? new Date(r.created_timestamp * 1000).toISOString()
          : null,
        buyerName: r.name ?? null,
        total: amount,
        currency: r.grandtotal?.currency_code ?? null,
        lineItems: (r.Transactions ?? []).map((t) => ({
          transactionId: String(t.transaction_id ?? ""),
          title: t.title ?? null,
          quantity: t.quantity ?? null,
          sku: t.sku ?? null,
          listingId: t.listing_id != null ? String(t.listing_id) : null,
        })),
      };
    });

    return NextResponse.json({
      orders,
      shopId,
      shopName: data.shopName ?? "Etsy Shop",
    });
  } catch (err: unknown) {
    if (err instanceof EtsyReconnectRequired) {
      return NextResponse.json({ error: err.message, reconnect: true }, { status: 401 });
    }
    console.error("[etsy/orders]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load Etsy orders" },
      { status: 500 }
    );
  }
}
