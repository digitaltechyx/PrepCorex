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
 * POST: Mark an Etsy receipt shipped (createReceiptShipment).
 * Body: { connectionId, receiptId, trackingCode, carrierName, userId?, sendBcc? }
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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const userId =
    typeof body.userId === "string" && body.userId.trim() ? body.userId.trim() : callerUid;
  const connectionId =
    typeof body.connectionId === "string" ? body.connectionId.trim() : "";
  const receiptId = String(body.receiptId ?? body.orderId ?? "").trim();
  const trackingCode = String(body.trackingCode ?? body.trackingNumber ?? "").trim();
  const carrierName = String(body.carrierName ?? body.carrier ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  const sendBcc = body.sendBcc === true;

  if (userId !== callerUid && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!connectionId || !receiptId) {
    return NextResponse.json(
      { error: "Missing connectionId or receiptId" },
      { status: 400 }
    );
  }
  if (!trackingCode || !carrierName) {
    return NextResponse.json(
      { error: "trackingCode and carrierName are required" },
      { status: 400 }
    );
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
      return NextResponse.json({ error: "Shop id missing on connection" }, { status: 400 });
    }

    const accessToken = await getValidEtsyAccessToken(ref, data);
    const receipt = await etsyApiRequest<EtsyReceipt>({
      method: "POST",
      path: `/shops/${encodeURIComponent(shopId)}/receipts/${encodeURIComponent(receiptId)}/tracking`,
      accessToken,
      formBody: {
        tracking_code: trackingCode,
        carrier_name: carrierName,
        send_bcc: sendBcc,
      },
    });

    return NextResponse.json({
      ok: true,
      receiptId: String(receipt.receipt_id ?? receiptId),
      isShipped: Boolean(receipt.is_shipped ?? true),
      status: receipt.status ?? null,
    });
  } catch (err: unknown) {
    if (err instanceof EtsyReconnectRequired) {
      return NextResponse.json({ error: err.message, reconnect: true }, { status: 401 });
    }
    console.error("[etsy/fulfill]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to mark Etsy order shipped" },
      { status: 500 }
    );
  }
}
