"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  getPricingProfileSettingsPath,
  type PricingProfileSettings,
} from "@/lib/pricing-profile-settings";

export function usePricingProfileSettings(profileId: string | undefined) {
  const [settings, setSettings] = useState<PricingProfileSettings | null>(null);
  const [loading, setLoading] = useState(Boolean(profileId));

  useEffect(() => {
    if (!profileId) {
      setSettings(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const ref = doc(db, getPricingProfileSettingsPath(profileId));
    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        setSettings(snap.exists() ? (snap.data() as PricingProfileSettings) : null);
        setLoading(false);
      },
      () => {
        setSettings(null);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [profileId]);

  return { settings, loading };
}
