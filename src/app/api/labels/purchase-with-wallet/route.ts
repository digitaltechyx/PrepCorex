import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminFieldValue } from "@/lib/firebase-admin";
import { verifyBearerToken } from "@/lib/api-admin-auth";
import {
  applyLabelBillingSpend,
  appendLabelWalletLedger,
  ensureLabelBillingPeriodRolled,
  isLabelBillingExemptUser,
} from "@/lib/label-billing-admin";
import {
  buildShipBestCustomNo,
  purchaseLabelFromShipBest,
} from "@/lib/shipbest-purchase";
import { normalizeLabelBillingSettings } from "@/lib/label-billing";
import type { LabelBillingSettings } from "@/types";

const SHIPPO_API_BASE = "https://api.goshippo.com";

async function purchaseLabelFromShippo({
  rateId,
  labelPurchaseId,
  userId,
}: {
  rateId: string;
  labelPurchaseId: string;
  userId: string;
}) {
  if (!process.env.SHIPPO_API_KEY) {
    throw new Error("Shippo API key not configured");
  }

  const transactionResponse = await fetch(`${SHIPPO_API_BASE}/transactions/`, {
    method: "POST",
    headers: {
      Authorization: `ShippoToken ${process.env.SHIPPO_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ rate: rateId, async: false }),
  });

  const labelPurchaseRef = adminDb()
    .collection(`users/${userId}/labelPurchases`)
    .doc(labelPurchaseId);

  if (!transactionResponse.ok) {
    const errorData = await transactionResponse.json().catch(() => ({}));
    await labelPurchaseRef.update({
      status: "label_failed",
      errorMessage:
        (errorData as { detail?: string; message?: string }).detail ||
        (errorData as { message?: string }).message ||
        "Failed to purchase label",
    });
    throw new Error("Failed to purchase label from Shippo");
  }

  const transaction = await transactionResponse.json();
  await labelPurchaseRef.update({
    status: "label_purchased",
    shippoTransactionId: transaction.object_id,
    trackingNumber: transaction.tracking_number || null,
    labelUrl: transaction.label_url || null,
    labelPurchasedAt: adminFieldValue().serverTimestamp(),
  });
}

async function refundWalletSpend(userId: string, amountCents: number, labelPurchaseId: string, actorUid: string) {
  const userRef = adminDb().collection("users").doc(userId);
  const next = await adminDb().runTransaction(async (tx: any) => {
    const snap = await tx.get(userRef);
    const data = snap.data() || {};
    const settings = normalizeLabelBillingSettings(
      (data.labelBilling as Partial<LabelBillingSettings> | undefined) || null
    );
    const credit = Math.max(0, Math.floor(amountCents));
    const nextSettings: LabelBillingSettings = {
      ...settings,
      mode: "wallet",
      walletBalanceCents: (settings.walletBalanceCents || 0) + credit,
      periodUsedCents: Math.max(0, settings.periodUsedCents - credit),
    };
    tx.set(
      userRef,
      { labelBilling: { ...nextSettings, updatedAt: adminFieldValue().serverTimestamp() } },
      { merge: true }
    );
    return nextSettings;
  });

  await appendLabelWalletLedger(adminDb(), {
    userId,
    type: "purchase_refund",
    amountCents: Math.max(0, Math.floor(amountCents)),
    balanceAfterCents: next.walletBalanceCents || 0,
    periodUsedAfterCents: next.periodUsedCents,
    labelPurchaseId,
    reason: "Wallet refund after label purchase failure",
    createdBy: actorUid,
  });
}

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyBearerToken(request);
    if (!decoded?.uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      fromAddress,
      toAddress,
      parcel,
      selectedRate,
      shippedItemId,
    } = body;

    const userId = decoded.uid;
    if (!fromAddress || !toAddress || !parcel || !selectedRate) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (await isLabelBillingExemptUser(adminDb(), userId)) {
      return NextResponse.json(
        { error: "Admin accounts pay by card and are not limited by wallet or trial caps." },
        { status: 400 }
      );
    }

    const amount = Math.round(Number.parseFloat(String(selectedRate.amount || "0")) * 100);
    if (!Number.isFinite(amount) || amount < 1) {
      return NextResponse.json({ error: "Invalid rate amount" }, { status: 400 });
    }

    await ensureLabelBillingPeriodRolled(adminDb(), userId);

    const docRef = await adminDb().collection(`users/${userId}/labelPurchases`).add({
      userId,
      purchasedBy: userId,
      fromAddress,
      toAddress,
      parcel,
      selectedRate,
      stripePaymentIntentId: `wallet_${Date.now()}`,
      paymentMethod: "wallet",
      paymentStatus: "succeeded",
      paymentAmount: amount,
      paymentCurrency: String(selectedRate.currency || "usd").toLowerCase(),
      status: "payment_succeeded",
      labelProvider: selectedRate.labelProvider || "shippo",
      ...(shippedItemId ? { shippedItemId } : {}),
      createdAt: adminFieldValue().serverTimestamp(),
      paymentCompletedAt: adminFieldValue().serverTimestamp(),
    });

    let spent = false;
    try {
      await applyLabelBillingSpend(adminDb(), {
        userId,
        amountCents: amount,
        preferWallet: true,
        labelPurchaseId: docRef.id,
        actorUid: userId,
      });
      spent = true;

      const labelProvider =
        selectedRate?.labelProvider ||
        (String(selectedRate?.objectId || "").startsWith("shipbest:") ? "shipbest" : "shippo");

      if (labelProvider === "shipbest") {
        const logisticsProductCode =
          selectedRate?.logisticsProductCode ||
          String(selectedRate?.objectId || "").split(":")[2] ||
          "";
        const logisticsProductId =
          selectedRate?.logisticsProductId != null
            ? Number(selectedRate.logisticsProductId)
            : Number(String(selectedRate?.objectId || "").split(":")[1]) || undefined;

        if (!logisticsProductCode) {
          throw new Error("ShipBest logistics product code not found");
        }

        const customNo = buildShipBestCustomNo(userId, docRef.id);
        await purchaseLabelFromShipBest({
          labelPurchaseId: docRef.id,
          userId,
          customNo,
          logisticsProductCode,
          logisticsProductId,
          fromAddress,
          toAddress,
          parcel: {
            length: Number(parcel.length),
            width: Number(parcel.width),
            height: Number(parcel.height),
            weight: Number(parcel.weight),
          },
        });
      } else {
        if (!selectedRate?.objectId) {
          throw new Error("Rate ID not found");
        }
        await purchaseLabelFromShippo({
          rateId: selectedRate.objectId,
          labelPurchaseId: docRef.id,
          userId,
        });
      }

      return NextResponse.json({ ok: true, labelPurchaseId: docRef.id });
    } catch (err: unknown) {
      if (spent) {
        try {
          await refundWalletSpend(userId, amount, docRef.id, userId);
        } catch (refundErr) {
          console.error("[purchase-with-wallet] refund failed", refundErr);
        }
      }
      await docRef.update({
        status: "label_failed",
        errorMessage: err instanceof Error ? err.message : "Wallet label purchase failed",
      });
      throw err;
    }
  } catch (error: unknown) {
    console.error("[labels/purchase-with-wallet]", error);
    const code = (error as { code?: string })?.code;
    const status =
      code === "LIMIT_EXCEEDED" ||
      code === "WALLET_INSUFFICIENT" ||
      code === "WALLET_PERIOD_LIMIT" ||
      code === "WRONG_MODE"
        ? 400
        : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Wallet purchase failed." },
      { status }
    );
  }
}
