import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { adminDb, adminFieldValue } from "@/lib/firebase-admin";

/**
 * Get or create a Stripe Customer for a PrepCorex user and persist stripeCustomerId on users/{uid}.
 */
export async function getOrCreateStripeCustomer(userId: string): Promise<string> {
  const uid = String(userId || "").trim();
  if (!uid) throw new Error("userId is required");

  const userRef = adminDb().collection("users").doc(uid);
  const snap = await userRef.get();
  const data = snap.data() || {};
  const existing = String(data.stripeCustomerId || "").trim();
  if (existing) return existing;

  const stripe = getStripe();
  const email = typeof data.email === "string" && data.email.trim() ? data.email.trim() : undefined;
  const name =
    (typeof data.name === "string" && data.name.trim()) ||
    (typeof data.companyName === "string" && data.companyName.trim()) ||
    undefined;

  const customer = await stripe.customers.create({
    email,
    name: name || undefined,
    metadata: { userId: uid, source: "prepcorex_buy_labels" },
  });

  await userRef.set(
    {
      stripeCustomerId: customer.id,
      stripeCustomerUpdatedAt: adminFieldValue().serverTimestamp(),
    },
    { merge: true }
  );

  return customer.id;
}

export type SavedCardSummary = {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
};

export async function listSavedCards(userId: string): Promise<SavedCardSummary[]> {
  const customerId = await getOrCreateStripeCustomer(userId);
  const stripe = getStripe();
  const list = await stripe.paymentMethods.list({
    customer: customerId,
    type: "card",
    limit: 20,
  });

  return list.data.map((pm) => ({
    id: pm.id,
    brand: String(pm.card?.brand || "card"),
    last4: String(pm.card?.last4 || "????"),
    expMonth: Number(pm.card?.exp_month || 0),
    expYear: Number(pm.card?.exp_year || 0),
  }));
}

export async function detachSavedCard(userId: string, paymentMethodId: string): Promise<void> {
  const pmId = String(paymentMethodId || "").trim();
  if (!pmId) throw new Error("paymentMethodId is required");

  const customerId = await getOrCreateStripeCustomer(userId);
  const stripe = getStripe();
  const pm = await stripe.paymentMethods.retrieve(pmId);
  if (String(pm.customer || "") !== customerId) {
    throw new Error("Card does not belong to this account.");
  }
  await stripe.paymentMethods.detach(pmId);
}

export type ChargedCardSummary = {
  stripePaymentMethodId: string | null;
  cardBrand: string | null;
  cardLast4: string | null;
};

/** Resolve brand / last4 for a saved payment method id. */
export async function cardSummaryFromPaymentMethodId(
  paymentMethodId: string
): Promise<ChargedCardSummary> {
  const pmId = String(paymentMethodId || "").trim();
  if (!pmId) {
    return { stripePaymentMethodId: null, cardBrand: null, cardLast4: null };
  }
  const stripe = getStripe();
  const pm = await stripe.paymentMethods.retrieve(pmId);
  return {
    stripePaymentMethodId: pm.id,
    cardBrand: pm.card?.brand ? String(pm.card.brand) : null,
    cardLast4: pm.card?.last4 ? String(pm.card.last4) : null,
  };
}

/** Resolve brand / last4 from a succeeded PaymentIntent (method or latest charge). */
export async function cardSummaryFromPaymentIntent(
  paymentIntent: Stripe.PaymentIntent
): Promise<ChargedCardSummary> {
  const stripe = getStripe();
  const pmField = paymentIntent.payment_method;
  if (pmField && typeof pmField === "object" && "card" in pmField) {
    const pm = pmField as Stripe.PaymentMethod;
    return {
      stripePaymentMethodId: pm.id || null,
      cardBrand: pm.card?.brand ? String(pm.card.brand) : null,
      cardLast4: pm.card?.last4 ? String(pm.card.last4) : null,
    };
  }
  if (typeof pmField === "string" && pmField.trim()) {
    try {
      return await cardSummaryFromPaymentMethodId(pmField.trim());
    } catch {
      /* fall through to charge */
    }
  }

  const chargeField = paymentIntent.latest_charge;
  const chargeId =
    typeof chargeField === "string"
      ? chargeField
      : chargeField && typeof chargeField === "object"
        ? chargeField.id
        : "";
  if (chargeId) {
    try {
      const charge = await stripe.charges.retrieve(chargeId);
      const card = charge.payment_method_details?.card;
      return {
        stripePaymentMethodId:
          typeof charge.payment_method === "string" ? charge.payment_method : null,
        cardBrand: card?.brand ? String(card.brand) : null,
        cardLast4: card?.last4 ? String(card.last4) : null,
      };
    } catch {
      /* ignore */
    }
  }

  return { stripePaymentMethodId: null, cardBrand: null, cardLast4: null };
}
