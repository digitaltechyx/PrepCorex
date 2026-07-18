/** Admin margin added on top of carrier/OMS quoted rates (Buy Labels). */
export const BUY_LABELS_ADMIN_MARKUP = 0.15;

export function applyBuyLabelsMarkup(baseAmount: number): string {
  const safe = Number.isFinite(baseAmount) ? baseAmount : 0;
  return (safe + BUY_LABELS_ADMIN_MARKUP).toFixed(2);
}
