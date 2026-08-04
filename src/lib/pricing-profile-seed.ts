import {
  collection,
  doc,
  getDocs,
  setDoc,
  Timestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  DEFAULT_PRICING_PROFILE_ID,
  LEGACY_DEFAULT_COLLECTIONS,
  getPricingProfileCollectionPath,
  isCustomProfileId,
  type PricingDataCategory,
} from "@/lib/pricing-profiles";

const SEED_CATEGORIES: PricingDataCategory[] = [
  "prep",
  "storage",
  "boxForwarding",
  "palletForwarding",
  "containerHandling",
  "additionalServices",
  "fbaPackAddOn",
];

/**
 * Copy rate tables from a source profile into a target profile for any category
 * that is still empty. Used when assigning Custom / non-standard profiles so
 * users never land on blank pricing ($0 / hardcoded defaults).
 */
export async function seedPricingProfileFromSource(
  targetProfileId: string,
  sourceProfileId: string = DEFAULT_PRICING_PROFILE_ID
): Promise<{ seededCategories: string[] }> {
  const targetId = targetProfileId?.trim();
  const sourceId = sourceProfileId?.trim() || DEFAULT_PRICING_PROFILE_ID;
  if (!targetId || targetId === sourceId) {
    return { seededCategories: [] };
  }

  const seededCategories: string[] = [];

  for (const category of SEED_CATEGORIES) {
    const targetPath = getPricingProfileCollectionPath(targetId, category);
    const targetSnap = await getDocs(collection(db, targetPath));
    if (!targetSnap.empty) continue;

    const sourcePath = getPricingProfileCollectionPath(sourceId, category);
    let sourceSnap = await getDocs(collection(db, sourcePath));

    // If Standard itself was never migrated, fall back to legacy default collections.
    if (sourceSnap.empty && sourceId === DEFAULT_PRICING_PROFILE_ID) {
      const legacyPath = LEGACY_DEFAULT_COLLECTIONS[category];
      sourceSnap = await getDocs(collection(db, legacyPath));
    }

    if (sourceSnap.empty) continue;

    const batch = writeBatch(db);
    const now = Timestamp.now();
    sourceSnap.docs.forEach((sourceDoc) => {
      const data = { ...sourceDoc.data() } as Record<string, unknown>;
      delete data.userId;
      delete data.migratedFrom;
      delete data.migratedAt;
      delete data.seededFrom;
      delete data.seededAt;
      const ref = doc(collection(db, targetPath));
      batch.set(ref, {
        ...data,
        profileId: targetId,
        seededFrom: sourceId,
        seededAt: now,
      });
    });
    await batch.commit();
    seededCategories.push(category);
  }

  await setDoc(
    doc(db, "pricingProfiles", targetId),
    {
      id: targetId,
      kind: isCustomProfileId(targetId) ? "custom" : "global",
      updatedAt: Timestamp.now(),
      ...(seededCategories.length > 0
        ? { seededFrom: sourceId, seededAt: Timestamp.now() }
        : {}),
    },
    { merge: true }
  );

  return { seededCategories };
}

/** Seed only when the profile is not Standard (Custom / wholesale / etc.). */
export async function ensureAssignedPricingProfileSeeded(
  profileId: string
): Promise<{ seededCategories: string[] }> {
  const id = profileId?.trim() || DEFAULT_PRICING_PROFILE_ID;
  if (id === DEFAULT_PRICING_PROFILE_ID) {
    return { seededCategories: [] };
  }
  return seedPricingProfileFromSource(id, DEFAULT_PRICING_PROFILE_ID);
}
