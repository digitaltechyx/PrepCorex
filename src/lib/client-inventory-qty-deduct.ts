import {
  consumeExpiryBatches,
  reconcileExpiryBatchesToOnHand,
  type ExpiryBatch,
  type StockRotationPolicy,
} from "@/lib/inventory-expiry-batches";

/**
 * Deduct sellable qty and apply FEFO to expiryBatches (for Shopify/eBay/Amazon quick fulfill).
 * Always returns batches reconciled to the new on-hand so Expiry shows remaining units.
 */
export function buildClientInventoryQtyDeductUpdate(input: {
  quantity: number;
  expiryBatches?: ExpiryBatch[] | null;
  expiryDate?: unknown;
  shipQty: number;
  policy?: StockRotationPolicy;
}): {
  quantity: number;
  status: string;
  expiryBatches: ExpiryBatch[];
  expiryDate: string | null;
  consumedExpiryBatches: ExpiryBatch[];
} {
  const currentQty = Math.max(0, Math.floor(Number(input.quantity) || 0));
  const shipQty = Math.max(0, Math.floor(Number(input.shipQty) || 0));
  const newQuantity = Math.max(0, currentQty - shipQty);
  const policy = input.policy ?? "fefo";

  const consumed = consumeExpiryBatches(input.expiryBatches, shipQty, policy, {
    onHandQuantity: currentQty,
    legacyExpiryDate: input.expiryDate,
  });
  const reconciled = reconcileExpiryBatchesToOnHand(
    consumed.batches,
    newQuantity,
    consumed.expiryDate ?? input.expiryDate,
    policy
  );

  return {
    quantity: newQuantity,
    status: newQuantity > 0 ? "In Stock" : "Out of Stock",
    expiryBatches: reconciled.batches,
    expiryDate: reconciled.expiryDate,
    consumedExpiryBatches: [...consumed.consumed, ...reconciled.consumed],
  };
}
