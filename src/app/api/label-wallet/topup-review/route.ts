import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { requireAdmin } from "@/lib/api-admin-auth";
import { labelWalletTopupPath } from "@/lib/label-billing";
import {
  appendLabelWalletLedger,
  ensureLabelBillingPeriodRolled,
} from "@/lib/label-billing-admin";
import { clampLabelWalletProofUrls } from "@/lib/label-wallet-proof";
import { normalizeLabelBillingSettings } from "@/lib/label-billing";
import type { LabelBillingSettings, LabelWalletTopupRequest } from "@/types";

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    if (!admin.ok) {
      return NextResponse.json({ error: admin.error }, { status: admin.status });
    }

    const body = (await request.json()) as {
      userId?: string;
      topupRequestId?: string;
      action?: "approve" | "reject";
      creditedAmountCents?: number;
      creditedAmountDollars?: number;
      rejectionReason?: string;
      adminEvidenceUrls?: string[];
    };

    const userId = String(body.userId || "").trim();
    const topupRequestId = String(body.topupRequestId || "").trim();
    const action = body.action === "reject" ? "reject" : body.action === "approve" ? "approve" : null;
    const adminEvidenceUrls = clampLabelWalletProofUrls(body.adminEvidenceUrls);

    if (!userId || !topupRequestId || !action) {
      return NextResponse.json(
        { error: "userId, topupRequestId, and action (approve|reject) are required." },
        { status: 400 }
      );
    }

    const requestRef = adminDb().collection(labelWalletTopupPath(userId)).doc(topupRequestId);
    const requestSnap = await requestRef.get();
    if (!requestSnap.exists) {
      return NextResponse.json({ error: "Top-up request not found." }, { status: 404 });
    }

    const topup = { id: requestSnap.id, ...requestSnap.data() } as LabelWalletTopupRequest;
    if (String(topup.status || "").toLowerCase() !== "pending") {
      return NextResponse.json({ error: `Request is already ${topup.status}.` }, { status: 400 });
    }

    if (action === "reject") {
      const rejectionReason = String(body.rejectionReason || "").trim();
      if (rejectionReason.length < 3) {
        return NextResponse.json(
          { error: "Please provide a short rejection reason." },
          { status: 400 }
        );
      }

      await requestRef.update({
        status: "rejected",
        rejectionReason,
        adminEvidenceUrls,
        reviewedBy: admin.uid,
        reviewedByName: admin.name || null,
        reviewedAt: FieldValue.serverTimestamp(),
      });

      await appendLabelWalletLedger(adminDb(), {
        userId,
        type: "topup",
        amountCents: 0,
        balanceAfterCents: (await ensureLabelBillingPeriodRolled(adminDb(), userId)).walletBalanceCents || 0,
        reason: `Top-up rejected: ${rejectionReason}`,
        receiptUrls: topup.receiptUrls || [],
        adminEvidenceUrls,
        topupRequestId,
        createdBy: admin.uid,
        createdByName: admin.name || null,
      });

      await adminDb()
        .collection(`users/${userId}/notifications`)
        .add({
          type: "label_wallet_topup",
          title: "Wallet top-up declined",
          message: rejectionReason,
          topupRequestId,
          status: "rejected",
          createdAt: FieldValue.serverTimestamp(),
          read: false,
        });

      return NextResponse.json({ ok: true });
    }

    const creditedAmountCents =
      body.creditedAmountCents != null
        ? Math.round(Number(body.creditedAmountCents))
        : body.creditedAmountDollars != null
          ? Math.round(Number(body.creditedAmountDollars) * 100)
          : topup.claimedAmountCents != null
            ? Math.round(Number(topup.claimedAmountCents))
            : 0;

    if (!Number.isFinite(creditedAmountCents) || creditedAmountCents < 1) {
      return NextResponse.json(
        { error: "Enter the balance amount (USD) to credit on approve." },
        { status: 400 }
      );
    }

    const userRef = adminDb().collection("users").doc(userId);
    const nextSettings = await adminDb().runTransaction(async (tx: any) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) throw new Error("User not found.");
      const data = snap.data() || {};
      const settings = normalizeLabelBillingSettings(
        (data.labelBilling as Partial<LabelBillingSettings> | undefined) || null
      );
      const newBal = (settings.walletBalanceCents || 0) + creditedAmountCents;
      const next: LabelBillingSettings = {
        ...settings,
        mode: "wallet",
        walletBalanceCents: newBal,
      };
      tx.set(
        userRef,
        { labelBilling: { ...next, updatedAt: FieldValue.serverTimestamp() } },
        { merge: true }
      );
      tx.update(requestRef, {
        status: "approved",
        creditedAmountCents,
        adminEvidenceUrls,
        reviewedBy: admin.uid,
        reviewedByName: admin.name || null,
        reviewedAt: FieldValue.serverTimestamp(),
      });
      return next;
    });

    await appendLabelWalletLedger(adminDb(), {
      userId,
      type: "topup",
      amountCents: creditedAmountCents,
      balanceAfterCents: nextSettings.walletBalanceCents || 0,
      periodUsedAfterCents: nextSettings.periodUsedCents,
      reason: "Wallet top-up approved",
      receiptUrls: topup.receiptUrls || [],
      adminEvidenceUrls,
      topupRequestId,
      createdBy: admin.uid,
      createdByName: admin.name || null,
    });

    await adminDb()
      .collection(`users/${userId}/notifications`)
      .add({
        type: "label_wallet_topup",
        title: "Wallet top-up approved",
        message: `$${ (creditedAmountCents / 100).toFixed(2) } was added to your Buy Labels wallet.`,
        topupRequestId,
        status: "approved",
        amountCents: creditedAmountCents,
        createdAt: FieldValue.serverTimestamp(),
        read: false,
      });

    return NextResponse.json({ ok: true, settings: nextSettings });
  } catch (error: unknown) {
    console.error("[label-wallet/topup-review]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not process top-up." },
      { status: 500 }
    );
  }
}
