/** Scopes enabled for PrepCoreX in TikTok Partner Center (Manage API). */
export const TIKTOK_SCOPES = [
  "seller.authorization.info",
  "seller.order.info",
  "seller.product.basic",
  "seller.product.write",
  "seller.logistics",
  "seller.delivery.status.write",
  /** Required for packages/search and ship / tracking updates */
  "seller.fulfillment.basic",
  "seller.fulfillment.package.write",
] as const;
