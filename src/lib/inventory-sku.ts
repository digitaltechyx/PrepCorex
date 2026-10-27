/**
 * Warehouse cartons/bins need a non-empty line key when the client left SKU blank.
 * These placeholders must never appear as the client's inventory SKU.
 */
export function isWarehousePlaceholderSku(sku: string | null | undefined): boolean {
  return /^NOSKU-/i.test(String(sku ?? "").trim());
}

/** Client-facing SKU — empty when missing or a warehouse placeholder. */
export function clientFacingSku(sku: string | null | undefined): string | null {
  const trimmed = String(sku ?? "").trim();
  if (!trimmed || isWarehousePlaceholderSku(trimmed)) return null;
  return trimmed;
}

export function warehouseSkuForRequest(input: {
  sku?: string | null;
  requestId: string;
}): string {
  return clientFacingSku(input.sku) || `NOSKU-${input.requestId}`;
}
