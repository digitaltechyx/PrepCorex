import type { UserFeature, UserProfile } from "@/types";
import { hasFeature, hasAnyFeature } from "@/lib/permissions";

/** Live integration platforms that admins can grant per client. */
export type IntegrationPlatformId =
  | "shopify"
  | "ebay"
  | "amazon"
  | "tiktok"
  | "woocommerce"
  | "shipstation";

export type IntegrationPlatformConfig = {
  id: IntegrationPlatformId;
  label: string;
  description: string;
  integrationFeature: UserFeature;
  ordersFeature: UserFeature;
};

export const INTEGRATION_PLATFORMS: IntegrationPlatformConfig[] = [
  {
    id: "shopify",
    label: "Shopify",
    description: "Connect Shopify stores, sync orders, and fulfill from PrepCorex",
    integrationFeature: "integration_shopify",
    ordersFeature: "view_shopify_orders",
  },
  {
    id: "ebay",
    label: "eBay",
    description: "Connect eBay seller accounts for listings and order sync",
    integrationFeature: "integration_ebay",
    ordersFeature: "view_ebay_orders",
  },
  {
    id: "amazon",
    label: "Amazon",
    description: "Connect Amazon Seller Central (SP-API) for orders and catalog",
    integrationFeature: "integration_amazon",
    ordersFeature: "view_amazon_orders",
  },
  {
    id: "tiktok",
    label: "TikTok Shop",
    description: "Connect TikTok Shop for products, orders, and fulfillment",
    integrationFeature: "integration_tiktok",
    ordersFeature: "view_tiktok_orders",
  },
  {
    id: "woocommerce",
    label: "WooCommerce",
    description: "Connect WooCommerce stores via REST API keys",
    integrationFeature: "integration_woocommerce",
    ordersFeature: "view_woocommerce_orders",
  },
  {
    id: "shipstation",
    label: "ShipStation",
    description: "Connect ShipStation to sync orders and purchased labels",
    integrationFeature: "integration_shipstation",
    ordersFeature: "view_shipstation_orders",
  },
];

export const INTEGRATION_FEATURES_CONFIG = INTEGRATION_PLATFORMS.map((p) => ({
  value: p.integrationFeature,
  label: p.label,
  description: p.description,
  platformId: p.id,
  ordersFeature: p.ordersFeature,
}));

const PLATFORM_BY_ID = new Map(INTEGRATION_PLATFORMS.map((p) => [p.id, p]));

const ORDER_PATH_TO_PLATFORM: Record<string, IntegrationPlatformId> = {
  "/dashboard/shopify-orders": "shopify",
  "/dashboard/tiktok-orders": "tiktok",
  "/dashboard/shipstation-orders": "shipstation",
  "/dashboard/woocommerce-orders": "woocommerce",
};

const INTEGRATION_SUBPATH_TO_PLATFORM: Record<string, IntegrationPlatformId> = {
  shopify: "shopify",
  ebay: "ebay",
  amazon: "amazon",
  tiktok: "tiktok",
  woocommerce: "woocommerce",
  shipstation: "shipstation",
  connect: "ebay",
};

function platformConfig(id: IntegrationPlatformId): IntegrationPlatformConfig {
  const cfg = PLATFORM_BY_ID.get(id);
  if (!cfg) throw new Error(`Unknown integration platform: ${id}`);
  return cfg;
}

/** Legacy umbrella feature — grants every platform. */
export function hasAllIntegrationsAccess(userProfile: UserProfile | null | undefined): boolean {
  return hasFeature(userProfile, "integrations");
}

function platformFeatures(id: IntegrationPlatformId): UserFeature[] {
  const { integrationFeature, ordersFeature } = platformConfig(id);
  return [integrationFeature, ordersFeature];
}

/** True if user may view the integrations hub or a specific platform card. */
export function canAccessIntegrationPlatform(
  userProfile: UserProfile | null | undefined,
  platformId: IntegrationPlatformId
): boolean {
  if (!userProfile) return false;
  if (hasAllIntegrationsAccess(userProfile)) return true;
  const { integrationFeature, ordersFeature } = platformConfig(platformId);
  return hasAnyFeature(userProfile, integrationFeature, ordersFeature);
}

/** True if user may connect or manage connections for a platform. */
export function canConnectIntegrationPlatform(
  userProfile: UserProfile | null | undefined,
  platformId: IntegrationPlatformId
): boolean {
  if (!userProfile) return false;
  if (hasAllIntegrationsAccess(userProfile)) return true;
  const { integrationFeature } = platformConfig(platformId);
  return hasFeature(userProfile, integrationFeature);
}

/** True if user may open the platform orders dashboard page. */
export function canViewIntegrationOrders(
  userProfile: UserProfile | null | undefined,
  platformId: IntegrationPlatformId
): boolean {
  return canAccessIntegrationPlatform(userProfile, platformId);
}

/** True if user has at least one integration platform (or legacy all-access). */
export function hasAnyIntegrationPlatformAccess(
  userProfile: UserProfile | null | undefined
): boolean {
  if (!userProfile) return false;
  if (hasAllIntegrationsAccess(userProfile)) return true;
  return INTEGRATION_PLATFORMS.some((p) => canAccessIntegrationPlatform(userProfile, p.id));
}

/** Resolve platform from /dashboard/integrations/{segment}/... */
export function getIntegrationPlatformFromPath(pathname: string | null): IntegrationPlatformId | null {
  if (!pathname) return null;
  const path = pathname.replace(/\/$/, "") || "/";
  if (!path.startsWith("/dashboard/integrations/")) return null;
  const rest = path.slice("/dashboard/integrations/".length);
  const segment = rest.split("/")[0];
  if (!segment) return null;
  return INTEGRATION_SUBPATH_TO_PLATFORM[segment] ?? null;
}

/** Resolve platform from top-level order pages (/dashboard/shopify-orders, etc.). */
export function getOrderPlatformFromPath(pathname: string | null): IntegrationPlatformId | null {
  if (!pathname) return null;
  const path = pathname.replace(/\/$/, "") || "/";
  return ORDER_PATH_TO_PLATFORM[path] ?? null;
}

export function isIntegrationsHubPath(pathname: string | null): boolean {
  if (!pathname) return false;
  const path = pathname.replace(/\/$/, "") || "/";
  return path === "/dashboard/integrations";
}

export function isIntegrationRelatedPath(pathname: string | null): boolean {
  if (!pathname) return false;
  const path = pathname.replace(/\/$/, "") || "/";
  return (
    path === "/dashboard/integrations" ||
    path.startsWith("/dashboard/integrations/") ||
    path in ORDER_PATH_TO_PLATFORM
  );
}

/** Whether a client dashboard path is allowed based on integration permissions. */
export function canAccessIntegrationPath(
  userProfile: UserProfile | null | undefined,
  pathname: string | null
): boolean | null {
  if (!pathname) return null;
  const path = pathname.replace(/\/$/, "") || "/";

  const orderPlatform = getOrderPlatformFromPath(path);
  if (orderPlatform) {
    return canViewIntegrationOrders(userProfile, orderPlatform);
  }

  if (isIntegrationsHubPath(path)) {
    return hasAnyIntegrationPlatformAccess(userProfile);
  }

  const platformFromSubpath = getIntegrationPlatformFromPath(path);
  if (platformFromSubpath) {
    return canAccessIntegrationPlatform(userProfile, platformFromSubpath);
  }

  return null;
}

/** Features to add/remove when toggling a platform in admin UI. */
export function featuresForIntegrationPlatform(platformId: IntegrationPlatformId): UserFeature[] {
  return platformFeatures(platformId);
}
