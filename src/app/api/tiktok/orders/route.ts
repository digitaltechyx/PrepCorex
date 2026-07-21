import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { parseTikTokError, tikTokApiRequest } from "@/lib/tiktok-api";
import {
  getValidTikTokAccessToken,
  TikTokReconnectRequired,
} from "@/lib/tiktok-access-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/tiktok/orders?connectionId=...
 * Pull recent TikTok orders (awaiting shipment + in transit) for review / UI.
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
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    uid = decoded.uid;
    if (!uid) throw new Error("No uid");
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const connectionId = new URL(request.url).searchParams.get("connectionId")?.trim();
  if (!connectionId) {
    return NextResponse.json({ error: "Missing connectionId" }, { status: 400 });
  }

  try {
    const db = adminDb();
    const ref = db.collection("users").doc(uid).collection("tiktokConnections").doc(connectionId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    const data = snap.data()!;
    const accessToken = await getValidTikTokAccessToken(ref, data);
    const shopCipher = (data.shopCipher as string) || null;

    const nowSec = Math.floor(Date.now() / 1000);
    const createTimeGe = nowSec - 30 * 24 * 3600;

    const res = await tikTokApiRequest<{
      orders?: Array<Record<string, unknown>>;
      next_page_token?: string;
      total_count?: number;
    }>({
      method: "POST",
      path: "/order/202309/orders/search",
      accessToken,
      shopCipher,
      query: { page_size: 50 },
      body: {
        create_time_ge: createTimeGe,
      },
    });

    if (res.code !== 0) {
      return NextResponse.json(
        { error: "Failed to load TikTok orders", detail: parseTikTokError(res) },
        { status: 502 }
      );
    }

    const orders = (res.data?.orders ?? []).map((o) => ({
      id: String(o.id ?? o.order_id ?? ""),
      status: o.status ?? null,
      createTime: o.create_time ?? null,
      updateTime: o.update_time ?? null,
      buyerEmail: o.buyer_email ?? null,
      payment: o.payment ?? null,
      lineItems: o.line_items ?? o.item_list ?? [],
      raw: o,
    }));

    return NextResponse.json({
      orders,
      shopId: data.shopId,
      shopName: data.shopName,
      totalCount: res.data?.total_count ?? orders.length,
    });
  } catch (err: unknown) {
    if (err instanceof TikTokReconnectRequired) {
      return NextResponse.json({ error: err.message, reconnect: true }, { status: 401 });
    }
    console.error("[tiktok/orders]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
