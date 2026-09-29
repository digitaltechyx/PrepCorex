/**
 * Admin wipe of a client's operational Firestore data.
 * Keeps Auth account + users/{uid} identity (email, password, clientId, company, etc.).
 */

import { getAdminDb, getAdminFieldValue } from "@/lib/firebase-admin";
import {
  normalizeWipeModules,
  type WipeUserModuleId,
} from "@/lib/admin-wipe-user-modules";

export type { WipeUserModuleId };
export {
  WIPE_USER_MODULES,
  ALL_WIPE_MODULE_IDS,
  normalizeWipeModules,
} from "@/lib/admin-wipe-user-modules";

const MODULE_SUBCOLLECTIONS: Record<WipeUserModuleId, string[]> = {
  inventory: [
    "inventory",
    "inventoryTransfers",
    "inventoryChangeLogs",
    "restockHistory",
    "recycledInventory",
    "recycledShipped",
    "recycledRestockHistory",
    "deleteLogs",
    "editLogs",
    "deleteRequests",
    "palletStorageCycles",
    "palletStoragePositions",
  ],
  inbound: [
    "inventoryRequests",
    "inboundBatches",
    "inboundImportJobs",
    "inboundReceiveLogs",
  ],
  outbound: ["shipmentRequests", "shipped", "outboundDispatchLogs"],
  returns: ["productReturns"],
  dispose: ["disposeRequests", "disposeBatches"],
  invoices: ["invoices", "discountTrail"],
  buy_labels: [
    "labelPurchases",
    "labelRefundRequests",
    "labelWalletTopupRequests",
    "labelWalletLedger",
    "labelApiFeePaymentRequests",
  ],
  notifications: ["notifications"],
  audit_documents: ["auditTrail", "documentRequests"],
  integrations: [
    "shopifyConnections",
    "shopifyOrders",
    "ebayConnections",
    "ebayOrders",
    "amazonConnections",
    "amazonOrders",
    "tiktokConnections",
    "woocommerceConnections",
    "woocommerceOrders",
    "shipstationConnections",
    "shipstationOrders",
  ],
  quarantine_moves: [],
  warehouse_camera: [],
  custom_pricing: ["storagePricing", "containerHandlingPricing", "palletExistingInventoryPricing"],
  uploaded_pdfs: [],
};

/** Subcollections that themselves have nested collections. */
const NESTED_CHILD_NAMES = ["lines", "chunks"] as const;

export type WipeUserDataInput = {
  uid: string;
  modules: WipeUserModuleId[];
  /** Clear MSA + setup wizard so client must onboard again. */
  resetOnboarding: boolean;
  performedByUid: string;
  performedByName?: string | null;
};

export type WipeUserDataResult = {
  uid: string;
  modules: WipeUserModuleId[];
  resetOnboarding: boolean;
  deletedDocs: number;
  details: Record<string, number>;
};

async function deleteCollectionDocs(
  colRef: FirebaseFirestore.CollectionReference,
  deleted: { count: number }
): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await colRef.limit(200).get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      for (const nested of NESTED_CHILD_NAMES) {
        await deleteCollectionDocs(doc.ref.collection(nested), deleted);
      }
      await doc.ref.delete();
      deleted.count += 1;
    }

    if (snap.size < 200) break;
  }
}

async function deleteQueryDocs(
  query: FirebaseFirestore.Query,
  deleted: { count: number }
): Promise<void> {
  const db = getAdminDb();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await query.limit(200).get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
      deleted.count += 1;
    }
    await batch.commit();
    if (snap.size < 200) break;
  }
}

async function wipeIntegrationShopMaps(
  uid: string,
  deleted: { count: number }
): Promise<void> {
  const db = getAdminDb();
  const userRef = db.collection("users").doc(uid);

  const shopifySnap = await userRef.collection("shopifyConnections").get();
  for (const doc of shopifySnap.docs) {
    const shop = String(doc.data()?.shop || doc.data()?.shopDomain || doc.id || "")
      .trim()
      .toLowerCase();
    if (!shop) continue;
    const mapId = shop.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const mapRef = db.collection("shopifyShopToUser").doc(mapId);
    const mapSnap = await mapRef.get();
    if (mapSnap.exists) {
      await mapRef.delete();
      deleted.count += 1;
    }
  }

  const tiktokSnap = await userRef.collection("tiktokConnections").get();
  for (const doc of tiktokSnap.docs) {
    const shopId = String(doc.data()?.shopId || doc.data()?.shop_id || doc.id || "").trim();
    if (!shopId) continue;
    const mapRef = db.collection("tiktokShopToUser").doc(shopId);
    const mapSnap = await mapRef.get();
    if (mapSnap.exists) {
      await mapRef.delete();
      deleted.count += 1;
    }
  }
}

