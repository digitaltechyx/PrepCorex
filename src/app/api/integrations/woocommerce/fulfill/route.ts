import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb, adminFieldValue } from "@/lib/firebase-admin";
import { wooUpdateOrder } from "@/lib/woocommerce-api";

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

/**
 * POST: Mark WooCommerce order completed and optionally set tracking meta.
 * Body: { userId, connectionId, orderId, trackingNumber?, trackingProvider?, notifyNote? }
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = authHeader.slice(7).trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let callerUid: string;
  let isAdmin = false;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    callerUid = decoded.uid;
    const userDoc = await adminDb().collection("users").doc(callerUid).get();
    isAdmin = isAdminOrSubAdmin(userDoc.data() as Record<string, unknown> | undefined);
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || callerUid).trim();
  const connectionId = String(body.connectionId || "").trim();
  const orderId = Number(body.orderId);
  const trackingNumber =
    typeof body.trackingNumber === "string" ? body.trackingNumber.trim() : "";
  const trackingProvider =
    typeof body.trackingProvider === "string" ? body.trackingProvider.trim() : "";

  if (!connectionId || !Number.isFinite(orderId) || orderId <= 0) {
    return NextResponse.json(
      { error: "connectionId and orderId are required" },
      { status: 400 }
    );
  }
  if (userId !== callerUid && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const connSnap = await adminDb()
      .collection("users")
      .doc(userId)
      .collection("woocommerceConnections")
      .doc(connectionId)
      .get();
    if (!connSnap.exists) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    const data = connSnap.data() || {};
    const storeUrl = String(data.storeUrl || "").trim();
    const consumerKey = String(data.consumerKey || "").trim();
    const consumerSecret = String(data.consumerSecret || "").trim();
    if (!storeUrl || !consumerKey || !consumerSecret) {
      return NextResponse.json({ error: "Credentials missing" }, { status: 400 });
    }

    const meta_data: Array<{ key: string; value: string }> = [];
    if (trackingNumber) {
      meta_data.push(
        { key: "_tracking_number", value: trackingNumber },
        { key: "tracking_number", value: trackingNumber }
      );
    }
    if (trackingProvider) {
      meta_data.push(
        { key: "_tracking_provider", value: trackingProvider },
        { key: "tracking_provider", value: trackingProvider }
      );
    }

    const noteParts = ["Fulfilled via PrepCorex."];
    if (trackingProvider) noteParts.push(`Carrier: ${trackingProvider}.`);
    if (trackingNumber) noteParts.push(`Tracking: ${trackingNumber}.`);

    const updated = await wooUpdateOrder(
      { storeUrl, consumerKey, consumerSecret },
      orderId,
      {
        status: "completed",
        customer_note: noteParts.join(" "),
        ...(meta_data.length ? { meta_data } : {}),
      }
    );

    const docId = `${connectionId}_${orderId}`;
    await adminDb()
      .collection("users")
      .doc(userId)
      .collection("woocommerceOrders")
      .doc(docId)
      .set(
        {
          status: updated.status || "completed",
          trackingNumber: trackingNumber || null,
          trackingProvider: trackingProvider || null,
          fulfilledInPrepCorex: true,
          dateModified: updated.date_modified || new Date().toISOString(),
          syncedAt: new Date().toISOString(),
          updatedAt: adminFieldValue().serverTimestamp(),
        },
        { merge: true }
      );

    return NextResponse.json({
      ok: true,
      orderId,
      status: updated.status || "completed",
      trackingNumber: trackingNumber || null,
    });
  } catch (error: unknown) {
    console.error("[woocommerce fulfill]", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to fulfill WooCommerce order",
      },
      { status: 500 }
    );
  }
}
