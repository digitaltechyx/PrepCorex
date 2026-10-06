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
