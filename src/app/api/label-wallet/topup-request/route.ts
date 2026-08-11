import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { verifyBearerToken } from "@/lib/api-admin-auth";
import { labelWalletTopupPath } from "@/lib/label-billing";
import { clampLabelWalletProofUrls } from "@/lib/label-wallet-proof";
import { ensureLabelBillingPeriodRolled } from "@/lib/label-billing-admin";

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyBearerToken(request);
    if (!decoded?.uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      claimedAmountCents?: number;
      claimedAmountDollars?: number;
      note?: string;
      receiptUrls?: string[];
    };

    const userId = decoded.uid;
    const settings = await ensureLabelBillingPeriodRolled(adminDb(), userId);
    if (settings.mode !== "wallet") {
      return NextResponse.json(
        { error: "Wallet top-up is only available when admin enables wallet billing for your account." },
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

    const claimedAmountCents =
      body.claimedAmountCents != null
        ? Math.round(Number(body.claimedAmountCents))
        : body.claimedAmountDollars != null
          ? Math.round(Number(body.claimedAmountDollars) * 100)
          : null;

    if (claimedAmountCents != null && claimedAmountCents < 1) {
      return NextResponse.json({ error: "Claimed amount must be positive." }, { status: 400 });
    }

    const note = String(body.note || "").trim().slice(0, 500);
    const userSnap = await adminDb().collection("users").doc(userId).get();
    const userData = userSnap.data() || {};
    const userName = String(userData.name || userData.displayName || userData.email || userId);

    const ref = adminDb().collection(labelWalletTopupPath(userId)).doc();
    await ref.set({
      userId,
      userName,
      status: "pending",
      claimedAmountCents: claimedAmountCents && claimedAmountCents > 0 ? claimedAmountCents : null,
      note: note || null,
      receiptUrls,
      adminEvidenceUrls: [],
      creditedAmountCents: null,
      rejectionReason: null,
      requestedAt: FieldValue.serverTimestamp(),
      requestedBy: userId,
      reviewedBy: null,
      reviewedByName: null,
      reviewedAt: null,
    });

    return NextResponse.json({ ok: true, topupRequestId: ref.id });
  } catch (error: unknown) {
    console.error("[label-wallet/topup-request]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not submit top-up request." },
      { status: 500 }
    );
  }
}
