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
import {
  DEFAULT_PRICING_PROFILE_ID,
  getPricingProfilePaths,
  getUserPricingProfilePaths,
  resolveUserPricingProfileId,
  getPricingProfileLabel,
} from "@/lib/pricing-profiles";

function pickWithStandardFallback<T>(
  assigned: T[] | undefined,
  assignedLoading: boolean,
  standard: T[] | undefined,
  useFallback: boolean
): T[] {
  if (assignedLoading) return assigned ?? [];
  if ((assigned ?? []).length > 0) return assigned ?? [];
  if (useFallback) return standard ?? [];
  return assigned ?? [];
}

/**
 * Load all pricing tables for a user's assigned profile.
 * Pallet storage cycles remain per-user (operational), not profile-scoped.
 *
 * If the assigned profile has an empty category (e.g. Custom assigned but never
 * seeded), fall back to Standard rates so users never see $0 / blank pricing.
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

  const resolvedPricingRules = useMemo(
    () =>
      pickWithStandardFallback(
        pricingRules,
        prepLoading,
        standardPricingRules,
        useStandardFallback
      ),
    [pricingRules, prepLoading, standardPricingRules, useStandardFallback]
  );
  const resolvedStoragePricingList = useMemo(
    () =>
      pickWithStandardFallback(
        storagePricingList,
        storageLoading,
        standardStoragePricingList,
        useStandardFallback
      ),
    [
      storagePricingList,
      storageLoading,
      standardStoragePricingList,
      useStandardFallback,
    ]
  );
  const resolvedBoxForwardingPricing = useMemo(
    () =>
      pickWithStandardFallback(
        boxForwardingPricing,
        boxLoading,
        standardBoxForwardingPricing,
        useStandardFallback
      ),
    [
      boxForwardingPricing,
      boxLoading,
      standardBoxForwardingPricing,
      useStandardFallback,
    ]
  );
  const resolvedPalletForwardingPricing = useMemo(
    () =>
      pickWithStandardFallback(
        palletForwardingPricing,
        palletLoading,
        standardPalletForwardingPricing,
        useStandardFallback
      ),
    [
      palletForwardingPricing,
      palletLoading,
      standardPalletForwardingPricing,
      useStandardFallback,
    ]
  );
  const resolvedContainerHandlingPricing = useMemo(
    () =>
      pickWithStandardFallback(
        containerHandlingPricing,
        containerLoading,
        standardContainerHandlingPricing,
        useStandardFallback
      ),
    [
      containerHandlingPricing,
      containerLoading,
      standardContainerHandlingPricing,
      useStandardFallback,
    ]
  );
  const resolvedAdditionalServicesPricing = useMemo(
    () =>
      pickWithStandardFallback(
        additionalServicesPricing,
        additionalLoading,
        standardAdditionalServicesPricing,
        useStandardFallback
      ),
    [
      additionalServicesPricing,
      additionalLoading,
      standardAdditionalServicesPricing,
      useStandardFallback,
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
    /** True when at least one category is served from Standard because the assigned profile is empty. */
    usingStandardFallback:
      useStandardFallback &&
      !assignedLoading &&
      ((pricingRules ?? []).length === 0 ||
        (boxForwardingPricing ?? []).length === 0 ||
        (palletForwardingPricing ?? []).length === 0 ||
        (storagePricingList ?? []).length === 0 ||
        (containerHandlingPricing ?? []).length === 0 ||
        (additionalServicesPricing ?? []).length === 0),
  };
}
