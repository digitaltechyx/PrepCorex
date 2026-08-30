import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import {
  extractDeliveryOptionId,
  extractDeliveryOptionName,
  fetchTikTokShippingProviders,
  loadTikTokOrderDetail,
} from "@/lib/tiktok-fulfillment";
import {
  getValidTikTokAccessToken,
  TikTokReconnectRequired,
} from "@/lib/tiktok-access-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/tiktok/shipping-providers?connectionId=&userId=&orderId=&deliveryOptionId=
 * Lists carriers eligible for an order's delivery option (admin or connection owner).
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
  const orderId = searchParams.get("orderId")?.trim() || "";
  let deliveryOptionId = searchParams.get("deliveryOptionId")?.trim() || "";
  let deliveryOptionName = searchParams.get("deliveryOptionName")?.trim() || "";

  if (!connectionId) {
    return NextResponse.json({ error: "Missing connectionId" }, { status: 400 });
  }
  if (userId !== callerUid && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const ref = adminDb()
      .collection("users")
      .doc(userId)
      .collection("tiktokConnections")
      .doc(connectionId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    const data = snap.data()!;
    const accessToken = await getValidTikTokAccessToken(ref, data);
    const shopCipher = (data.shopCipher as string) || null;

    if (orderId) {
      const loaded = await loadTikTokOrderDetail({ accessToken, shopCipher, orderId });
      if (loaded.order) {
        if (!deliveryOptionId) deliveryOptionId = extractDeliveryOptionId(loaded.order);
        if (!deliveryOptionName) deliveryOptionName = extractDeliveryOptionName(loaded.order);
      }
    }

    const listed = await fetchTikTokShippingProviders({
      accessToken,
      shopCipher,
      deliveryOptionId,
      deliveryOptionName,
    });

    return NextResponse.json({
      providers: listed.providers,
      deliveryOptionId: deliveryOptionId || null,
      ...(listed.errorDetail && listed.providers.length === 0
        ? { detail: listed.errorDetail }
        : {}),
    });
  } catch (err: unknown) {
    if (err instanceof TikTokReconnectRequired) {
      return NextResponse.json({ error: err.message, reconnect: true }, { status: 401 });
    }
    console.error("[tiktok/shipping-providers]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
