/**
 * Merge inventory product B into product A (same client user).
 * Does not rewrite restock/ship history — source is zeroed + linked; target gains qty/lots.
 *
 * Usage (from repo root):
 *   node scripts/merge-inventory-products.mjs
 *
 * Optional env:
 *   TARGET_SKU=FBA-ORG-DRIEDFIGS-5OZ-1PACK
 *   SOURCE_SKU=ORG-Dried-Figs-5oz
 *   DRY_RUN=1
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });
const admin = require("firebase-admin");

const TARGET_SKU = (process.env.TARGET_SKU || "FBA-ORG-DRIEDFIGS-5OZ-1PACK").trim();
const SOURCE_SKU = (process.env.SOURCE_SKU || "ORG-Dried-Figs-5oz").trim();
const DRY_RUN = String(process.env.DRY_RUN || "").trim() === "1";

function expiryIso(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const t = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const d = new Date(t.includes("T") ? t : `${t}T12:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  if (value && typeof value.toDate === "function") {
    try {
      return value.toDate().toISOString().slice(0, 10);
    } catch {
      return null;
    }
  }
  if (value && typeof value.seconds === "number") {
    return new Date(value.seconds * 1000).toISOString().slice(0, 10);
  }
  return null;
}

function normalizeBatches(batches) {
  if (!Array.isArray(batches)) return [];
  return batches
    .map((b) => ({
      expiry: String(b.expiry || "").trim(),
      quantity: Math.max(0, Math.floor(Number(b.quantity) || 0)),
      lot: b.lot ?? null,
      requestId: b.requestId ?? null,
    }))
    .filter((b) => Boolean(b.expiry));
}

function mergeExpiryBatch(existing, incoming) {
  const qty = Math.max(0, Math.floor(incoming.quantity));
  if (!incoming.expiry || qty <= 0) return existing.map((b) => ({ ...b }));
  const next = existing.map((b) => ({ ...b }));
  const lotKey = (incoming.lot ?? "").trim();
  const idx = next.findIndex(
    (b) => b.expiry === incoming.expiry && (b.lot ?? "").trim() === lotKey
  );
  if (idx >= 0) {
    next[idx] = {
      ...next[idx],
      quantity: next[idx].quantity + qty,
      requestId: incoming.requestId ?? next[idx].requestId ?? null,
    };
  } else {
    next.push({
      expiry: incoming.expiry,
      quantity: qty,
      lot: incoming.lot ?? null,
      requestId: incoming.requestId ?? null,
    });
  }
  return next.sort((a, b) => a.expiry.localeCompare(b.expiry));
}

function preserveKnown(existing, known) {
  const byExpiry = new Map(existing.map((b) => [b.expiry, { ...b }]));
  for (const raw of known || []) {
    const expiry = expiryIso(raw) || String(raw || "").trim();
    if (!expiry || byExpiry.has(expiry)) continue;
    byExpiry.set(expiry, { expiry, quantity: 0, lot: null, requestId: null });
  }
  return Array.from(byExpiry.values()).sort((a, b) => a.expiry.localeCompare(b.expiry));
}

function earliestExpiry(batches) {
  const dates = batches.filter((b) => b.quantity > 0 && b.expiry).map((b) => b.expiry).sort();
  return dates[0] ?? null;
}

function mergeLocations(target, source) {
  const out = {};
  for (const [k, v] of Object.entries(target || {})) {
    const id = String(k || "").trim();
    const qty = Math.max(0, Math.floor(Number(v) || 0));
    if (id && qty > 0) out[id] = qty;
  }
  for (const [k, v] of Object.entries(source || {})) {
    const id = String(k || "").trim();
    const qty = Math.max(0, Math.floor(Number(v) || 0));
    if (id && qty > 0) out[id] = (out[id] || 0) + qty;
  }
  return out;
}

function userIdFromInventoryPath(docPath) {
  // users/{uid}/inventory/{id}
  const parts = String(docPath || "").split("/");
  const i = parts.indexOf("users");
  if (i < 0 || !parts[i + 1]) return null;
  return parts[i + 1];
}

async function findBySku(db, sku) {
  const exact = await db.collectionGroup("inventory").where("sku", "==", sku).get();
  if (!exact.empty) return exact.docs;
  // Fallback: case-insensitive scan is too heavy; try common variants
  const variants = [sku, sku.toUpperCase(), sku.toLowerCase()];
  for (const v of variants) {
    if (v === sku) continue;
    const snap = await db.collectionGroup("inventory").where("sku", "==", v).get();
    if (!snap.empty) return snap.docs;
  }
  return [];
}

async function main() {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    console.error("Missing Firebase admin env in .env.local");
    process.exit(1);
  }
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    });
  }
  const db = admin.firestore();

  console.log(`Looking up target SKU: ${TARGET_SKU}`);
  console.log(`Looking up source SKU: ${SOURCE_SKU}`);

  const [targetDocs, sourceDocs] = await Promise.all([
    findBySku(db, TARGET_SKU),
    findBySku(db, SOURCE_SKU),
  ]);

  if (targetDocs.length === 0) {
    console.error(`Target not found: ${TARGET_SKU}`);
    process.exit(1);
  }
  if (sourceDocs.length === 0) {
    console.error(`Source not found: ${SOURCE_SKU}`);
    process.exit(1);
  }

  // Pair by same user
  const targetsByUser = new Map();
  for (const d of targetDocs) {
    const uid = userIdFromInventoryPath(d.ref.path);
    if (!uid) continue;
    if (!targetsByUser.has(uid)) targetsByUser.set(uid, []);
    targetsByUser.get(uid).push(d);
  }

  let merges = 0;
  for (const sourceDoc of sourceDocs) {
    const uid = userIdFromInventoryPath(sourceDoc.ref.path);
    if (!uid) continue;
    const targets = targetsByUser.get(uid) || [];
    if (targets.length === 0) {
      console.warn(`No target for user ${uid} / source ${sourceDoc.id}`);
      continue;
    }
    if (targets.length > 1) {
      console.warn(`Multiple targets for user ${uid}; using first ${targets[0].id}`);
    }
    const targetDoc = targets[0];
    const target = targetDoc.data() || {};
    const source = sourceDoc.data() || {};

    if (source.mergedIntoInventoryId) {
      console.log(`Source ${sourceDoc.id} already merged into ${source.mergedIntoInventoryId}; skip.`);
      continue;
    }

    const targetQty = Math.max(0, Math.floor(Number(target.quantity) || 0));
    const sourceQty = Math.max(0, Math.floor(Number(source.quantity) || 0));
    const newQty = targetQty + sourceQty;

    let batches = preserveKnown(
      normalizeBatches(target.expiryBatches),
      normalizeBatches(source.expiryBatches).map((b) => b.expiry).concat([expiryIso(source.expiryDate)])
    );
    for (const b of normalizeBatches(source.expiryBatches)) {
      if (b.quantity > 0) batches = mergeExpiryBatch(batches, b);
      else batches = preserveKnown(batches, [b.expiry]);
    }
    const earliest = earliestExpiry(batches);
    const mergedFrom = Array.from(
      new Set([...(Array.isArray(target.mergedFromInventoryIds) ? target.mergedFromInventoryIds : []), sourceDoc.id])
    );
    const locationQuantities = mergeLocations(target.locationQuantities, source.locationQuantities);

    console.log("---");
    console.log(`User: ${uid}`);
    console.log(`Target A: ${targetDoc.id} sku=${target.sku} qty ${targetQty} → ${newQty}`);
    console.log(`Source B: ${sourceDoc.id} sku=${source.sku} qty ${sourceQty} → 0`);
    console.log(`Expiry lots after merge:`, batches);

    if (DRY_RUN) {
      console.log("DRY_RUN=1 — no writes.");
      continue;
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();
    const targetUpdate = {
      quantity: newQty,
      status: newQty > 0 ? "In Stock" : "Out of Stock",
      expiryBatches: batches,
      expiryDate: earliest,
      mergedFromInventoryIds: mergedFrom,
      locationQuantities,
      updatedAt: now,
      mergedAt: now,
    };
    // Keeper takes the merged-in product’s receiving date.
    if (source.receivingDate != null) {
      targetUpdate.receivingDate = source.receivingDate;
    }
    batch.update(targetDoc.ref, targetUpdate);
    batch.update(sourceDoc.ref, {
      quantity: 0,
      status: "Out of Stock",
      locationQuantities: {},
      mergedIntoInventoryId: targetDoc.id,
      updatedAt: now,
      mergedAt: now,
    });

    const logRef = db.collection("users").doc(uid).collection("inventoryChangeLogs").doc();
    batch.set(logRef, {
      inventoryId: targetDoc.id,
      productName: target.productName || TARGET_SKU,
      sku: target.sku || TARGET_SKU,
      eventType: "inventory_product_merge",
      qtyBefore: targetQty,
      qtyAfter: newQty,
      qtyChange: sourceQty,
      sourceInventoryId: sourceDoc.id,
      sourceSku: source.sku || SOURCE_SKU,
      sourceProductName: source.productName || null,
      sourceQtyMerged: sourceQty,
      details: `Merged ${sourceQty} units from ${source.sku || SOURCE_SKU} (${sourceDoc.id}). Source restock/ship history stays on that row.`,
      at: now,
    });

    await batch.commit();
    merges += 1;
    console.log(`Merged OK. Change log: ${logRef.id}`);
  }

  console.log(`Done. Merges committed: ${merges}${DRY_RUN ? " (dry run)" : ""}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
