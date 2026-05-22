import type { UserFeature } from "@/types";

/**
 * Path-to-feature mapping for client dashboard.
 * Used to show "Unlock - contact admin" overlay when user lacks the feature.
 * Order matters for prefix matching: longer paths first.
 */
const PATH_FEATURE_MAP: { path: string; feature: UserFeature; exact?: boolean }[] = [
  { path: "/dashboard/create-shipment-with-labels", feature: "create_shipment", exact: true },
  { path: "/dashboard/shipped-orders", feature: "shipped_orders", exact: true },
  { path: "/dashboard/product-returns", feature: "request_product_returns", exact: true },
  { path: "/dashboard/track-shipment", feature: "track_shipment", exact: true },
  { path: "/dashboard/restock-history", feature: "restock_summary", exact: true },
  { path: "/dashboard/edit-logs", feature: "modification_logs", exact: true },
  { path: "/dashboard/delete-logs", feature: "delete_logs", exact: true },
  { path: "/dashboard/purchased-labels", feature: "upload_labels", exact: true },
  { path: "/dashboard/inventory", feature: "view_inventory", exact: true },
  { path: "/dashboard/buy-labels", feature: "buy_labels", exact: true },
  { path: "/dashboard/recycle-bin", feature: "disposed_inventory", exact: true },
  { path: "/dashboard/invoices", feature: "view_invoices", exact: true },
  { path: "/dashboard/pricing", feature: "my_pricing", exact: true },
  { path: "/dashboard/documents", feature: "client_documents", exact: true },
  { path: "/dashboard/shopify-orders", feature: "view_shopify_orders", exact: true },
  { path: "/dashboard/integrations", feature: "integrations", exact: false },
  { path: "/dashboard/agent", feature: "affiliate_dashboard", exact: false },
  { path: "/dashboard", feature: "view_dashboard", exact: true },
];

/**
 * Returns the required client feature for a dashboard path, or null if no gate applies.
 */
export function getRequiredFeatureForPath(pathname: string | null): UserFeature | null {
  if (!pathname) return null;
  const path = pathname.replace(/\/$/, "") || "/";
  const exact = PATH_FEATURE_MAP.find((e) => e.exact !== false && e.path === path);
  if (exact) return exact.feature;
  const sorted = [...PATH_FEATURE_MAP].filter((e) => e.exact === false);
  sorted.sort((a, b) => b.path.length - a.path.length);
  const prefix = sorted.find((e) => path === e.path || path.startsWith(e.path + "/"));
  return prefix ? prefix.feature : null;
}
