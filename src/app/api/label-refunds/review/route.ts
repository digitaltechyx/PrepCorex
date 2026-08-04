import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { requireAdmin } from "@/lib/api-admin-auth";
import { getStripe } from "@/lib/stripe";
import { labelRefundRequestsPath } from "@/lib/label-refund";
import type { LabelRefundRequest } from "@/types";

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    if (!admin.ok) {
      return NextResponse.json({ error: admin.error }, { status: admin.status });
    }

    const body = (await request.json()) as {
      userId?: string;
      refundRequestId?: string;
      action?: "approve" | "reject";
      rejectionReason?: string;
    };

    const userId = String(body.userId || "").trim();
    const refundRequestId = String(body.refundRequestId || "").trim();
    const action = body.action === "reject" ? "reject" : body.action === "approve" ? "approve" : null;

    if (!userId || !refundRequestId || !action) {
      return NextResponse.json(
        { error: "userId, refundRequestId, and action (approve|reject) are required." },
        { status: 400 }
      );
    }

    const refundRef = adminDb().collection(labelRefundRequestsPath(userId)).doc(refundRequestId);
    const refundSnap = await refundRef.get();
    if (!refundSnap.exists) {
      return NextResponse.json({ error: "Refund request not found." }, { status: 404 });
    }

    const refund = { id: refundSnap.id, ...refundSnap.data() } as LabelRefundRequest;
    if (String(refund.status || "").toLowerCase() !== "pending") {
      return NextResponse.json(
        { error: `Request is already ${refund.status}.` },
        { status: 400 }
      );
    }

    const labelRef = adminDb()
      .collection(`users/${userId}/labelPurchases`)
      .doc(refund.labelPurchaseId);
    const labelSnap = await labelRef.get();
    if (!labelSnap.exists) {
      return NextResponse.json({ error: "Linked label purchase not found." }, { status: 404 });
    }

    if (action === "reject") {
      const rejectionReason = String(body.rejectionReason || "").trim();
      if (rejectionReason.length < 3) {
        return NextResponse.json(
          { error: "Please provide a short rejection reason." },
          { status: 400 }
        );
      }

      const batch = adminDb().batch();
      batch.update(refundRef, {
        status: "rejected",
        rejectionReason,
        reviewedBy: admin.uid,
        reviewedByName: admin.name || null,
        reviewedAt: FieldValue.serverTimestamp(),
      });
      batch.update(labelRef, {
        refundStatus: "rejected",
        updatedAt: FieldValue.serverTimestamp(),
      });
      await batch.commit();

      await adminDb()
        .collection(`users/${userId}/notifications`)
        .add({
          type: "label_refund",
          title: "Label refund request declined",
          message: `Your refund request for label ${String(refund.labelPurchaseId).slice(0, 8)} was declined. ${rejectionReason}`,
          isRead: false,
          targetUrl: "/dashboard/purchased-labels",
          relatedRequestId: refundRequestId,
          relatedLabelPurchaseId: refund.labelPurchaseId,
          createdAt: FieldValue.serverTimestamp(),
          createdBy: admin.uid,
        });

      return NextResponse.json({ ok: true, status: "rejected" });
    }

    // Approve → Stripe refund (partial amount supports bulk PaymentIntents).
    const amount = Math.max(0, Math.floor(Number(refund.paymentAmount) || 0));
    if (amount < 1) {
      return NextResponse.json({ error: "Invalid refund amount." }, { status: 400 });
    }

    const stripe = getStripe();
    const stripeRefund = await stripe.refunds.create({
      payment_intent: refund.stripePaymentIntentId,
      amount,
      reason: "requested_by_customer",
      metadata: {
        userId,
        labelPurchaseId: refund.labelPurchaseId,
        refundRequestId,
        reviewedBy: admin.uid,
      },
    });

    const batch = adminDb().batch();
    batch.update(refundRef, {
      status: "approved",
      reviewedBy: admin.uid,
      reviewedByName: admin.name || null,
      reviewedAt: FieldValue.serverTimestamp(),
      stripeRefundId: stripeRefund.id,
      refundedAmount: amount,
      rejectionReason: null,
    });
    batch.update(labelRef, {
      refundStatus: "refunded",
      stripeRefundId: stripeRefund.id,
      refundedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    const money = `$${(amount / 100).toFixed(2)} ${String(refund.paymentCurrency || "usd").toUpperCase()}`;
    await adminDb()
      .collection(`users/${userId}/notifications`)
      .add({
        type: "label_refund",
        title: "Label refund approved",
        message: `Your refund of ${money} for label ${String(refund.labelPurchaseId).slice(0, 8)} was approved and sent to your original payment method.`,
        isRead: false,
        targetUrl: "/dashboard/purchased-labels",
        relatedRequestId: refundRequestId,
        relatedLabelPurchaseId: refund.labelPurchaseId,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: admin.uid,
      });

    return NextResponse.json({
      ok: true,
      status: "approved",
      stripeRefundId: stripeRefund.id,
      refundedAmount: amount,
    });
  } catch (error: unknown) {
    console.error("[label-refunds/review]", error);
    const message =
      error instanceof Error
        ? error.message
        : "Could not process refund request.";
    // Surface Stripe-ish messages cleanly
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
