/**
 * FEFO smoke check: ship 100 from Jun 6 (23) + Dec 12 (348).
 * Run: node --experimental-strip-types scripts/check-fefo-consume.mjs
 *   or: npx tsx scripts/check-fefo-consume.ts
 */
import assert from "node:assert/strict";

function normalize(existing) {
  return (existing || [])
    .map((b) => ({
      expiry: String(b.expiry || "").trim(),
      quantity: Math.max(0, Math.floor(Number(b.quantity) || 0)),
    }))
    .filter((b) => Boolean(b.expiry));
}

/** Mirrors src/lib/inventory-expiry-batches.ts consumeExpiryBatches FEFO path. */
function consumeExpiryBatches(existing, units) {
  const take = Math.max(0, Math.floor(units));
  const ordered = [...normalize(existing)].sort((a, b) => a.expiry.localeCompare(b.expiry));
  let remaining = take;
  const consumed = [];
  for (const batch of ordered) {
    if (remaining <= 0) break;
    if (batch.quantity <= 0) continue;
    const qty = Math.min(batch.quantity, remaining);
    if (qty <= 0) continue;
    batch.quantity -= qty;
    remaining -= qty;
    consumed.push({ expiry: batch.expiry, quantity: qty });
  }
  const batches = ordered.sort((a, b) => a.expiry.localeCompare(b.expiry));
  const expiryDate = batches.find((b) => b.quantity > 0)?.expiry ?? null;
  return {
    batches,
    consumed,
    expiryDate,
  };
}

function prepareExpiryBatchesForDeduction(existing, onHandQuantity, legacyExpiryDate) {
  let next = normalize(existing);
  const onHand = Math.max(0, Math.floor(Number(onHandQuantity) || 0));
  const legacy =
    typeof legacyExpiryDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(legacyExpiryDate.trim())
      ? legacyExpiryDate.trim()
      : null;
  if (next.length === 0) {
    return legacy && onHand > 0 ? [{ expiry: legacy, quantity: onHand }] : [];
  }
  const sum = next.reduce((t, b) => t + b.quantity, 0);
  if (sum < onHand && (legacy || next[0]?.expiry)) {
    const fill = legacy || next[0].expiry;
    const idx = next.findIndex((b) => b.expiry === fill);
    if (idx >= 0) next[idx].quantity += onHand - sum;
    else next.push({ expiry: fill, quantity: onHand - sum });
  }
  return next.sort((a, b) => a.expiry.localeCompare(b.expiry));
}

const split = consumeExpiryBatches(
  [
    { expiry: "2027-06-06", quantity: 23 },
    { expiry: "2027-12-12", quantity: 348 },
  ],
  100
);
assert.deepEqual(split.consumed, [
  { expiry: "2027-06-06", quantity: 23 },
  { expiry: "2027-12-12", quantity: 77 },
]);
assert.deepEqual(split.batches, [
  { expiry: "2027-06-06", quantity: 0 },
  { expiry: "2027-12-12", quantity: 271 },
]);
assert.equal(split.expiryDate, "2027-12-12");

const seeded = prepareExpiryBatchesForDeduction([], 371, "2027-06-06");
assert.deepEqual(seeded, [{ expiry: "2027-06-06", quantity: 371 }]);

const afterSeedShip = consumeExpiryBatches(
  prepareExpiryBatchesForDeduction(
    [{ expiry: "2027-12-12", quantity: 100 }],
    371,
    "2027-06-06"
  ),
  100
);
assert.equal(afterSeedShip.consumed[0].expiry, "2027-06-06");
assert.equal(afterSeedShip.consumed[0].quantity, 100);

function reconcileExpiryBatchesToOnHand(existing, onHandQuantity) {
  const onHand = Math.max(0, Math.floor(Number(onHandQuantity) || 0));
  const prepared = normalize(existing);
  const sum = prepared.reduce((t, b) => t + b.quantity, 0);
  if (sum <= onHand) return { batches: prepared, adjusted: false };
  return { ...consumeExpiryBatches(prepared, sum - onHand), adjusted: true };
}

const healed = reconcileExpiryBatchesToOnHand(
  [
    { expiry: "2027-06-06", quantity: 23 },
    { expiry: "2027-12-12", quantity: 348 },
  ],
  267
);
assert.equal(healed.adjusted, true);
assert.deepEqual(healed.batches, [
  { expiry: "2027-06-06", quantity: 0 },
  { expiry: "2027-12-12", quantity: 267 },
]);

function preserveKnownExpiryLots(existing, knownExpiries) {
  const byExpiry = new Map(normalize(existing).map((b) => [b.expiry, { ...b }]));
  for (const expiry of knownExpiries || []) {
    if (!expiry || byExpiry.has(expiry)) continue;
    byExpiry.set(expiry, { expiry, quantity: 0 });
  }
  return Array.from(byExpiry.values()).sort((a, b) => a.expiry.localeCompare(b.expiry));
}

const restored = preserveKnownExpiryLots([{ expiry: "2027-12-12", quantity: 267 }], [
  "2027-06-06",
  "2027-12-12",
]);
assert.deepEqual(restored, [
  { expiry: "2027-06-06", quantity: 0 },
  { expiry: "2027-12-12", quantity: 267 },
]);

console.log("FEFO checks passed (keep/restore 0-unit lots, 23+77 split, reconcile to 267).");
