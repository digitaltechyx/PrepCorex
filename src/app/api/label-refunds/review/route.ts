import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { requireAdmin } from "@/lib/api-admin-auth";
import { creditLabelWalletRefund } from "@/lib/label-billing-admin";
import { getStripe } from "@/lib/stripe";
import {
  isStripePaymentIntentId,
  isWalletLabelPayment,
  labelRefundRequestsPath,
} from "@/lib/label-refund";
import type { LabelPurchase, LabelRefundRequest } from "@/types";

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

    const label = { id: labelSnap.id, ...labelSnap.data() } as LabelPurchase;

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
        refundRejectionReason: rejectionReason,
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

    const amount = Math.max(0, Math.floor(Number(refund.paymentAmount) || 0));
    if (amount < 1) {
      return NextResponse.json({ error: "Invalid refund amount." }, { status: 400 });
    }

    const walletRefund = isWalletLabelPayment(label);
    const paymentIntentId = String(refund.stripePaymentIntentId || label.stripePaymentIntentId || "").trim();

    if (!walletRefund && !isStripePaymentIntentId(paymentIntentId)) {
      return NextResponse.json(
        {
          error:
            "This label has no Stripe payment reference. If it was paid from the label wallet, sync the purchase record or contact support.",
        },
        { status: 400 }
      );
    }

    const money = `$${(amount / 100).toFixed(2)} ${String(refund.paymentCurrency || "usd").toUpperCase()}`;

    if (walletRefund) {
      await creditLabelWalletRefund(adminDb(), {
        userId,
        amountCents: amount,
        labelPurchaseId: refund.labelPurchaseId,
        refundRequestId,
        actorUid: admin.uid,
        actorName: admin.name || null,
        reason: `Admin-approved label refund for ${refund.labelPurchaseId.slice(0, 8)}`,
      });

      const batch = adminDb().batch();
      batch.update(refundRef, {
        status: "approved",
        refundMethod: "wallet",
        reviewedBy: admin.uid,
        reviewedByName: admin.name || null,
        reviewedAt: FieldValue.serverTimestamp(),
        stripeRefundId: null,
        refundedAmount: amount,
        rejectionReason: null,
      });
      batch.update(labelRef, {
        refundStatus: "refunded",
        refundRejectionReason: null,
        stripeRefundId: null,
        refundedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await batch.commit();

      await adminDb()
        .collection(`users/${userId}/notifications`)
        .add({
          type: "label_refund",
          title: "Label refund approved",
          message: `Your refund of ${money} for label ${String(refund.labelPurchaseId).slice(0, 8)} was approved and credited to your label wallet.`,
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
        refundMethod: "wallet",
        refundedAmount: amount,
      });
    }

    const stripe = getStripe();
    const stripeRefund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
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
      refundMethod: "stripe",
      reviewedBy: admin.uid,
      reviewedByName: admin.name || null,
      reviewedAt: FieldValue.serverTimestamp(),
      stripeRefundId: stripeRefund.id,
      refundedAmount: amount,
      rejectionReason: null,
    });
    batch.update(labelRef, {
      refundStatus: "refunded",
      refundRejectionReason: null,
      stripeRefundId: stripeRefund.id,
      refundedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();

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
      refundMethod: "stripe",
      stripeRefundId: stripeRefund.id,
      refundedAmount: amount,
    });
  } catch (error: unknown) {
    console.error("[label-refunds/review]", error);
    const message =
      error instanceof Error
        ? error.message
        : "Could not process refund request.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
