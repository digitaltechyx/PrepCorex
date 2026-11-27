import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminFieldValue } from "@/lib/firebase-admin";
import { verifyBearerToken } from "@/lib/api-admin-auth";
import { resolveShipBestCustomNo } from "@/lib/label-refund";
import { shipbestOrderDetail } from "@/lib/shipbest-api";
import type { LabelPurchase } from "@/types";

/**
 * Re-fetch ShipBest order detail and persist labelUrl / tracking when the PDF
 * was not ready at purchase time (tracking arrived first).
 */
export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyBearerToken(request);
    if (!decoded?.uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      labelPurchaseId?: string;
      userId?: string;
    };

    const labelPurchaseId = String(body.labelPurchaseId || "").trim();
    if (!labelPurchaseId) {
      return NextResponse.json({ error: "labelPurchaseId is required." }, { status: 400 });
    }

    const requestedUserId = String(body.userId || "").trim();
    const userId = requestedUserId || decoded.uid;
    // Clients may only refresh their own labels. Admins can pass another userId.
    if (userId !== decoded.uid) {
      const adminSnap = await adminDb().collection("users").doc(decoded.uid).get();
      const roles = (adminSnap.data()?.roles || []) as string[];
      const isAdmin =
        Array.isArray(roles) &&
        roles.some((r) => ["admin", "super_admin", "warehouse"].includes(String(r)));
      if (!isAdmin) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    if (!process.env.SHIPBEST_API_ID || !process.env.SHIPBEST_ACCESS_TOKEN) {
      return NextResponse.json(
        { error: "ShipBest API credentials not configured" },
        { status: 500 }
      );
    }

    const labelRef = adminDb()
      .collection(`users/${userId}/labelPurchases`)
      .doc(labelPurchaseId);
    const labelSnap = await labelRef.get();
    if (!labelSnap.exists) {
      return NextResponse.json({ error: "Label purchase not found." }, { status: 404 });
    }

    const label = { id: labelSnap.id, ...labelSnap.data() } as LabelPurchase;
    const existingUrl = String(label.labelUrl || "").trim();
    if (existingUrl) {
      return NextResponse.json({
        success: true,
        labelUrl: existingUrl,
        trackingNumber: label.trackingNumber || null,
        alreadyHadLabel: true,
      });
    }

    const customNo = resolveShipBestCustomNo(
      userId,
      labelPurchaseId,
      label.shipbestCustomNo
    );
    const orderNo = String(label.shipbestOrderNo || "").trim();
    if (!customNo && !orderNo) {
      return NextResponse.json(
        { error: "This purchase has no ShipBest order reference to refresh." },
        { status: 400 }
      );
    }

    const detail = await shipbestOrderDetail({
      ...(orderNo ? { orderNo } : {}),
      ...(customNo ? { customNo } : {}),
    });

    if (!detail) {
      return NextResponse.json(
        { error: "ShipBest did not return order detail. Try again shortly." },
        { status: 502 }
      );
    }

    const labelUrl = String(detail.labelUrl || "").trim();
    const trackingNumber =
      String(detail.trackingNo || "").trim() ||
      String(label.trackingNumber || "").trim() ||
      null;

    if (!labelUrl) {
      return NextResponse.json(
        {
          error:
            "Label PDF is not ready on ShipBest yet. Tracking may already exist — try again in a minute.",
          trackingNumber,
        },
        { status: 409 }
      );
    }

    await labelRef.update({
      labelUrl,
      ...(trackingNumber ? { trackingNumber } : {}),
      ...(detail.orderNo ? { shipbestOrderNo: detail.orderNo } : {}),
      ...(customNo ? { shipbestCustomNo: customNo } : {}),
      labelProvider: "shipbest",
      updatedAt: adminFieldValue().serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      labelUrl,
      trackingNumber,
      alreadyHadLabel: false,
    });
  } catch (error: unknown) {
    console.error("[shipbest/refresh-label]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to refresh ShipBest label",
      },
      { status: 500 }
    );
  }
}
