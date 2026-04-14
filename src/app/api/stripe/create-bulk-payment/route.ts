import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { adminDb, adminFieldValue } from "@/lib/firebase-admin";
import type { LabelPurchase } from "@/types";

type BulkItem = {
  fromAddress: LabelPurchase["fromAddress"];
  toAddress: LabelPurchase["toAddress"];
  parcel: LabelPurchase["parcel"];
  selectedRate: LabelPurchase["selectedRate"];
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, items } = body as { userId?: string; items?: BulkItem[] };

    if (!userId || !Array.isArray(items) || items.length === 0) {
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
    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalAmount,
      currency: firstCurrency,
      metadata: {
        userId,
        bulkCheckout: "true",
        itemCount: String(items.length),
      },
      automatic_payment_methods: {
        enabled: true,
      },
    });

    const batchId = `bulk_${Date.now()}`;
    const writes = items.map((item, index) => {
      const purchaseData: Omit<LabelPurchase, "id" | "createdAt"> & {
        bulkBatchId: string;
        bulkBatchIndex: number;
      } = {
        userId,
        purchasedBy: userId,
        fromAddress: item.fromAddress,
        toAddress: item.toAddress,
        parcel: item.parcel,
        selectedRate: item.selectedRate,
        stripePaymentIntentId: paymentIntent.id,
        paymentStatus: "pending",
        paymentAmount: Math.round(Number.parseFloat(item.selectedRate.amount) * 100),
        paymentCurrency: firstCurrency,
        status: "payment_pending",
        bulkBatchId: batchId,
        bulkBatchIndex: index,
      };

      return adminDb()
        .collection(`users/${userId}/labelPurchases`)
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
      { error: error?.message || "Failed to create bulk payment intent" },
      { status: 500 }
    );
  }
}

