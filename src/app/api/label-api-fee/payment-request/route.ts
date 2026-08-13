import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { verifyBearerToken } from "@/lib/api-admin-auth";
import {
  isLabelApiFeeBlocking,
  labelApiFeePaymentPath,
  normalizeLabelApiFeeSettings,
  normalizeLabelBillingSettings,
} from "@/lib/label-billing";
import { clampLabelWalletProofUrls } from "@/lib/label-wallet-proof";
import { ensureLabelBillingPeriodRolled } from "@/lib/label-billing-admin";
import type { LabelBillingSettings } from "@/types";

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyBearerToken(request);
    if (!decoded?.uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      note?: string;
      receiptUrls?: string[];
    };

    const userId = decoded.uid;
    const settings = await ensureLabelBillingPeriodRolled(adminDb(), userId);
    const fee = normalizeLabelApiFeeSettings(settings.apiFee);

    if (!fee.enabled || fee.amountCents < 1) {
      return NextResponse.json(
        { error: "No API fee is required on this account." },
        { status: 400 }
      );
    }
    if (!isLabelApiFeeBlocking(settings)) {
      return NextResponse.json({ error: "API fee is already paid." }, { status: 400 });
    }
    if (fee.status === "pending") {
      return NextResponse.json(
        { error: "A payment request is already pending admin review." },
        { status: 400 }
      );
    }

    const receiptUrls = clampLabelWalletProofUrls(body.receiptUrls);
    if (receiptUrls.length < 1) {
      return NextResponse.json(
        { error: "Please upload at least one payment receipt screenshot." },
        { status: 400 }
      );
    }

    const note = String(body.note || "").trim().slice(0, 500);
    const userSnap = await adminDb().collection("users").doc(userId).get();
    const userData = userSnap.data() || {};
    const userName = String(userData.name || userData.displayName || userData.email || userId);

    const ref = adminDb().collection(labelApiFeePaymentPath(userId)).doc();
    await adminDb().runTransaction(async (tx) => {
      const userRef = adminDb().collection("users").doc(userId);
      const snap = await tx.get(userRef);
      const data = snap.data() || {};
      let next = normalizeLabelBillingSettings(
        (data.labelBilling as Partial<LabelBillingSettings> | undefined) || null
      );
      const currentFee = normalizeLabelApiFeeSettings(next.apiFee);
      if (!isLabelApiFeeBlocking(next) || currentFee.status === "pending") {
        throw new Error("API fee is already paid or pending.");
      }
      next = {
        ...next,
        apiFee: {
          ...currentFee,
          status: "pending",
          lastPaymentRequestId: ref.id,
          lastRejectionReason: null,
        },
      };
      tx.set(ref, {
        userId,
        userName,
        status: "pending",
        amountCents: currentFee.amountCents,
        cadence: currentFee.cadence,
        note: note || null,
        receiptUrls,
        adminEvidenceUrls: [],
        rejectionReason: null,
        paymentMethod: "ach_zelle",
        requestedAt: FieldValue.serverTimestamp(),
        requestedBy: userId,
        reviewedBy: null,
        reviewedByName: null,
        reviewedAt: null,
      });
      tx.set(
        userRef,
        { labelBilling: { ...next, updatedAt: FieldValue.serverTimestamp() } },
        { merge: true }
      );
    });

    return NextResponse.json({ ok: true, paymentRequestId: ref.id });
  } catch (error: unknown) {
    console.error("[label-api-fee/payment-request]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not submit API fee payment request.",
      },
      { status: 500 }
    );
  }
}
