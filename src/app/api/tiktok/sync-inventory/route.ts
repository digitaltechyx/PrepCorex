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
 * POST: Push PrepCorex quantity to TikTok Shop SKU inventory.
 * Body: { connectionId, productId, skuId, quantity, warehouseId? }
 */
export async function POST(request: NextRequest) {
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

  const body = await request.json().catch(() => ({}));
  const userId = (typeof body.userId === "string" && body.userId.trim()) || callerUid;
  const connectionId = typeof body.connectionId === "string" ? body.connectionId.trim() : "";
  const productId = typeof body.productId === "string" ? body.productId.trim() : "";
  const skuId = typeof body.skuId === "string" ? body.skuId.trim() : "";
  const quantity =
    typeof body.quantity === "number" ? Math.max(0, Math.floor(body.quantity)) : undefined;
  let warehouseId = typeof body.warehouseId === "string" ? body.warehouseId.trim() : "";

  if (!connectionId || !productId || !skuId || quantity === undefined) {
    return NextResponse.json(
      { error: "Missing connectionId, productId, skuId, or quantity" },
      { status: 400 }
    );
  }
  if (userId !== callerUid && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const db = adminDb();
    const ref = db.collection("users").doc(userId).collection("tiktokConnections").doc(connectionId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    const data = snap.data()!;
    const accessToken = await getValidTikTokAccessToken(ref, data);
    const shopCipher = (data.shopCipher as string) || null;

    if (!warehouseId) {
      const whRes = await tikTokApiRequest<{
        warehouses?: Array<{ id?: string; warehouse_id?: string; name?: string }>;
      }>({
        method: "GET",
        path: "/logistics/202309/warehouses",
        accessToken,
        shopCipher,
      });
      if (whRes.code === 0) {
        const first = whRes.data?.warehouses?.[0];
        warehouseId = String(first?.id || first?.warehouse_id || "");
      }
    }
    if (!warehouseId) {
      return NextResponse.json(
        { error: "No TikTok warehouse found. Pass warehouseId or configure a warehouse in Seller Center." },
        { status: 400 }
      );
    }

    const res = await tikTokApiRequest({
      method: "POST",
      path: `/product/202309/products/${encodeURIComponent(productId)}/inventory/update`,
      accessToken,
      shopCipher,
      body: {
        skus: [
          {
            id: skuId,
            inventory: [{ warehouse_id: warehouseId, quantity }],
          },
        ],
      },
    });

    if (res.code !== 0) {
      return NextResponse.json(
        { error: "Failed to update TikTok inventory", detail: parseTikTokError(res) },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, warehouseId, quantity });
  } catch (err: unknown) {
    if (err instanceof TikTokReconnectRequired) {
      return NextResponse.json({ error: err.message, reconnect: true }, { status: 401 });
    }
    console.error("[tiktok/sync-inventory]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
