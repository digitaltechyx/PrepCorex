import { adminDb } from "@/lib/firebase-admin";
import {
  DEFAULT_PRICING_PROFILE_ID,
  LEGACY_DEFAULT_COLLECTIONS,
  getPricingProfileCollectionPath,
  getPricingProfileLabel,
  resolveUserPricingProfileId,
  type PricingDataCategory,
} from "@/lib/pricing-profiles";
import {
  classifyPrepFamilyFromShipped,
  marketPrepRate,
  type PrepSavingsBenchmarks,
  type PrepSavingsFamily,
} from "@/lib/prep-savings-benchmarks";
import { resolvePrepUnitPrice } from "@/lib/pricing-utils";
import {
  normalizeStoredServiceType,
  type ProductType,
  type ServiceType,
  type UserPricing,
  type UserProductPrepRate,
} from "@/types";

export type UserPrepPricingContext = {
  profileId: string;
  profileLabel: string;
  prepRules: UserPricing[];
  productPrepRates: UserProductPrepRate[];
  boxForwardingPrice: number;
  palletForwardingPrice: number;
};

function pricingTimestampMs(value: unknown): number {
  if (!value) return 0;
  if (typeof value === "object" && value !== null && "seconds" in value) {
    const sec = Number((value as { seconds: number }).seconds);
    return Number.isFinite(sec) ? sec * 1000 : 0;
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = parseFloat(String(value ?? "").trim());
  return Number.isFinite(n) ? n : 0;
}

function serializePricingDoc(id: string, data: Record<string, unknown>) {
  const row = { id, ...data } as Record<string, unknown>;
  if (row.rate !== undefined) row.rate = toNumber(row.rate);
  if (row.price !== undefined) row.price = toNumber(row.price);
  if (row.fbaRate !== undefined) row.fbaRate = toNumber(row.fbaRate);
  if (row.fbmRate !== undefined) row.fbmRate = toNumber(row.fbmRate);
  return row;
}

async function loadCategoryDocs(profileId: string, category: PricingDataCategory) {
  const path = getPricingProfileCollectionPath(profileId, category);
  let snap = await adminDb().collection(path).get();
  if (snap.empty && profileId !== DEFAULT_PRICING_PROFILE_ID) {
    snap = await adminDb()
      .collection(getPricingProfileCollectionPath(DEFAULT_PRICING_PROFILE_ID, category))
      .get();
  }
  if (snap.empty && category in LEGACY_DEFAULT_COLLECTIONS) {
    snap = await adminDb()
      .collection(LEGACY_DEFAULT_COLLECTIONS[category as keyof typeof LEGACY_DEFAULT_COLLECTIONS])
      .get();
  }
  return snap.docs.map((d: { id: string; data: () => Record<string, unknown> }) =>
    serializePricingDoc(d.id, d.data())
  );
}

function latestPositivePrice(
  docs: Record<string, unknown>[],
  field: "price" | "rate" = "price"
): number {
  let best = 0;
  let bestAt = -1;
  for (const row of docs) {
    const value = toNumber(row[field]);
    if (value <= 0) continue;
    const at = Math.max(pricingTimestampMs(row.updatedAt), pricingTimestampMs(row.createdAt));
    if (at >= bestAt) {
      bestAt = at;
      best = value;
    }
  }
  return best;
}

export async function loadUserPrepPricingContext(userId: string): Promise<UserPrepPricingContext> {
  const userSnap = await adminDb().collection("users").doc(userId).get();
  const userData = userSnap.exists ? (userSnap.data() as Record<string, unknown>) : {};
  const profileId = resolveUserPricingProfileId({
    uid: userId,
    pricingProfileId:
      typeof userData.pricingProfileId === "string" ? userData.pricingProfileId : undefined,
  });

  const [prepDocs, productPrepDocs, boxDocs, palletDocs] = await Promise.all([
    loadCategoryDocs(profileId, "prep"),
    loadCategoryDocs(profileId, "productPrepRates"),
    loadCategoryDocs(profileId, "boxForwarding"),
    loadCategoryDocs(profileId, "palletForwarding"),
  ]);

  return {
    profileId,
    profileLabel: getPricingProfileLabel(profileId),
    prepRules: prepDocs as UserPricing[],
    productPrepRates: productPrepDocs as UserProductPrepRate[],
    boxForwardingPrice: latestPositivePrice(boxDocs),
    palletForwardingPrice: latestPositivePrice(palletDocs),
  };
}

function normalizeProductType(value: unknown): ProductType {
  const raw = String(value ?? "").trim();
  if (raw === "Large" || raw === "Custom") return raw;
  return "Standard";
}

function resolveShippedProductId(data: Record<string, unknown>): string | null {
  const direct = String(data.productId ?? "").trim();
  if (direct) return direct;
  const items = Array.isArray(data.items) ? data.items : [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const id = String((raw as Record<string, unknown>).productId ?? "").trim();
    if (id) return id;
  }
  return null;
}

function shippedUnits(data: Record<string, unknown>): number {
  return (
    Math.max(0, Math.floor(Number(data.shippedQty) || 0)) ||
    Math.max(0, Math.floor(Number(data.totalUnits) || 0)) ||
    Math.max(0, Math.floor(Number(data.boxesShipped) || 0)) ||
    0
  );
}

function crossdockBillableUnits(data: Record<string, unknown>): number {
  return (
    Math.max(1, Math.floor(Number(data.boxesShipped) || 0)) ||
    Math.max(1, Math.floor(Number(data.totalBoxes) || 0)) ||
    1
  );
}

/** PrepCorex cost from the user's assigned pricing profile (same units as market estimate). */
export function estimateShippedPrepProfile(
  data: Record<string, unknown>,
  ctx: UserPrepPricingContext,
  benchmarks: PrepSavingsBenchmarks
): { family: PrepSavingsFamily; unitCount: number; estimated: number } | null {
  const family = classifyPrepFamilyFromShipped(data);
  if (family === "returns") return null;

  const service = normalizeStoredServiceType(String(data.service ?? ""));

  if (family === "crossdock") {
    const kind = String(data.crossdockUnitKind ?? "").trim().toLowerCase();
    const forwarding = kind === "pallet" ? ctx.palletForwardingPrice : ctx.boxForwardingPrice;
    const billable = crossdockBillableUnits(data);
    const rate = forwarding > 0 ? forwarding : marketPrepRate(benchmarks, "crossdock");
    return { family, unitCount: billable, estimated: billable * rate };
  }

  const qty = shippedUnits(data);
  if (qty <= 0) return null;

  const resolvedService =
    service ?? (family === "fba" ? ("FBA/WFS/TFS" as ServiceType) : ("DTC/FBM" as ServiceType));

  const rate =
    resolvePrepUnitPrice({
      pricingRules: ctx.prepRules,
      productPrepRates: ctx.productPrepRates,
      productId: resolveShippedProductId(data),
      service: resolvedService,
      productType: normalizeProductType(data.productType),
      totalUnits: qty,
    })?.rate ?? marketPrepRate(benchmarks, family);

  return { family, unitCount: qty, estimated: qty * rate };
}

/** Return handling cost from closed return fee or profile fallback. */
export function estimateReturnPrepProfile(
  data: Record<string, unknown>,
  qty: number,
  ctx: UserPrepPricingContext,
  benchmarks: PrepSavingsBenchmarks
): { unitCount: number; estimated: number } {
  void ctx;
  const units = Math.max(0, Math.floor(qty));
  if (units <= 0) return { unitCount: 0, estimated: 0 };

  const fromDoc =
    toNumber(data.returnFee) ||
    toNumber((data.pricing as Record<string, unknown> | undefined)?.returnFee);

  const rate = fromDoc > 0 ? fromDoc : marketPrepRate(benchmarks, "returns");
  return { unitCount: units, estimated: units * rate };
}
