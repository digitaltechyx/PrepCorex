import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { adminDb, adminFieldValue } from '@/lib/firebase-admin';
import { verifyBearerToken } from '@/lib/api-admin-auth';
import { assertCanSpendLabelBilling } from '@/lib/label-billing-admin';
import { getOrCreateStripeCustomer } from '@/lib/stripe-customer';
import type { LabelPurchase } from '@/types';

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyBearerToken(request);
    if (!decoded?.uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      userId,
      amount, // Amount in cents
      currency = 'usd',
      fromAddress,
      toAddress,
      parcel,
      selectedRate,
      shippedItemId,
      saveCard = false,
      paymentMethodId = null,
    } = body;

    const uid = String(userId || decoded.uid).trim();
    if (uid !== decoded.uid) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Validate required fields
    if (!uid || !amount || !fromAddress || !toAddress || !parcel || !selectedRate) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Validate amount (must be positive)
    if (amount <= 0) {
      return NextResponse.json(
        { error: 'Amount must be greater than 0' },
        { status: 400 }
      );
    }

    try {
      await assertCanSpendLabelBilling(adminDb(), {
        userId: uid,
        amountCents: Math.round(Number(amount)),
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

    const stripe = getStripe();
    const customerId = await getOrCreateStripeCustomer(uid);
    const pmId = typeof paymentMethodId === 'string' && paymentMethodId.trim()
      ? paymentMethodId.trim()
      : null;
    const shouldSaveCard = Boolean(saveCard) && !pmId;

    let paymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount),
        currency: currency.toLowerCase(),
        customer: customerId,
        ...(pmId ? { payment_method: pmId } : {}),
        ...(shouldSaveCard ? { setup_future_usage: 'off_session' as const } : {}),
        metadata: {
          userId: uid,
          fromAddress: JSON.stringify(fromAddress),
          toAddress: JSON.stringify(toAddress),
          parcel: JSON.stringify(parcel),
          selectedRate: JSON.stringify(selectedRate),
          shipmentId: selectedRate.shipmentId || '',
          shippedItemId: shippedItemId || '',
          saveCard: shouldSaveCard ? 'true' : 'false',
        },
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: 'never',
        },
      });
    } catch (stripeError: any) {
      console.error('Stripe payment intent creation failed:', stripeError);
      throw new Error(`Stripe error: ${stripeError.message || 'Failed to create payment intent'}`);
    }

    let docRef;
    try {
      const labelPurchaseData: Omit<LabelPurchase, 'id' | 'createdAt'> = {
        userId: uid,
        purchasedBy: uid,
        fromAddress,
        toAddress,
        parcel,
        selectedRate,
        stripePaymentIntentId: paymentIntent.id,
        paymentStatus: 'pending',
        paymentAmount: amount,
        paymentCurrency: currency,
        status: 'payment_pending',
        labelProvider: selectedRate.labelProvider || 'shippo',
        ...(shippedItemId && { shippedItemId }),
      };

      docRef = await adminDb()
        .collection(`users/${uid}/labelPurchases`)
        .add({
          ...labelPurchaseData,
          createdAt: adminFieldValue().serverTimestamp(),
        });
    } catch (firestoreError: any) {
      console.error('Firestore write failed:', firestoreError);
      throw new Error(`Database error: ${firestoreError.message || 'Failed to save payment record'}`);
    }

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      labelPurchaseId: docRef.id,
    });
  } catch (error: any) {
    console.error('Error creating payment intent:', error);
    
    let errorMessage = 'Failed to create payment intent';
    let errorDetails = error.message || 'Unknown error';
    
    if (error.type === 'StripeInvalidRequestError') {
      errorMessage = 'Invalid payment request';
      errorDetails = error.message || 'Please check your payment details';
    } else if (error.code === 'permission-denied') {
      errorMessage = 'Permission denied';
      errorDetails = 'Unable to save payment record. Please check Firebase permissions.';
    } else if (error.message?.includes('STRIPE_SECRET_KEY')) {
      errorMessage = 'Stripe configuration error';
      errorDetails = 'Stripe API key is not configured correctly';
    } else if (error.message?.includes('Firebase admin') || error.message?.includes('FIREBASE_ADMIN') || error.message?.includes('Firebase Admin')) {
      errorMessage = 'Firebase configuration error';
      errorDetails = error.message || 'Firebase Admin SDK is not configured correctly. Please check your environment variables.';
    }
    
    return NextResponse.json(
      { 
        error: errorMessage,
        details: errorDetails,
        code: error.code || error.type,
      },
      { status: 500 }
    );
  }
}