async function wipeCustomPricingProfile(
  uid: string,
  deleted: { count: number }
): Promise<void> {
  const db = getAdminDb();
  const profileRef = db.collection("pricingProfiles").doc(`custom_${uid}`);
  const nested = [
    "prep",
    "storage",
    "boxForwarding",
    "palletForwarding",
    "containerHandling",
    "additionalServices",
    "fbaPackAddOn",
    "productPrepRates",
  ];
  for (const name of nested) {
    await deleteCollectionDocs(profileRef.collection(name), deleted);
  }
  const snap = await profileRef.get();
  if (snap.exists) {
    await profileRef.delete();
    deleted.count += 1;
  }
}

async function resetOnboardingFields(uid: string): Promise<void> {
  const db = getAdminDb();
  const FieldValue = getAdminFieldValue();
  await db
    .collection("users")
    .doc(uid)
    .set(
      {
        accountActivatedAt: FieldValue.delete(),
        msaClientDetails: FieldValue.delete(),
        msaEffectiveDate: FieldValue.delete(),
        msaDocumentSnapshot: FieldValue.delete(),
        msaAcceptance: FieldValue.delete(),
        onboardingProfileCompletedAt: FieldValue.delete(),
        businessType: FieldValue.delete(),
        servicesNeeded: FieldValue.delete(),
        salesVolume: FieldValue.delete(),
        features: [],
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
}

/**
 * Wipe selected modules for a client user. Does not delete Auth or the users/{uid} identity doc.
 */
export async function wipeUserOperationalData(
  input: WipeUserDataInput
): Promise<WipeUserDataResult> {
  const uid = String(input.uid || "").trim();
  if (!uid) throw new Error("User id is required.");

  const modules = normalizeWipeModules(input.modules);
  if (modules.length === 0 && !input.resetOnboarding) {
    throw new Error("Select at least one module, or enable setup wizard / MSA reset.");
  }

  const db = getAdminDb();
  const FieldValue = getAdminFieldValue();
  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new Error("User not found.");

  const userData = userSnap.data() || {};
  const role = String(userData.role || "").toLowerCase();
  const roles = Array.isArray(userData.roles)
    ? userData.roles.map((r: unknown) => String(r || "").toLowerCase())
    : [];
  if (
    role === "admin" ||
    roles.includes("admin") ||
    userData.isAdmin === true ||
    userData.admin === true
  ) {
    throw new Error("Cannot wipe data for an admin account.");
  }

  const details: Record<string, number> = {};
  let deletedDocs = 0;

  for (const moduleId of modules) {
    const counter = { count: 0 };

    if (moduleId === "integrations") {
      await wipeIntegrationShopMaps(uid, counter);
    }

    for (const colName of MODULE_SUBCOLLECTIONS[moduleId]) {
      await deleteCollectionDocs(userRef.collection(colName), counter);
    }

    if (moduleId === "inbound") {
      await deleteQueryDocs(
        db.collection("inboundTrackingIndex").where("userId", "==", uid),
        counter
      );
    }

    if (moduleId === "quarantine_moves") {
      await deleteQueryDocs(
        db.collection("quarantineRequests").where("userId", "==", uid),
        counter
      );
      await deleteQueryDocs(
        db.collection("internalMoveRequests").where("userIds", "array-contains", uid),
        counter
      );
    }

    if (moduleId === "warehouse_camera") {
      await deleteQueryDocs(
        db.collection("warehouseCameraSessions").where("clientUserId", "==", uid),
        counter
      );
    }

    if (moduleId === "custom_pricing") {
      await wipeCustomPricingProfile(uid, counter);
    }

    if (moduleId === "uploaded_pdfs") {
      await deleteQueryDocs(
        db.collection("uploadedPDFs").where("uploadedBy", "==", uid),
        counter
      );
    }

    details[moduleId] = counter.count;
    deletedDocs += counter.count;
  }

  if (input.resetOnboarding) {
    await resetOnboardingFields(uid);
    details.onboarding_msa = 1;
  }

  await db.collection("adminWipeLogs").add({
    targetUid: uid,
    targetEmail: userData.email ?? null,
    targetName: userData.name ?? null,
    modules,
    resetOnboarding: input.resetOnboarding === true,
    deletedDocs,
    details,
    performedByUid: input.performedByUid,
    performedByName: input.performedByName ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });

  return {
    uid,
    modules,
    resetOnboarding: input.resetOnboarding === true,
    deletedDocs,
    details,
  };
}
