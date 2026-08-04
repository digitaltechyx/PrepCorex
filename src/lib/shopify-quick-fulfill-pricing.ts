import type { Firestore } from "firebase-admin/firestore";
import type { UserPricing } from "@/types";
import { DTC_FBM_SERVICE } from "@/types";
import { calculatePrepUnitPrice } from "@/lib/pricing-utils";
import {
  DEFAULT_PRICING_PROFILE_ID,
  getPricingProfileCollectionPath,
} from "@/lib/pricing-profiles";

/**
 * Load prep pricing rules for a client (assigned profile, then Standard, then legacy).
 */
export async function loadUserPrepPricingRules(
  db: Firestore,
  userId: string
): Promise<UserPricing[]> {
  const userSnap = await db.collection("users").doc(userId).get();
  const profileId =
    (typeof userSnap.data()?.pricingProfileId === "string" &&
      userSnap.data()?.pricingProfileId.trim()) ||
    DEFAULT_PRICING_PROFILE_ID;

  const fromPath = async (path: string) => {
    const snap = await db.collection(path).get();
    return snap.docs.map(
      (docSnap) => ({ id: docSnap.id, ...docSnap.data() }) as UserPricing
    );
  };

  let rules = await fromPath(getPricingProfileCollectionPath(profileId, "prep"));
  if (rules.length === 0 && profileId !== DEFAULT_PRICING_PROFILE_ID) {
    rules = await fromPath(
      getPricingProfileCollectionPath(DEFAULT_PRICING_PROFILE_ID, "prep")
    );
  }
  if (rules.length === 0) {
    rules = await fromPath("defaultPricing");
  }
  return rules;
}

/** DTC unit rate for Shopify quick-fulfill shipped qty. */
export async function resolveShopifyQuickFulfillDtcUnitPrice(
  db: Firestore,
  userId: string,
  totalUnits: number
): Promise<number> {
  const rules = await loadUserPrepPricingRules(db, userId);
  const calculated = calculatePrepUnitPrice(
    rules,
    DTC_FBM_SERVICE,
    "Standard",
    Math.max(1, totalUnits)
  );
  return calculated?.rate != null && Number.isFinite(calculated.rate)
    ? Number(calculated.rate)
    : 0;
}
