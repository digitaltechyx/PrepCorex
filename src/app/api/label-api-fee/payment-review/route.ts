import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { requireAdmin } from "@/lib/api-admin-auth";
import {
  labelApiFeePaymentPath,
  normalizeLabelApiFeeSettings,
  normalizeLabelBillingSettings,
} from "@/lib/label-billing";
import { markLabelApiFeePaid } from "@/lib/label-billing-admin";
import { clampLabelWalletProofUrls } from "@/lib/label-wallet-proof";
import type { LabelApiFeePaymentRequest, LabelBillingSettings } from "@/types";

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    if (!admin.ok) {
      return NextResponse.json({ error: admin.error }, { status: admin.status });
    }

    const body = (await request.json()) as {
      userId?: string;
      paymentRequestId?: string;
      action?: "approve" | "reject";
      rejectionReason?: string;
      adminEvidenceUrls?: string[];
    };

    const userId = String(body.userId || "").trim();
    const paymentRequestId = String(body.paymentRequestId || "").trim();
    const action =
      body.action === "reject" ? "reject" : body.action === "approve" ? "approve" : null;
    const adminEvidenceUrls = clampLabelWalletProofUrls(body.adminEvidenceUrls);

    if (!userId || !paymentRequestId || !action) {
      return NextResponse.json(
        { error: "userId, paymentRequestId, and action (approve|reject) are required." },
        { status: 400 }
      );
    }

    const requestRef = adminDb().collection(labelApiFeePaymentPath(userId)).doc(paymentRequestId);
    const requestSnap = await requestRef.get();
    if (!requestSnap.exists) {
      return NextResponse.json({ error: "API fee payment request not found." }, { status: 404 });
    }

    const payment = {
      id: requestSnap.id,
      ...requestSnap.data(),
    } as LabelApiFeePaymentRequest;
    if (String(payment.status || "").toLowerCase() !== "pending") {
      return NextResponse.json({ error: `Request is already ${payment.status}.` }, { status: 400 });
    }

    if (action === "reject") {
      const rejectionReason = String(body.rejectionReason || "").trim();
      if (rejectionReason.length < 3) {
        return NextResponse.json(
          { error: "Please provide a short rejection reason." },
          { status: 400 }
        );
      }

      await adminDb().runTransaction(async (tx) => {
        const userRef = adminDb().collection("users").doc(userId);
        const snap = await tx.get(userRef);
        const data = snap.data() || {};
        let settings = normalizeLabelBillingSettings(
          (data.labelBilling as Partial<LabelBillingSettings> | undefined) || null
        );
        const fee = normalizeLabelApiFeeSettings(settings.apiFee);
        settings = {
          ...settings,
          apiFee: {
            ...fee,
            status: "rejected",
            lastRejectionReason: rejectionReason,
            lastPaymentRequestId: paymentRequestId,
          },
        };
        tx.update(requestRef, {
          status: "rejected",
          rejectionReason,
          adminEvidenceUrls,
          reviewedBy: admin.uid,
          reviewedByName: admin.name || null,
          reviewedAt: FieldValue.serverTimestamp(),
        });
        tx.set(
          userRef,
          { labelBilling: { ...settings, updatedAt: FieldValue.serverTimestamp() } },
          { merge: true }
        );
      });

      await adminDb()
        .collection(`users/${userId}/notifications`)
        .add({
          type: "label_api_fee",
          title: "API fee payment declined",
          message: rejectionReason,
          paymentRequestId,
          status: "rejected",
          createdAt: FieldValue.serverTimestamp(),
          read: false,
        });

      return NextResponse.json({ ok: true });
    }

    await requestRef.update({
      status: "approved",
      adminEvidenceUrls,
      reviewedBy: admin.uid,
      reviewedByName: admin.name || null,
      reviewedAt: FieldValue.serverTimestamp(),
    });

    await markLabelApiFeePaid(adminDb(), {
      userId,
      paymentRequestId,
      actorUid: admin.uid,
    });

    await adminDb()
      .collection(`users/${userId}/notifications`)
      .add({
        type: "label_api_fee",
        title: "API fee paid",
        message: "Your Buy Labels API fee payment was approved. You can buy labels again.",
        paymentRequestId,
        status: "approved",
        amountCents: payment.amountCents || null,
        createdAt: FieldValue.serverTimestamp(),
        read: false,
      });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error("[label-api-fee/payment-review]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not review API fee payment.",
      },
      { status: 500 }
    );
  }
}
