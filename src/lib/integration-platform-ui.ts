import { INTEGRATION_PLATFORMS, type IntegrationPlatformId } from "@/lib/integration-permissions";

export type PlatformCategory = "marketplace" | "ecommerce" | "social" | "shipping";
export type PlatformStatus = "live" | "coming_soon";

export type IntegrationPlatformCardDef = {
  id: string;
  name: string;
  shortName: string;
  category: PlatformCategory;
  categoryLabel: string;
  status: PlatformStatus;
  description: string;
  accent: string;
  ring: string;
};

const LIVE_IDS = new Set(INTEGRATION_PLATFORMS.map((p) => p.id));

/** Live + roadmap cards shown on integrations hub UIs. */
export const INTEGRATION_PLATFORM_CARDS: IntegrationPlatformCardDef[] = [
  {
    id: "shopify",
    name: "Shopify",
    shortName: "SH",
    category: "ecommerce",
    categoryLabel: "E‑commerce",
    status: "live",
    description: "Sync orders and inventory from client Shopify storefronts.",
    accent: "from-emerald-500/90 to-teal-600/90",
    ring: "ring-emerald-500/20",
  },
  {
    id: "ebay",
    name: "eBay",
    shortName: "EB",
    category: "marketplace",
    categoryLabel: "Marketplace",
    status: "live",
    description: "Linked seller accounts for event-based order sync and listings.",
    accent: "from-blue-500/90 to-indigo-600/90",
    ring: "ring-blue-500/20",
  },
  {
    id: "amazon",
    name: "Amazon",
    shortName: "AMZ",
    category: "marketplace",
    categoryLabel: "Marketplace",
    status: "live",
    description: "Amazon Seller Central (SP-API) connections across clients.",
    accent: "from-amber-500/80 to-orange-600/80",
    ring: "ring-amber-500/15",
  },
  {
    id: "etsy",
    name: "Etsy",
    shortName: "ET",
    category: "marketplace",
    categoryLabel: "Marketplace",
    status: "coming_soon",
    description: "Handmade & vintage marketplace sync — planned.",
    accent: "from-orange-500/80 to-rose-600/80",
    ring: "ring-orange-500/15",
  },
  {
    id: "tiktok",
    name: "TikTok Shop",
    shortName: "TT",
    category: "social",
    categoryLabel: "Social commerce",
    status: "live",
    description: "TikTok Shop product and order sync for connected clients.",
    accent: "from-fuchsia-500/80 to-pink-600/80",
    ring: "ring-fuchsia-500/15",
  },
  {
    id: "walmart",
    name: "Walmart Marketplace",
    shortName: "WM",
    category: "marketplace",
    categoryLabel: "Marketplace",
    status: "coming_soon",
    description: "Walmart seller integration — planned.",
    accent: "from-sky-500/80 to-blue-700/80",
    ring: "ring-sky-500/15",
  },
  {
    id: "woocommerce",
    name: "WooCommerce",
    shortName: "WC",
    category: "ecommerce",
    categoryLabel: "E‑commerce",
    status: "live",
    description: "WooCommerce REST API store connections.",
    accent: "from-violet-500/80 to-purple-700/80",
    ring: "ring-violet-500/15",
  },
  {
    id: "shipstation",
    name: "ShipStation",
    shortName: "SS",
    category: "shipping",
    categoryLabel: "Shipping",
    status: "live",
    description: "ShipStation accounts syncing orders and purchased labels.",
    accent: "from-indigo-500/85 to-violet-600/85",
    ring: "ring-indigo-500/15",
  },
];

export const INTEGRATION_CATEGORY_OPTIONS: { id: "all" | PlatformCategory; label: string }[] = [
  { id: "all", label: "All categories" },
  { id: "marketplace", label: "Marketplaces" },
  { id: "ecommerce", label: "E‑commerce" },
  { id: "social", label: "Social commerce" },
  { id: "shipping", label: "Shipping" },
];

export function isLiveIntegrationPlatformId(id: string): id is IntegrationPlatformId {
  return LIVE_IDS.has(id as IntegrationPlatformId);
}
