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
 * POST: Mark a TikTok order package as shipped with tracking.
 * Body: { connectionId, orderId, trackingNumber, shippingProviderId?, packageId? }
 *
 * If packageId is omitted, we look up packages for the order and ship the first open one.
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
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  const trackingNumber =
    typeof body.trackingNumber === "string" ? body.trackingNumber.trim() : "";
  let packageId = typeof body.packageId === "string" ? body.packageId.trim() : "";
  let shippingProviderId =
    typeof body.shippingProviderId === "string" ? body.shippingProviderId.trim() : "";

  if (!connectionId || !orderId || !trackingNumber) {
    return NextResponse.json(
      { error: "Missing connectionId, orderId, or trackingNumber" },
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

    if (!packageId) {
      const pkgRes = await tikTokApiRequest<{
        packages?: Array<{ id?: string; package_id?: string; status?: string }>;
      }>({
        method: "POST",
        path: "/fulfillment/202309/packages/search",
        accessToken,
        shopCipher,
        query: { page_size: 20 },
        body: { order_id: orderId },
      });
      if (pkgRes.code !== 0) {
        return NextResponse.json(
          { error: "Failed to load packages for order", detail: parseTikTokError(pkgRes) },
          { status: 502 }
        );
      }
      const first = pkgRes.data?.packages?.[0];
      packageId = String(first?.id || first?.package_id || "");
    }
    if (!packageId) {
      return NextResponse.json(
        { error: "No package found for this order. Create/arrange shipment in TikTok first, or pass packageId." },
        { status: 400 }
      );
    }

    if (!shippingProviderId) {
      const providersRes = await tikTokApiRequest<{
        shipping_providers?: Array<{ id?: string; name?: string }>;
        delivery_options?: Array<{
          shipping_provider_list?: Array<{ id?: string; name?: string }>;
        }>;
      }>({
        method: "GET",
        path: "/logistics/202309/shipping_providers",
        accessToken,
        shopCipher,
      });
      if (providersRes.code === 0) {
        const fromList = providersRes.data?.shipping_providers?.[0];
        const fromOptions =
          providersRes.data?.delivery_options?.[0]?.shipping_provider_list?.[0];
        shippingProviderId = String(fromList?.id || fromOptions?.id || "");
      }
    }

    const shipBody: Record<string, unknown> = {
      tracking_number: trackingNumber,
    };
    if (shippingProviderId) {
      shipBody.shipping_provider_id = shippingProviderId;
    }

    const shipRes = await tikTokApiRequest({
      method: "POST",
      path: `/fulfillment/202309/packages/${encodeURIComponent(packageId)}/shipping_info/update`,
      accessToken,
      shopCipher,
      body: shipBody,
    });

    if (shipRes.code !== 0) {
      // Fallback: some markets use /ship
      const alt = await tikTokApiRequest({
        method: "POST",
        path: "/fulfillment/202309/packages/ship",
        accessToken,
        shopCipher,
        body: {
          package_id: packageId,
          tracking_number: trackingNumber,
          ...(shippingProviderId ? { shipping_provider_id: shippingProviderId } : {}),
        },
      });
      if (alt.code !== 0) {
        return NextResponse.json(
          {
            error: "Failed to update delivery status",
            detail: parseTikTokError(shipRes),
            altDetail: parseTikTokError(alt),
          },
          { status: 502 }
        );
      }
    }

    return NextResponse.json({
      ok: true,
      packageId,
      trackingNumber,
      shippingProviderId: shippingProviderId || null,
    });
  } catch (err: unknown) {
    if (err instanceof TikTokReconnectRequired) {
      return NextResponse.json({ error: err.message, reconnect: true }, { status: 401 });
    }
    console.error("[tiktok/fulfill]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
