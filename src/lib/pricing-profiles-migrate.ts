import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import {
  DEFAULT_PRICING_PROFILE_ID,
  GLOBAL_PRICING_PROFILES,
  LEGACY_DEFAULT_COLLECTIONS,
  getPricingProfileCollectionPath,
  type PricingDataCategory,
} from "@/lib/pricing-profiles";

const CATEGORIES = Object.keys(LEGACY_DEFAULT_COLLECTIONS) as PricingDataCategory[];

/** Copy legacy `default*` collections into each global profile when target is empty. */
export async function seedGlobalPricingProfilesFromLegacy(): Promise<{
  seededCategories: string[];
}> {
  const db = adminDb();
  const seededCategories: string[] = [];

  for (const category of CATEGORIES) {
    const legacyPath = LEGACY_DEFAULT_COLLECTIONS[category];
    const legacySnap = await db.collection(legacyPath).get();
    if (legacySnap.empty) continue;

    for (const profile of GLOBAL_PRICING_PROFILES) {
      const targetPath = getPricingProfileCollectionPath(profile.id, category);
      const targetSnap = await db.collection(targetPath).limit(1).get();
      if (!targetSnap.empty) continue;

      const batch = db.batch();
      legacySnap.docs.forEach((sourceDoc) => {
        const data = { ...sourceDoc.data() };
        delete data.userId;
        const ref = db.collection(targetPath).doc();
        batch.set(ref, {
          ...data,
          profileId: profile.id,
          migratedFrom: legacyPath,
          migratedAt: FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();
      seededCategories.push(`${profile.id}/${category}`);
    }
  }

  return { seededCategories };
}

/** Set `pricingProfileId: standard` on users missing the field. */
export async function migrateUsersToStandardProfile(): Promise<{ updated: number }> {
  const db = adminDb();
  const usersSnap = await db.collection("users").get();
  let updated = 0;
  let batch = db.batch();
  let ops = 0;

  for (const userDoc of usersSnap.docs) {
    if (userDoc.data().pricingProfileId) continue;
    batch.update(userDoc.ref, { pricingProfileId: DEFAULT_PRICING_PROFILE_ID });
    updated += 1;
    ops += 1;
    if (ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }

  if (ops > 0) await batch.commit();

  for (const profile of GLOBAL_PRICING_PROFILES) {
    await db.collection("pricingProfiles").doc(profile.id).set(
      {
        id: profile.id,
        kind: "global",
        label: profile.label,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  return { updated };
}
