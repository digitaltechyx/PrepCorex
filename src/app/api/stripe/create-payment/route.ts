import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { adminDb, adminFieldValue } from '@/lib/firebase-admin';
import type { LabelPurchase } from '@/types';

export async function POST(request: NextRequest) {
  try {
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
    } = body;

    // Validate required fields
    if (!userId || !amount || !fromAddress || !toAddress || !parcel || !selectedRate) {
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

    // Get Stripe instance (lazy initialization)
    const stripe = getStripe();

    // Create payment intent in Stripe
    let paymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount), // Ensure it's an integer (cents)
        currency: currency.toLowerCase(),
        metadata: {
          userId,
          fromAddress: JSON.stringify(fromAddress),
          toAddress: JSON.stringify(toAddress),
          parcel: JSON.stringify(parcel),
          selectedRate: JSON.stringify(selectedRate),
          shipmentId: selectedRate.shipmentId || '',
          shippedItemId: shippedItemId || '',
        },
        automatic_payment_methods: {
          enabled: true,
        },
      });
    } catch (stripeError: any) {
      console.error('Stripe payment intent creation failed:', stripeError);
      throw new Error(`Stripe error: ${stripeError.message || 'Failed to create payment intent'}`);
    }

    // Create label purchase record in Firestore
    let docRef;
    try {
      const labelPurchaseData: Omit<LabelPurchase, 'id' | 'createdAt'> = {
        userId,
        purchasedBy: userId,
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
        .collection(`users/${userId}/labelPurchases`)
        .add({
          ...labelPurchaseData,
          createdAt: adminFieldValue().serverTimestamp(),
        });
    } catch (firestoreError: any) {
      console.error('Firestore write failed:', firestoreError);
      // Payment intent was created but we couldn't save the record
      // This is a critical error - the payment exists but we don't have a record
      throw new Error(`Database error: ${firestoreError.message || 'Failed to save payment record'}`);
    }

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      labelPurchaseId: docRef.id,
    });
  } catch (error: any) {
    console.error('Error creating payment intent:', error);
    
    // Provide more detailed error information
    let errorMessage = 'Failed to create payment intent';
    let errorDetails = error.message || 'Unknown error';
    
    // Check for specific error types
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


