"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import type { UserProfile } from "@/types";
import type {
  UserPricing,
  UserStoragePricing,
  UserBoxForwardingPricing,
  UserPalletForwardingPricing,
  UserContainerHandlingPricing,
  UserAdditionalServicesPricing,
  UserProductPrepRate,
} from "@/types";
import { servicesMatch } from "@/types";
import {
  DEFAULT_PRICING_PROFILE_ID,
  getUserPricingProfilePaths,
  resolveUserPricingProfileId,
  getPricingProfileLabel,
} from "@/lib/pricing-profiles";

type ProfileApiResponse = {
  profileId?: string;
  profileLabel?: string;
  prep?: UserPricing[];
  storage?: UserStoragePricing[];
  boxForwarding?: UserBoxForwardingPricing[];
  palletForwarding?: UserPalletForwardingPricing[];
  containerHandling?: UserContainerHandlingPricing[];
  additionalServices?: UserAdditionalServicesPricing[];
  productPrepRates?: UserProductPrepRate[];
  prepSource?: string;
  error?: string;
};

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

/**
 * Load pricing tables for a user's assigned profile via server API (Admin SDK).
 * This avoids client Firestore rule/cache issues that made Custom profiles
 * appear as Standard rates on the client Pricing page.
 */
export function useUserPricingCollections(
  user: Pick<UserProfile, "pricingProfileId" | "uid"> | null | undefined
) {
  const { user: authUser } = useAuth();
  const profileId = resolveUserPricingProfileId(user);
  const paths = useMemo(() => getUserPricingProfilePaths(user), [user, profileId]);

  const [pricingRules, setPricingRules] = useState<UserPricing[]>([]);
  const [storagePricingList, setStoragePricingList] = useState<UserStoragePricing[]>([]);
  const [boxForwardingPricing, setBoxForwardingPricing] = useState<
    UserBoxForwardingPricing[]
  >([]);
  const [palletForwardingPricing, setPalletForwardingPricing] = useState<
    UserPalletForwardingPricing[]
  >([]);
  const [containerHandlingPricing, setContainerHandlingPricing] = useState<
    UserContainerHandlingPricing[]
  >([]);
  const [additionalServicesPricing, setAdditionalServicesPricing] = useState<
    UserAdditionalServicesPricing[]
  >([]);
  const [productPrepRates, setProductPrepRates] = useState<UserProductPrepRate[]>([]);
  const [resolvedProfileId, setResolvedProfileId] = useState(profileId);
  const [loading, setLoading] = useState(Boolean(user?.uid));
  const [prepSource, setPrepSource] = useState<string | null>(null);

  useEffect(() => {
    setResolvedProfileId(profileId);
  }, [profileId]);

  useEffect(() => {
    const targetUid = user?.uid?.trim();
    if (!targetUid || !authUser) {
      setPricingRules([]);
      setStoragePricingList([]);
      setBoxForwardingPricing([]);
      setPalletForwardingPricing([]);
      setContainerHandlingPricing([]);
      setAdditionalServicesPricing([]);
      setProductPrepRates([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const token = await authUser.getIdToken();
        const res = await fetch(
          `/api/pricing/profile?userId=${encodeURIComponent(targetUid)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
          }
        );
        const data = (await res.json().catch(() => ({}))) as ProfileApiResponse;
        if (cancelled) return;
        if (!res.ok) {
          console.warn("[useUserPricingCollections] API error:", data.error || res.status);
          setPricingRules([]);
          setStoragePricingList([]);
          setBoxForwardingPricing([]);
          setPalletForwardingPricing([]);
          setContainerHandlingPricing([]);
          setAdditionalServicesPricing([]);
          setProductPrepRates([]);
          return;
        }

        setResolvedProfileId(data.profileId || profileId);
        setPrepSource(data.prepSource || null);
        setPricingRules(Array.isArray(data.prep) ? (data.prep as UserPricing[]) : []);
        setStoragePricingList(
          Array.isArray(data.storage) ? (data.storage as UserStoragePricing[]) : []
        );
        setBoxForwardingPricing(
          Array.isArray(data.boxForwarding)
            ? (data.boxForwarding as UserBoxForwardingPricing[])
            : []
        );
        setPalletForwardingPricing(
          Array.isArray(data.palletForwarding)
            ? (data.palletForwarding as UserPalletForwardingPricing[])
            : []
        );
        setContainerHandlingPricing(
          Array.isArray(data.containerHandling)
            ? (data.containerHandling as UserContainerHandlingPricing[])
            : []
        );
        setAdditionalServicesPricing(
          Array.isArray(data.additionalServices)
            ? (data.additionalServices as UserAdditionalServicesPricing[])
            : []
        );
        setProductPrepRates(
          Array.isArray(data.productPrepRates)
            ? (data.productPrepRates as UserProductPrepRate[])
            : []
        );
      } catch (err) {
        if (!cancelled) {
          console.warn("[useUserPricingCollections] fetch failed:", err);
          setPricingRules([]);
          setStoragePricingList([]);
          setBoxForwardingPricing([]);
          setPalletForwardingPricing([]);
          setContainerHandlingPricing([]);
          setAdditionalServicesPricing([]);
          setProductPrepRates([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, user?.pricingProfileId, authUser, profileId]);

  return {
    profileId: resolvedProfileId,
    profileLabel: getPricingProfileLabel(resolvedProfileId),
    paths,
    pricingRules,
    storagePricingList,
    boxForwardingPricing,
    palletForwardingPricing,
    containerHandlingPricing,
    additionalServicesPricing,
    productPrepRates,
    loading,
    prepSource,
    usingStandardFallback:
      Boolean(prepSource) &&
      prepSource !== resolvedProfileId &&
      (prepSource === "standard_fallback" ||
        prepSource === DEFAULT_PRICING_PROFILE_ID),
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
