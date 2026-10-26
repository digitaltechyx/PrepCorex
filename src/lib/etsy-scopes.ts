/** Scopes PrepCorex requests when a seller connects Etsy (OAuth). */
export const ETSY_SCOPES = [
  "shops_r",
  "listings_r",
  "listings_w",
  "transactions_r",
  "transactions_w",
] as const;

export function etsyScopeParam(scopes: readonly string[] = ETSY_SCOPES): string {
  return scopes.join(" ");
}
