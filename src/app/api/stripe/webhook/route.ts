import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { adminDb, adminFieldValue } from '@/lib/firebase-admin';
import {
  buildShipBestCustomNo,
  purchaseLabelFromShipBest,
} from '@/lib/shipbest-purchase';
import Stripe from 'stripe';

const SHIPPO_API_BASE = 'https://api.goshippo.com';

async function purchaseLabelFromShippo({
  rateId,
  shipmentId,
  labelPurchaseId,
  userId,
}: {
  rateId: string;
  shipmentId: string;
  labelPurchaseId: string;
  userId: string;
}) {
  try {
    if (!process.env.SHIPPO_API_KEY) {
      throw new Error('Shippo API key not configured');
    }

    // Purchase label from Shippo
    const transactionResponse = await fetch(`${SHIPPO_API_BASE}/transactions/`, {
      method: 'POST',
      headers: {
        'Authorization': `ShippoToken ${process.env.SHIPPO_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        rate: rateId,
        async: false,
      }),
    });

    if (!transactionResponse.ok) {
      const errorData = await transactionResponse.json();
      console.error('Shippo label purchase error:', errorData);
      
      // Update label purchase record with error
      const labelPurchaseRef = adminDb()
        .collection(`users/${userId}/labelPurchases`)
        .doc(labelPurchaseId);
      await labelPurchaseRef.update({
        status: 'label_failed',
        errorMessage: errorData.detail || errorData.message || 'Failed to purchase label',
      });
      return;
    }

    const transaction = await transactionResponse.json();

    // Update label purchase record with Shippo transaction details
    const labelPurchaseRef = adminDb()
      .collection(`users/${userId}/labelPurchases`)
      .doc(labelPurchaseId);
    await labelPurchaseRef.update({
      status: 'label_purchased',
      shippoTransactionId: transaction.object_id,
      trackingNumber: transaction.tracking_number || null,
      labelUrl: transaction.label_url || null,
      labelPurchasedAt: adminFieldValue().serverTimestamp(),
    });

    console.log(`Label purchased successfully: ${transaction.object_id}`);
  } catch (error: any) {
    console.error('Error purchasing label:', error);
    const labelPurchaseRef = adminDb()
      .collection(`users/${userId}/labelPurchases`)
      .doc(labelPurchaseId);
    await labelPurchaseRef.update({
      status: 'label_failed',
      errorMessage: error.message || 'Error purchasing label',
    });
  }
}

// Disable body parsing, need raw body for webhook signature verification
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET is not set in environment variables');
    return NextResponse.json(
      { error: 'Webhook secret not configured' },
      { status: 500 }
    );
  }

  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json(
      { error: 'No signature provided' },
      { status: 400 }
    );
  }

  // Get Stripe instance (lazy initialization)
  const stripe = getStripe();

  let event: Stripe.Event;

  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message);
    return NextResponse.json(
      { error: `Webhook Error: ${err.message}` },
      { status: 400 }
    );
  }

  try {
    // Handle the event
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handlePaymentSuccess(paymentIntent);
        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handlePaymentFailure(paymentIntent);
        break;
      }

      case 'payment_intent.canceled': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handlePaymentCanceled(paymentIntent);
        break;
      }

      case 'charge.succeeded': {
        const charge = event.data.object as Stripe.Charge;
        // Additional confirmation, but payment_intent.succeeded is primary
        break;
      }

      case 'charge.failed': {
        const charge = event.data.object as Stripe.Charge;
        // Additional confirmation, but payment_intent.payment_failed is primary
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error('Error processing webhook:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed', details: error.message },
      { status: 500 }
    );
  }
}

async function handlePaymentSuccess(paymentIntent: Stripe.PaymentIntent) {
  const paymentIntentId = paymentIntent.id;
  const userId = paymentIntent.metadata?.userId;

  if (!userId) {
    console.error('No userId in payment intent metadata');
    return;
  }

  // Find the label purchase record
  const labelPurchasesRef = adminDb().collection(`users/${userId}/labelPurchases`);
  const snapshot = await labelPurchasesRef
    .where('stripePaymentIntentId', '==', paymentIntentId)
    .get();

  if (snapshot.empty) {
    console.error(`No label purchase found for payment intent: ${paymentIntentId}`);
    return;
  }

  for (const labelPurchaseDoc of snapshot.docs) {
    const labelPurchaseRef = labelPurchaseDoc.ref;
    const labelPurchaseData = labelPurchaseDoc.data();

    // Idempotency guard: Stripe can resend webhooks; skip already purchased labels.
    if (labelPurchaseData.status === "label_purchased") {
      continue;
    }

    // Update label purchase with payment success
    await labelPurchaseRef.update({
      paymentStatus: 'succeeded',
      status: 'payment_succeeded',
      stripeChargeId: paymentIntent.latest_charge as string,
      paymentCompletedAt: new Date(),
    });

    const selectedRate = labelPurchaseData.selectedRate;
    const labelProvider =
      selectedRate?.labelProvider ||
      labelPurchaseData.labelProvider ||
      (String(selectedRate?.objectId || "").startsWith("shipbest:")
        ? "shipbest"
        : "shippo");

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
        await labelPurchaseRef.update({
          status: "label_failed",
          errorMessage: "ShipBest logistics product code not found",
        });
        continue;
      }

      const fromAddress = labelPurchaseData.fromAddress;
      const toAddress = labelPurchaseData.toAddress;
      const parcel = labelPurchaseData.parcel;
      if (!fromAddress || !toAddress || !parcel) {
        await labelPurchaseRef.update({
          status: "label_failed",
          errorMessage: "Shipment address/parcel missing for ShipBest purchase",
        });
        continue;
      }

      try {
        await purchaseLabelFromShipBest({
          labelPurchaseId: labelPurchaseDoc.id,
          userId,
          customNo: buildShipBestCustomNo(userId, labelPurchaseDoc.id),
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
      } catch (error: any) {
        console.error("Error purchasing ShipBest label:", error);
        await labelPurchaseRef.update({
          status: "label_failed",
          errorMessage: error.message || "Error purchasing ShipBest label",
        });
      }
      continue;
    }

    // Purchase label from Shippo
    if (selectedRate?.objectId) {
      try {
        // For single checkout use metadata shipmentId; for bulk each item stores its own shipmentId.
        const shipmentId = selectedRate.shipmentId || paymentIntent.metadata?.shipmentId;

        if (!shipmentId) {
          console.error('No shipment ID found for label purchase');
          await labelPurchaseRef.update({
            status: 'label_failed',
            errorMessage: 'Shipment ID not found',
          });
          continue;
        }

        // Purchase label from Shippo directly
        await purchaseLabelFromShippo({
          rateId: selectedRate.objectId,
          shipmentId: shipmentId,
          labelPurchaseId: labelPurchaseDoc.id,
          userId: userId,
        });
      } catch (error: any) {
        console.error('Error purchasing label:', error);
        await labelPurchaseRef.update({
          status: 'label_failed',
          errorMessage: error.message || 'Error purchasing label',
        });
      }
    } else {
      console.error('No rate ID found in label purchase data');
      await labelPurchaseRef.update({
        status: 'label_failed',
        errorMessage: 'Rate ID not found',
      });
    }
  }
}

async function handlePaymentFailure(paymentIntent: Stripe.PaymentIntent) {
  const paymentIntentId = paymentIntent.id;
  const userId = paymentIntent.metadata?.userId;

  if (!userId) {
    console.error('No userId in payment intent metadata');
    return;
  }

  // Find the label purchase record
  const labelPurchasesRef = adminDb().collection(`users/${userId}/labelPurchases`);
  const snapshot = await labelPurchasesRef
    .where('stripePaymentIntentId', '==', paymentIntentId)
    .get();

  if (snapshot.empty) {
    console.error(`No label purchase found for payment intent: ${paymentIntentId}`);
    return;
  }

  for (const labelPurchaseDoc of snapshot.docs) {
    const labelPurchaseRef = labelPurchaseDoc.ref;
    await labelPurchaseRef.update({
      paymentStatus: 'failed',
      status: 'payment_pending', // Keep as pending so user can retry
      errorMessage: paymentIntent.last_payment_error?.message || 'Payment failed',
    });
    console.log(`Payment failed for label purchase: ${labelPurchaseDoc.id}`);
  }
}

async function handlePaymentCanceled(paymentIntent: Stripe.PaymentIntent) {
  const paymentIntentId = paymentIntent.id;
  const userId = paymentIntent.metadata?.userId;

  if (!userId) {
    console.error('No userId in payment intent metadata');
    return;
  }

  // Find the label purchase record
  const labelPurchasesRef = adminDb().collection(`users/${userId}/labelPurchases`);
  const snapshot = await labelPurchasesRef
    .where('stripePaymentIntentId', '==', paymentIntentId)
    .get();

  if (snapshot.empty) {
    console.error(`No label purchase found for payment intent: ${paymentIntentId}`);
    return;
  }

  for (const labelPurchaseDoc of snapshot.docs) {
    const labelPurchaseRef = labelPurchaseDoc.ref;
    await labelPurchaseRef.update({
      paymentStatus: 'canceled',
      status: 'payment_pending', // Keep as pending so user can retry
      errorMessage: 'Payment was canceled',
    });
    console.log(`Payment canceled for label purchase: ${labelPurchaseDoc.id}`);
  }
}


