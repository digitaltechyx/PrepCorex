import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { parseTikTokError, tikTokApiRequest } from "@/lib/tiktok-api";
import {
  getValidTikTokAccessToken,
  TikTokReconnectRequired,
} from "@/lib/tiktok-access-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ConnDoc = {
  id: string;
  shopId?: string;
  shopName?: string;
  shopCipher?: string | null;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: { seconds: number; nanoseconds?: number };
  refreshTokenExpiresAt?: { seconds: number; nanoseconds?: number };
};

/**
 * GET /api/tiktok/orders?connectionId=&userId=
 * Pull recent TikTok orders. Caller must be the user or admin.
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

  let callerUid: string;
  let isAdmin = false;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    callerUid = decoded.uid;
    if (!callerUid) throw new Error("No uid");
    const userDoc = await adminDb().collection("users").doc(callerUid).get();
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
  const userId = searchParams.get("userId")?.trim() || callerUid;
  const connectionId = searchParams.get("connectionId")?.trim() || "";
  if (userId !== callerUid && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const db = adminDb();
    const col = db.collection("users").doc(userId).collection("tiktokConnections");
    let connections: ConnDoc[] = [];
    if (connectionId) {
      const snap = await col.doc(connectionId).get();
      if (!snap.exists) {
        return NextResponse.json({ error: "Connection not found" }, { status: 404 });
      }
      connections = [{ id: snap.id, ...(snap.data() as Omit<ConnDoc, "id">) }];
    } else {
      const snap = await col.get();
      connections = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ConnDoc, "id">) }));
    }

    if (connections.length === 0) {
      return NextResponse.json({ orders: [], connections: [] });
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const createTimeGe = nowSec - 30 * 24 * 3600;
    const allOrders: Array<Record<string, unknown>> = [];

    for (const conn of connections) {
      const ref = col.doc(conn.id);
      const accessToken = await getValidTikTokAccessToken(ref, conn);
      const shopCipher = conn.shopCipher || null;

      const res = await tikTokApiRequest<{
        orders?: Array<Record<string, unknown>>;
        total_count?: number;
      }>({
        method: "POST",
        path: "/order/202309/orders/search",
        accessToken,
        shopCipher,
        query: { page_size: 50 },
        body: { create_time_ge: createTimeGe },
      });

      if (res.code !== 0) {
        return NextResponse.json(
          {
            error: "Failed to load TikTok orders",
            detail: `${conn.shopName || conn.shopId || conn.id}: ${parseTikTokError(res)}`,
          },
          { status: 502 }
        );
      }

      for (const o of res.data?.orders ?? []) {
        allOrders.push({
          id: String(o.id ?? o.order_id ?? ""),
          status: o.status ?? null,
          createTime: o.create_time ?? null,
          updateTime: o.update_time ?? null,
          buyerEmail: o.buyer_email ?? null,
          payment: o.payment ?? null,
          lineItems: o.line_items ?? o.item_list ?? [],
          connectionId: conn.id,
          shopId: conn.shopId ?? null,
          shopName: conn.shopName ?? "TikTok Shop",
          raw: o,
        });
      }
    }

    allOrders.sort((a, b) => Number(b.createTime ?? 0) - Number(a.createTime ?? 0));

    return NextResponse.json({
      orders: allOrders,
      connections: connections.map((c) => ({
        id: c.id,
        shopId: c.shopId,
        shopName: c.shopName ?? "TikTok Shop",
      })),
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
