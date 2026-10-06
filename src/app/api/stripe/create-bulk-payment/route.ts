import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { adminDb, adminFieldValue } from "@/lib/firebase-admin";
import { verifyBearerToken } from "@/lib/api-admin-auth";
import { assertCanSpendLabelBilling } from "@/lib/label-billing-admin";
import { getOrCreateStripeCustomer } from "@/lib/stripe-customer";
import type { LabelPurchase } from "@/types";

type BulkItem = {
  fromAddress: LabelPurchase["fromAddress"];
  toAddress: LabelPurchase["toAddress"];
  parcel: LabelPurchase["parcel"];
  selectedRate: LabelPurchase["selectedRate"];
};

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyBearerToken(request);
    if (!decoded?.uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      userId,
      items,
      saveCard = false,
      paymentMethodId = null,
    } = body as {
      userId?: string;
      items?: BulkItem[];
      saveCard?: boolean;
      paymentMethodId?: string | null;
    };

    const uid = String(userId || decoded.uid).trim();
    if (uid !== decoded.uid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!uid || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "Missing required fields: userId and items[]" },
        { status: 400 }
      );
    }

    const totalAmount = items.reduce((sum, item) => {
      const cents = Math.round(Number.parseFloat(item?.selectedRate?.amount || "0") * 100);
      return sum + (Number.isFinite(cents) ? cents : 0);
    }, 0);

    if (totalAmount <= 0) {
      return NextResponse.json(
        { error: "Invalid total amount for bulk checkout" },
        { status: 400 }
      );
    }

    try {
      await assertCanSpendLabelBilling(adminDb(), {
        userId: uid,
        amountCents: totalAmount,
        preferWallet: false,
      });
    } catch (gateErr: unknown) {
      const code = (gateErr as { code?: string })?.code;
      const status =
        code === "LIMIT_EXCEEDED" || code === "WRONG_MODE" || code === "WALLET_INSUFFICIENT"
          ? 400
          : 500;
      return NextResponse.json(
        { error: gateErr instanceof Error ? gateErr.message : "Purchase not allowed." },
        { status }
      );
    }

    const firstCurrency = (items[0]?.selectedRate?.currency || "usd").toLowerCase();
    const mixedCurrency = items.some(
      (item) => (item?.selectedRate?.currency || "usd").toLowerCase() !== firstCurrency
    );
    if (mixedCurrency) {
      return NextResponse.json(
        { error: "All cart labels must use the same currency" },
        { status: 400 }
      );
    }

    const stripe = getStripe();
    const customerId = await getOrCreateStripeCustomer(uid);
    const pmId =
      typeof paymentMethodId === "string" && paymentMethodId.trim()
        ? paymentMethodId.trim()
        : null;
    const shouldSaveCard = Boolean(saveCard) && !pmId;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalAmount,
      currency: firstCurrency,
      customer: customerId,
      ...(pmId ? { payment_method: pmId } : {}),
      ...(shouldSaveCard ? { setup_future_usage: "off_session" as const } : {}),
      metadata: {
        userId: uid,
        bulkCheckout: "true",
        itemCount: String(items.length),
        saveCard: shouldSaveCard ? "true" : "false",
      },
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: "never",
      },
    });

    const batchId = `bulk_${Date.now()}`;
    const writes = items.map((item, index) => {
      const purchaseData: Omit<LabelPurchase, "id" | "createdAt"> & {
        bulkBatchId: string;
        bulkBatchIndex: number;
      } = {
        userId: uid,
        purchasedBy: uid,
        fromAddress: item.fromAddress,
        toAddress: item.toAddress,
        parcel: item.parcel,
        selectedRate: item.selectedRate,
        stripePaymentIntentId: paymentIntent.id,
        paymentStatus: "pending",
        paymentAmount: Math.round(Number.parseFloat(item.selectedRate.amount) * 100),
        paymentCurrency: firstCurrency,
        status: "payment_pending",
        labelProvider: item.selectedRate.labelProvider || "shippo",
        bulkBatchId: batchId,
        bulkBatchIndex: index,
      };

      return adminDb()
        .collection(`users/${uid}/labelPurchases`)
        .add({
          ...purchaseData,
          createdAt: adminFieldValue().serverTimestamp(),
        });
    });

    await Promise.all(writes);

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: totalAmount,
      currency: firstCurrency,
      itemCount: items.length,
    });
  } catch (error: any) {
    console.error("Error creating bulk payment intent:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to create bulk payment" },
      { status: 500 }
    );
  }
}
