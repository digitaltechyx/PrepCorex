import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { verifyBearerToken } from "@/lib/api-admin-auth";
import {
  canRequestLabelRefund,
  labelPurchaseAnchorMs,
  labelRefundRequestsPath,
} from "@/lib/label-refund";
import type { LabelPurchase } from "@/types";

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyBearerToken(request);
    if (!decoded?.uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      labelPurchaseId?: string;
      reason?: string;
    };

    const labelPurchaseId = String(body.labelPurchaseId || "").trim();
    const reason = String(body.reason || "").trim();
    if (!labelPurchaseId) {
      return NextResponse.json({ error: "labelPurchaseId is required." }, { status: 400 });
    }
    if (reason.length < 5) {
      return NextResponse.json(
        { error: "Please provide a refund reason (at least 5 characters)." },
        { status: 400 }
      );
    }
    if (reason.length > 1000) {
      return NextResponse.json({ error: "Refund reason is too long." }, { status: 400 });
    }

    const userId = decoded.uid;
    const labelRef = adminDb().collection(`users/${userId}/labelPurchases`).doc(labelPurchaseId);
    const labelSnap = await labelRef.get();
    if (!labelSnap.exists) {
      return NextResponse.json({ error: "Label purchase not found." }, { status: 404 });
    }

    const label = { id: labelSnap.id, ...labelSnap.data() } as LabelPurchase;
    const eligibility = canRequestLabelRefund(label);
    if (!eligibility.ok) {
      return NextResponse.json({ error: eligibility.reason || "Refund not allowed." }, { status: 400 });
    }

    const userSnap = await adminDb().collection("users").doc(userId).get();
    const userData = userSnap.data() || {};
    const userName = String(userData.name || userData.displayName || userData.email || userId);

    const anchorMs = labelPurchaseAnchorMs(label);
    const refundRef = adminDb().collection(labelRefundRequestsPath(userId)).doc();

    const payload = {
      userId,
      userName,
      labelPurchaseId,
      reason,
      status: "pending",
      paymentAmount: Math.max(0, Math.floor(Number(label.paymentAmount) || 0)),
      paymentCurrency: String(label.paymentCurrency || "usd").toLowerCase(),
      stripePaymentIntentId: label.stripePaymentIntentId,
      stripeChargeId: label.stripeChargeId || null,
      trackingNumber: label.trackingNumber || null,
      labelUrl: label.labelUrl || null,
      labelProvider: label.labelProvider || label.selectedRate?.labelProvider || null,
      carrierProvider: label.selectedRate?.provider || null,
      serviceLevel: label.selectedRate?.serviceLevel || null,
      labelGeneratedAtMs: anchorMs,
      requestedAt: FieldValue.serverTimestamp(),
      requestedBy: userId,
      reviewedBy: null,
      reviewedByName: null,
      reviewedAt: null,
      rejectionReason: null,
      stripeRefundId: null,
      refundedAmount: null,
    };

    const batch = adminDb().batch();
    batch.set(refundRef, payload);
    batch.update(labelRef, {
      refundStatus: "requested",
      refundRequestId: refundRef.id,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    return NextResponse.json({
      ok: true,
      refundRequestId: refundRef.id,
    });
  } catch (error: unknown) {
    console.error("[label-refunds/request]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not submit refund request." },
      { status: 500 }
    );
  }
}
