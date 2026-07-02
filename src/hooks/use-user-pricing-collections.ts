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
  getUserPricingProfilePaths,
  resolveUserPricingProfileId,
  getPricingProfileLabel,
} from "@/lib/pricing-profiles";

/**
 * Load all pricing tables for a user's assigned profile.
 * Pallet storage cycles remain per-user (operational), not profile-scoped.
 */
export function useUserPricingCollections(
  user: Pick<UserProfile, "pricingProfileId" | "uid"> | null | undefined
) {
  const profileId = resolveUserPricingProfileId(user);
  const paths = useMemo(() => getUserPricingProfilePaths(user), [user, profileId]);
  const enabled = Boolean(user?.uid);

  const { data: pricingRules, loading: prepLoading } = useCollection<UserPricing>(
    enabled ? paths.prep : ""
  );
  const { data: storagePricingList, loading: storageLoading } = useCollection<UserStoragePricing>(
    enabled ? paths.storage : ""
  );
  const { data: boxForwardingPricing, loading: boxLoading } = useCollection<UserBoxForwardingPricing>(
    enabled ? paths.boxForwarding : ""
  );
  const { data: palletForwardingPricing, loading: palletLoading } =
    useCollection<UserPalletForwardingPricing>(enabled ? paths.palletForwarding : "");
  const { data: containerHandlingPricing, loading: containerLoading } =
    useCollection<UserContainerHandlingPricing>(enabled ? paths.containerHandling : "");
  const { data: additionalServicesPricing, loading: additionalLoading } =
    useCollection<UserAdditionalServicesPricing>(enabled ? paths.additionalServices : "");

  const loading =
    prepLoading ||
    storageLoading ||
    boxLoading ||
    palletLoading ||
    containerLoading ||
    additionalLoading;

  return {
    profileId,
    profileLabel: getPricingProfileLabel(profileId),
    paths,
    pricingRules: pricingRules ?? [],
    storagePricingList: storagePricingList ?? [],
    boxForwardingPricing: boxForwardingPricing ?? [],
    palletForwardingPricing: palletForwardingPricing ?? [],
    containerHandlingPricing: containerHandlingPricing ?? [],
    additionalServicesPricing: additionalServicesPricing ?? [],
    loading,
  };
}
