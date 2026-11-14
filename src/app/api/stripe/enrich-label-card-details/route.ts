import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { adminDb } from "@/lib/firebase-admin";
import {
  isAdminLikeToken,
  isAdminLikeUserDoc,
  verifyBearerToken,
} from "@/lib/api-admin-auth";
import { cardSummaryFromPaymentIntent } from "@/lib/stripe-customer";
import { isWalletLabelPayment } from "@/lib/label-refund";

type CardPatch = {
  cardBrand: string;
  cardLast4: string;
  stripePaymentMethodId?: string;
};

/**
 * Backfill card brand + last4 on Buy Labels purchases from Stripe PaymentIntents.
 * Used by the card statement PDF so older charges show Visa ···· 4242 instead of pending.
 */
export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyBearerToken(request);
    if (!decoded?.uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      userId?: string;
      purchaseIds?: string[];
    };

    const uid = String(body.userId || decoded.uid).trim();
    if (uid !== decoded.uid) {
      const tokenAdmin = isAdminLikeToken(decoded as unknown as Record<string, unknown>);
      let docAdmin = false;
      if (!tokenAdmin) {
        const callerSnap = await adminDb().collection("users").doc(decoded.uid).get();
        docAdmin = isAdminLikeUserDoc(callerSnap.data());
      }
      if (!tokenAdmin && !docAdmin) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const requestedIds = Array.isArray(body.purchaseIds)
      ? body.purchaseIds.map((id) => String(id || "").trim()).filter(Boolean)
      : [];

    const col = adminDb().collection(`users/${uid}/labelPurchases`);
    let docs;
    if (requestedIds.length > 0) {
      const snaps = await Promise.all(
        requestedIds.slice(0, 80).map((id) => col.doc(id).get())
      );
      docs = snaps.filter((s) => s.exists);
    } else {
      const snap = await col.limit(120).get();
      docs = snap.docs;
    }

    const stripe = getStripe();
    const cards: Record<string, CardPatch> = {};
    let updated = 0;

    for (const docSnap of docs) {
      const data = docSnap.data() || {};
      if (isWalletLabelPayment(data as { paymentMethod?: string; stripePaymentIntentId?: string })) {
        continue;
      }
      const existingLast4 = String(data.cardLast4 || "").trim();
      const existingBrand = String(data.cardBrand || "").trim();
      if (existingLast4 && existingBrand) {
        cards[docSnap.id] = {
          cardBrand: existingBrand,
          cardLast4: existingLast4,
          ...(data.stripePaymentMethodId
            ? { stripePaymentMethodId: String(data.stripePaymentMethodId) }
            : {}),
        };
        continue;
      }

      const piId = String(data.stripePaymentIntentId || "").trim();
      if (!piId.startsWith("pi_")) continue;

      try {
        const pi = await stripe.paymentIntents.retrieve(piId, {
          expand: ["payment_method", "latest_charge"],
        });
        const summary = await cardSummaryFromPaymentIntent(pi);
        if (!summary.cardLast4 && !summary.cardBrand) continue;

        const patch: CardPatch = {
          cardBrand: summary.cardBrand || "card",
          cardLast4: summary.cardLast4 || "????",
          ...(summary.stripePaymentMethodId
            ? { stripePaymentMethodId: summary.stripePaymentMethodId }
            : {}),
        };
        await docSnap.ref.update(patch);
        cards[docSnap.id] = patch;
        updated += 1;
      } catch (err) {
        console.warn("[enrich-label-card-details] PI lookup failed", piId, err);
      }
    }

    return NextResponse.json({ ok: true, updated, cards });
  } catch (error: unknown) {
    console.error("[POST /api/stripe/enrich-label-card-details]", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to enrich card details",
      },
      { status: 500 }
    );
  }
}
