/** Admin margin added on top of carrier/OMS quoted rates (Buy Labels). Default $0.15. */
export const BUY_LABELS_ADMIN_MARKUP = 0.15;
export const BUY_LABELS_ADMIN_MARKUP_CENTS = 15;

export function markupCentsToDollars(cents: number | null | undefined): number {
  if (!Number.isFinite(Number(cents))) return BUY_LABELS_ADMIN_MARKUP;
  return Math.max(0, Math.floor(Number(cents))) / 100;
}

/** Apply per-client or default markup. `markupDollars` overrides the global default when provided. */
export function applyBuyLabelsMarkup(baseAmount: number, markupDollars?: number): string {
  const markup =
    markupDollars != null && Number.isFinite(markupDollars)
      ? Math.max(0, markupDollars)
      : BUY_LABELS_ADMIN_MARKUP;
  const safe = Number.isFinite(baseAmount) ? baseAmount : 0;
  return (safe + markup).toFixed(2);
}
