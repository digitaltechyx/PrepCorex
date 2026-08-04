"use client";

import { useMemo } from "react";
import { useCollection } from "@/hooks/use-collection";
import type { UserProfile } from "@/types";
import type {
  UserPricing,
  UserStoragePricing,
  UserBoxForwardingPricing,
  UserPalletForwardingPricing,
  UserContainerHandlingPricing,
  UserAdditionalServicesPricing,
} from "@/types";
import { servicesMatch } from "@/types";
import {
  DEFAULT_PRICING_PROFILE_ID,
  getPricingProfilePaths,
  getUserPricingProfilePaths,
  resolveUserPricingProfileId,
  getPricingProfileLabel,
  isCustomProfileId,
} from "@/lib/pricing-profiles";

function toMs(v: unknown): number {
  if (!v) return 0;
  if (typeof v === "string") {
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  if (typeof (v as { toDate?: () => Date })?.toDate === "function") {
    return (v as { toDate: () => Date }).toDate().getTime();
  }
  if (typeof (v as { seconds?: number })?.seconds === "number") {
    return ((v as { seconds: number }).seconds || 0) * 1000;
  }
  if (v instanceof Date) return v.getTime();
  return 0;
}

function prepRuleKey(rule: Pick<UserPricing, "service" | "package" | "quantityRange" | "productType">) {
  return [
    String(rule.service || "").trim(),
    String(rule.package || "").trim(),
    String(rule.quantityRange || "").trim(),
    String(rule.productType || "").trim(),
  ].join("|");
}

/**
 * Prefer assigned-profile docs; fill missing keys from Standard.
 * When duplicates exist, keep the newest by updatedAt.
 */
function mergeAssignedWithStandard<T extends { updatedAt?: unknown; createdAt?: unknown; id?: string }>(
  assigned: T[] | undefined,
  assignedLoading: boolean,
  standard: T[] | undefined,
  useFallback: boolean,
  keyOf: (item: T) => string
): T[] {
  if (assignedLoading) return assigned ?? [];
  const assignedList = assigned ?? [];
  if (!useFallback) return assignedList;
  if (assignedList.length === 0) return standard ?? [];

  const pickNewer = (a: T, b: T) =>
    toMs(b.updatedAt || b.createdAt) - toMs(a.updatedAt || a.createdAt) >= 0 ? b : a;

  const map = new Map<string, T>();
  for (const item of standard ?? []) {
    const key = keyOf(item);
    if (!key || key === "|||") continue;
    const prev = map.get(key);
    map.set(key, prev ? pickNewer(prev, item) : item);
  }
  for (const item of assignedList) {
    const key = keyOf(item);
    if (!key || key === "|||") {
      // Keep unkeyed assigned docs so callers can still inspect them.
      map.set(`__assigned_${item.id || map.size}`, item);
      continue;
    }
    const prev = map.get(key);
    map.set(key, prev ? pickNewer(prev, item) : item);
  }
  return Array.from(map.values());
}

function pickNewerList<T extends { updatedAt?: unknown; createdAt?: unknown }>(
  assigned: T[] | undefined,
  assignedLoading: boolean,
  standard: T[] | undefined,
  useFallback: boolean
): T[] {
  if (assignedLoading) return assigned ?? [];
  const assignedList = assigned ?? [];
  if (assignedList.length > 0) return assignedList;
  if (useFallback) return standard ?? [];
  return assignedList;
}

/**
 * Load all pricing tables for a user's assigned profile.
 * Pallet storage cycles remain per-user (operational), not profile-scoped.
 *
 * Prep rules: merge Standard into gaps so missing tiers don't blank out,
 * but assigned-profile rates always win for the same key.
 * Other categories: use assigned when present, else Standard.
 */
export function useUserPricingCollections(
  user: Pick<UserProfile, "pricingProfileId" | "uid"> | null | undefined
) {
  const profileId = resolveUserPricingProfileId(user);
  const paths = useMemo(() => getUserPricingProfilePaths(user), [user, profileId]);
  const standardPaths = useMemo(
    () => getPricingProfilePaths(DEFAULT_PRICING_PROFILE_ID),
    []
  );
  const enabled = Boolean(user?.uid);
  const useStandardFallback = profileId !== DEFAULT_PRICING_PROFILE_ID;
  const standardPath = (categoryPath: string) =>
    enabled && useStandardFallback ? categoryPath : "";

  const { data: pricingRules, loading: prepLoading } = useCollection<UserPricing>(
    enabled ? paths.prep : ""
  );
  const { data: storagePricingList, loading: storageLoading } =
    useCollection<UserStoragePricing>(enabled ? paths.storage : "");
  const { data: boxForwardingPricing, loading: boxLoading } =
    useCollection<UserBoxForwardingPricing>(enabled ? paths.boxForwarding : "");
  const { data: palletForwardingPricing, loading: palletLoading } =
    useCollection<UserPalletForwardingPricing>(enabled ? paths.palletForwarding : "");
  const { data: containerHandlingPricing, loading: containerLoading } =
    useCollection<UserContainerHandlingPricing>(
      enabled ? paths.containerHandling : ""
    );
  const { data: additionalServicesPricing, loading: additionalLoading } =
    useCollection<UserAdditionalServicesPricing>(
      enabled ? paths.additionalServices : ""
    );

  const { data: standardPricingRules, loading: stdPrepLoading } =
    useCollection<UserPricing>(standardPath(standardPaths.prep));
  const { data: standardStoragePricingList, loading: stdStorageLoading } =
    useCollection<UserStoragePricing>(standardPath(standardPaths.storage));
  const { data: standardBoxForwardingPricing, loading: stdBoxLoading } =
    useCollection<UserBoxForwardingPricing>(
      standardPath(standardPaths.boxForwarding)
    );
  const { data: standardPalletForwardingPricing, loading: stdPalletLoading } =
    useCollection<UserPalletForwardingPricing>(
      standardPath(standardPaths.palletForwarding)
    );
  const { data: standardContainerHandlingPricing, loading: stdContainerLoading } =
    useCollection<UserContainerHandlingPricing>(
      standardPath(standardPaths.containerHandling)
    );
  const { data: standardAdditionalServicesPricing, loading: stdAdditionalLoading } =
    useCollection<UserAdditionalServicesPricing>(
      standardPath(standardPaths.additionalServices)
    );

  // Custom profiles: never wholesale-replace with Standard (that made Custom users
  // see Standard rates). Merge prep by key so assigned custom rates always win.
  const allowWholesaleCategoryFallback =
    useStandardFallback && !isCustomProfileId(profileId);

  const resolvedPricingRules = useMemo(
    () =>
      mergeAssignedWithStandard(
        pricingRules,
        prepLoading,
        standardPricingRules,
        useStandardFallback,
        (rule) => prepRuleKey(rule)
      ),
    [pricingRules, prepLoading, standardPricingRules, useStandardFallback]
  );

  const resolvedStoragePricingList = useMemo(
    () =>
      pickNewerList(
        storagePricingList,
        storageLoading,
        standardStoragePricingList,
        allowWholesaleCategoryFallback
      ),
    [
      storagePricingList,
      storageLoading,
      standardStoragePricingList,
      allowWholesaleCategoryFallback,
    ]
  );
  const resolvedBoxForwardingPricing = useMemo(
    () =>
      pickNewerList(
        boxForwardingPricing,
        boxLoading,
        standardBoxForwardingPricing,
        allowWholesaleCategoryFallback
      ),
    [
      boxForwardingPricing,
      boxLoading,
      standardBoxForwardingPricing,
      allowWholesaleCategoryFallback,
    ]
  );
  const resolvedPalletForwardingPricing = useMemo(
    () =>
      pickNewerList(
        palletForwardingPricing,
        palletLoading,
        standardPalletForwardingPricing,
        allowWholesaleCategoryFallback
      ),
    [
      palletForwardingPricing,
      palletLoading,
      standardPalletForwardingPricing,
      allowWholesaleCategoryFallback,
    ]
  );
  const resolvedContainerHandlingPricing = useMemo(
    () =>
      pickNewerList(
        containerHandlingPricing,
        containerLoading,
        standardContainerHandlingPricing,
        allowWholesaleCategoryFallback
      ),
    [
      containerHandlingPricing,
      containerLoading,
      standardContainerHandlingPricing,
      allowWholesaleCategoryFallback,
    ]
  );
  const resolvedAdditionalServicesPricing = useMemo(
    () =>
      pickNewerList(
        additionalServicesPricing,
        additionalLoading,
        standardAdditionalServicesPricing,
        allowWholesaleCategoryFallback
      ),
    [
      additionalServicesPricing,
      additionalLoading,
      standardAdditionalServicesPricing,
      allowWholesaleCategoryFallback,
    ]
  );

  const assignedLoading =
    prepLoading ||
    storageLoading ||
    boxLoading ||
    palletLoading ||
    containerLoading ||
    additionalLoading;

  const fallbackLoading =
    useStandardFallback &&
    (stdPrepLoading ||
      stdStorageLoading ||
      stdBoxLoading ||
      stdPalletLoading ||
      stdContainerLoading ||
      stdAdditionalLoading);

  const loading = assignedLoading || Boolean(fallbackLoading);

  // Expose raw assigned prep for debugging/UI that must ignore Standard merge.
  const assignedPrepCount = (pricingRules ?? []).length;

  return {
    profileId,
    profileLabel: getPricingProfileLabel(profileId),
    paths,
    pricingRules: resolvedPricingRules,
    storagePricingList: resolvedStoragePricingList,
    boxForwardingPricing: resolvedBoxForwardingPricing,
    palletForwardingPricing: resolvedPalletForwardingPricing,
    containerHandlingPricing: resolvedContainerHandlingPricing,
    additionalServicesPricing: resolvedAdditionalServicesPricing,
    loading,
    assignedPrepCount,
    usingStandardFallback:
      useStandardFallback &&
      !assignedLoading &&
      assignedPrepCount === 0,
  };
}

/** Find newest prep rate for a service / volume tier / product type. */
export function findLatestPrepRate(
  pricingList: Array<{
    service?: string;
    package?: string;
    quantityRange?: string;
    productType?: string;
    rate?: number | string;
    updatedAt?: unknown;
    createdAt?: unknown;
  }>,
  service: string,
  quantityRange: string,
  productType: string,
  preferredPackage?: string
): number | undefined {
  const range = String(quantityRange || "").trim();
  let matches = (pricingList || []).filter(
    (d) =>
      servicesMatch(d.service, service) &&
      String(d.quantityRange || "").trim() === range &&
      d.productType === productType
  );
  if (preferredPackage) {
    const withPkg = matches.filter((d) => d.package === preferredPackage);
    if (withPkg.length > 0) matches = withPkg;
  }
  if (matches.length === 0) return undefined;

  matches.sort(
    (a, b) => toMs(b.updatedAt || b.createdAt) - toMs(a.updatedAt || a.createdAt)
  );
  const raw = matches[0]?.rate;
  const rate = typeof raw === "number" ? raw : parseFloat(String(raw ?? "").trim());
  return Number.isFinite(rate) ? rate : undefined;
}
