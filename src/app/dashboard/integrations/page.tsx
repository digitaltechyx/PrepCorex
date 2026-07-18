"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Plug,
  Loader2,
  Plus,
  Trash2,
  Package,
  ShoppingBag,
  ShoppingCart,
  Search,
  Store,
  Sparkles,
  Link2,
  Info,
} from "lucide-react";
import { format } from "date-fns";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { PlatformBrandLogo } from "@/components/integrations/platform-brand-logo";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type ShopifySelectedVariant = { variantId: string; productId: string; title: string; sku?: string };

type ShopifyConnectionSummary = {
  id: string;
  shop: string;
  shopName: string;
  connectedAt: { seconds: number; nanoseconds: number } | string;
  selectedVariants?: ShopifySelectedVariant[];
};

type EbayConnectionSummary = {
  id: string;
  connectedAt: { seconds: number; nanoseconds: number } | string;
  environment: string;
  selectedOfferIds?: string[];
};

type PlatformCategory = "marketplace" | "ecommerce" | "social" | "shipping";
type PlatformStatus = "live" | "coming_soon";
type FilterTab = "all" | "connected" | "available" | "soon";

type PlatformDef = {
  id: string;
  name: string;
  shortName: string;
  category: PlatformCategory;
  categoryLabel: string;
  status: PlatformStatus;
  description: string;
  /** Tailwind gradient for card accent */
  accent: string;
  ring: string;
};

const PLATFORMS: PlatformDef[] = [
  {
    id: "shopify",
    name: "Shopify",
    shortName: "SH",
    category: "ecommerce",
    categoryLabel: "E‑commerce",
    status: "live",
    description: "Sync orders and inventory from your Shopify storefronts. Admins can fulfill from PrepCorex.",
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
    description: "Link seller accounts for event-based order sync and listing management.",
    accent: "from-blue-500/90 to-indigo-600/90",
    ring: "ring-blue-500/20",
  },
  {
    id: "amazon",
    name: "Amazon",
    shortName: "AMZ",
    category: "marketplace",
    categoryLabel: "Marketplace",
    status: "coming_soon",
    description: "SP-API marketplace integration for orders and catalog — on our roadmap.",
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
    status: "coming_soon",
    description: "TikTok Shop orders and catalog — planned.",
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
    status: "coming_soon",
    description: "WordPress / WooCommerce store connection — planned.",
    accent: "from-violet-500/80 to-purple-700/80",
    ring: "ring-violet-500/15",
  },
  {
    id: "shipstation",
    name: "ShipStation",
    shortName: "SS",
    category: "shipping",
    categoryLabel: "Shipping",
    status: "coming_soon",
    description: "Import orders, print labels, and sync tracking from ShipStation — planned.",
    accent: "from-indigo-500/85 to-violet-600/85",
    ring: "ring-indigo-500/15",
  },
  {
    id: "shipbest",
    name: "ShipBest",
    shortName: "SB",
    category: "shipping",
    categoryLabel: "Shipping",
    status: "live",
    description: "GOFO / ShipBest OMS labels in Buy Labels — rates, Stripe checkout, and tracking.",
    accent: "from-rose-500/85 to-orange-600/85",
    ring: "ring-rose-500/15",
  },
];

const CATEGORY_OPTIONS: { id: "all" | PlatformCategory; label: string }[] = [
  { id: "all", label: "All categories" },
  { id: "marketplace", label: "Marketplaces" },
  { id: "ecommerce", label: "E‑commerce" },
  { id: "social", label: "Social commerce" },
  { id: "shipping", label: "Shipping" },
];

function connectionCountFor(
  platformId: string,
  shopify: ShopifyConnectionSummary[],
  ebay: EbayConnectionSummary[]
): number {
  if (platformId === "shopify") return shopify.length;
  if (platformId === "ebay") return ebay.length;
  return 0;
}

export default function IntegrationsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [shopifyConnections, setShopifyConnections] = useState<ShopifyConnectionSummary[]>([]);
  const [ebayConnections, setEbayConnections] = useState<EbayConnectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [shopInput, setShopInput] = useState("");
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const [pendingDisconnect, setPendingDisconnect] = useState<{ id: string; shopName: string } | null>(null);
  const [ebayDisconnectId, setEbayDisconnectId] = useState<string | null>(null);
  const [ebayConnectLoading, setEbayConnectLoading] = useState(false);
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | PlatformCategory>("all");
  const [search, setSearch] = useState("");

  const fetchConnections = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const [shopifyRes, ebayRes] = await Promise.all([
        fetch("/api/integrations/shopify-connections", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/integrations/ebay-connections", { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (shopifyRes.ok) {
        const data = await shopifyRes.json();
        setShopifyConnections(data.connections ?? []);
      }
      if (ebayRes.ok) {
        const data = await ebayRes.json();
        setEbayConnections(data.connections ?? []);
      }
    } catch {
      setShopifyConnections([]);
      setEbayConnections([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConnections();
  }, [user?.uid]);

  const totalConnections = shopifyConnections.length + ebayConnections.length;
  const liveConnectedPlatforms = [shopifyConnections.length > 0, ebayConnections.length > 0].filter(Boolean).length;

  const visiblePlatforms = useMemo(() => {
    const q = search.trim().toLowerCase();
    return PLATFORMS.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q) && !p.categoryLabel.toLowerCase().includes(q)) return false;
      if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
      const n = connectionCountFor(p.id, shopifyConnections, ebayConnections);
      if (filterTab === "connected") return p.status === "live" && n > 0;
      if (filterTab === "available") return p.status === "live" && n === 0;
      if (filterTab === "soon") return p.status === "coming_soon";
      return true;
    });
  }, [search, categoryFilter, filterTab, shopifyConnections, ebayConnections]);

  const handleConnectShopify = () => {
    let shop = shopInput.trim().toLowerCase().replace(/\.myshopify\.com$/i, "");
    shop = shop.replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    if (!shop) {
      toast({
        variant: "destructive",
        title: "Enter your store name",
        description: "Use only letters, numbers, or hyphens (e.g. mystore or my-store). No spaces.",
      });
      return;
    }
    const shopDomain = shop.includes(".myshopify.com") ? shop : `${shop}.myshopify.com`;
    setConnectDialogOpen(false);
    setShopInput("");
    window.location.href = `/api/shopify/install?shop=${encodeURIComponent(shopDomain)}`;
  };

  const handleDisconnect = async (id: string, removeInventory: boolean) => {
    if (!user) return;
    setDisconnectingId(id);
    try {
      const token = await user.getIdToken();
      const url = `/api/integrations/shopify-connections?id=${encodeURIComponent(id)}${removeInventory ? "&removeInventory=true" : ""}`;
      const res = await fetch(url, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to disconnect");
      }
      const data = await res.json().catch(() => ({}));
      const removed = (data.removedInventoryCount as number) ?? 0;
      toast({
        title: "Disconnected",
        description:
          removed > 0
            ? `Shopify store disconnected. ${removed} linked product(s) removed from your inventory.`
            : "Shopify store has been disconnected.",
      });
      setDisconnectDialogOpen(false);
      setPendingDisconnect(null);
      fetchConnections();
    } catch (err: unknown) {
      toast({
        variant: "destructive",
        title: "Error",
        description: err instanceof Error ? err.message : "Could not disconnect.",
      });
    } finally {
      setDisconnectingId(null);
    }
  };

  const openDisconnectDialog = (conn: ShopifyConnectionSummary) => {
    setPendingDisconnect({
      id: conn.id,
      shopName: conn.shopName || conn.shop?.replace(".myshopify.com", "") || "this store",
    });
    setDisconnectDialogOpen(true);
  };

  const handleConnectEbay = async (addNew?: boolean) => {
    if (!user) return;
    setEbayConnectLoading(true);
    try {
      const token = await user.getIdToken();
      const url = addNew ? "/api/integrations/ebay/authorize-url?addNew=true" : "/api/integrations/ebay/authorize-url";
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ variant: "destructive", title: "eBay", description: data.error || "Could not start connection." });
        return;
      }
      if (data.url) window.location.href = data.url;
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e instanceof Error ? e.message : "Failed to connect eBay.",
      });
    } finally {
      setEbayConnectLoading(false);
    }
  };

  const handleDisconnectEbay = async (id: string) => {
    if (!user) return;
    setEbayDisconnectId(id);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/integrations/ebay-connections?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to disconnect");
      }
      toast({ title: "Disconnected", description: "eBay account has been disconnected." });
      fetchConnections();
    } catch (err: unknown) {
      toast({
        variant: "destructive",
        title: "Error",
        description: err instanceof Error ? err.message : "Could not disconnect.",
      });
    } finally {
      setEbayDisconnectId(null);
    }
  };

  const formatConnectedAt = (raw: ShopifyConnectionSummary["connectedAt"]) => {
    if (!raw) return "—";
    if (typeof raw === "string") return format(new Date(raw), "PP");
    if (typeof raw === "object" && "seconds" in raw && raw.seconds) return format(new Date(raw.seconds * 1000), "PP");
    return "—";
  };

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6 sm:space-y-8 pb-2 sm:pb-4">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-4 py-6 text-white shadow-xl sm:px-8 sm:py-8 md:px-10 md:py-10">
        <div
          className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-emerald-500/20 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-24 -left-16 h-56 w-56 rounded-full bg-violet-500/15 blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between md:gap-8">
          <div className="min-w-0 max-w-2xl space-y-3 md:flex-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-emerald-200/90 backdrop-blur-sm">
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              Connected commerce
            </div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl md:text-4xl lg:text-[2.5rem] lg:leading-tight">
              Integrations hub
            </h1>
            <p className="text-sm leading-relaxed text-slate-300 sm:text-base md:max-w-xl lg:max-w-2xl">
              One place to connect marketplaces, storefronts, and shipping tools. Live channels sync orders automatically;
              upcoming platforms are shown so you can plan ahead.
            </p>
          </div>
          <div className="grid w-full grid-cols-3 gap-2 sm:gap-3 md:w-auto md:min-w-[min(100%,20rem)] md:max-w-md md:shrink-0 lg:min-w-[22rem] lg:max-w-none">
            <div
              className="rounded-xl border border-white/10 bg-white/5 px-2 py-2.5 backdrop-blur-sm sm:px-4 sm:py-3"
              title="Total connected store and marketplace links"
            >
              <p className="text-[10px] font-semibold uppercase leading-tight tracking-wider text-slate-400 sm:text-[11px]">
                Active links
              </p>
              <p className="text-xl font-bold tabular-nums sm:text-2xl">{loading ? "—" : totalConnections}</p>
            </div>
            <div
              className="rounded-xl border border-white/10 bg-white/5 px-2 py-2.5 backdrop-blur-sm sm:px-4 sm:py-3"
              title="Live platforms in use"
            >
              <p className="text-[10px] font-semibold uppercase leading-tight tracking-wider text-slate-400 sm:text-[11px]">
                <span className="sm:hidden">Live use</span>
                <span className="hidden sm:inline">Live platforms</span>
              </p>
              <p className="text-xl font-bold tabular-nums sm:text-2xl">{loading ? "—" : liveConnectedPlatforms}</p>
            </div>
            <div
              className="rounded-xl border border-white/10 bg-white/5 px-2 py-2.5 backdrop-blur-sm sm:px-4 sm:py-3"
              title="Platforms in catalog"
            >
              <p className="text-[10px] font-semibold uppercase leading-tight tracking-wider text-slate-400 sm:text-[11px]">
                <span className="sm:hidden">Catalog</span>
                <span className="hidden sm:inline">Catalog size</span>
              </p>
              <p className="text-xl font-bold tabular-nums sm:text-2xl">{PLATFORMS.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <Card className="border-border/80 shadow-sm">
        <CardContent className="flex flex-col gap-4 p-4 sm:p-5 md:p-6">
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search platforms (Shopify, ShipStation, TikTok…)"
              className="h-11 min-h-11 pl-10 text-base sm:text-sm"
            />
          </div>
          <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
            <Tabs value={filterTab} onValueChange={(v) => setFilterTab(v as FilterTab)} className="w-full min-w-0 md:max-w-[min(100%,36rem)]">
              <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1 sm:inline-flex sm:w-full sm:flex-wrap sm:justify-start md:w-auto md:flex-nowrap">
                <TabsTrigger
                  value="all"
                  className="min-h-10 flex-1 px-2 text-xs sm:min-h-9 sm:flex-none sm:px-3 sm:text-sm"
                >
                  All
                </TabsTrigger>
                <TabsTrigger
                  value="connected"
                  className="min-h-10 flex-1 px-2 text-xs sm:min-h-9 sm:flex-none sm:px-3 sm:text-sm"
                >
                  Connected
                </TabsTrigger>
                <TabsTrigger
                  value="available"
                  className="min-h-10 flex-1 px-2 text-xs sm:min-h-9 sm:flex-none sm:px-3 sm:text-sm"
                >
                  <span className="sm:hidden">Ready</span>
                  <span className="hidden sm:inline">Ready to connect</span>
                </TabsTrigger>
                <TabsTrigger
                  value="soon"
                  className="min-h-10 flex-1 px-2 text-xs sm:min-h-9 sm:flex-none sm:px-3 sm:text-sm"
                >
                  <span className="sm:hidden">Soon</span>
                  <span className="hidden sm:inline">Coming soon</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex min-w-0 flex-wrap gap-2 md:max-w-[min(100%,28rem)] md:justify-end lg:max-w-none">
              {CATEGORY_OPTIONS.map((c) => (
                <Button
                  key={c.id}
                  type="button"
                  size="sm"
                  variant={categoryFilter === c.id ? "default" : "outline"}
                  className={cn(
                    "min-h-9 shrink-0 rounded-full text-xs touch-manipulation",
                    categoryFilter === c.id && "shadow-md"
                  )}
                  onClick={() => setCategoryFilter(c.id)}
                >
                  {c.label}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Grid */}
      {loading ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed py-20 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm">Loading your connections…</p>
        </div>
      ) : visiblePlatforms.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Plug className="h-10 w-10 text-muted-foreground/50" />
            <p className="font-medium">No platforms match your filters</p>
            <p className="text-sm text-muted-foreground">Try &quot;All&quot; or clear search.</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => {
                setFilterTab("all");
                setCategoryFilter("all");
                setSearch("");
              }}
            >
              Reset filters
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 lg:gap-6">
          {visiblePlatforms.map((p) => {
            const count = connectionCountFor(p.id, shopifyConnections, ebayConnections);
            const isLive = p.status === "live";
            const isSoon = p.status === "coming_soon";

            return (
              <Card
                key={p.id}
                className={cn(
                  "group relative flex flex-col overflow-hidden border-0 bg-card shadow-md ring-1 transition-shadow hover:shadow-lg",
                  p.ring
                )}
              >
                <div
                  className={cn(
                    "h-1.5 w-full bg-gradient-to-r opacity-90",
                    p.accent
                  )}
                />
                <CardHeader className="space-y-3 px-4 pb-3 pt-4 sm:px-6 sm:pt-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <div
                        className={cn(
                          "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-black/[0.06] sm:h-12 sm:w-12 dark:bg-slate-50 dark:ring-white/10"
                        )}
                      >
                        <PlatformBrandLogo platformId={p.id} shortName={p.shortName} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <CardTitle className="text-base leading-tight sm:text-lg">{p.name}</CardTitle>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
                            {p.categoryLabel}
                          </Badge>
                          {isLive ? (
                            <Badge className="border-0 bg-sky-600 text-[10px] hover:bg-sky-600/90">Live</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px]">
                              Roadmap
                            </Badge>
                          )}
                          {isLive && count > 0 ? (
                            <Badge className="border-0 bg-emerald-600 text-[10px] hover:bg-emerald-600/90">
                              <Link2 className="mr-1 h-3 w-3" />
                              Connected · {count}
                            </Badge>
                          ) : isLive && p.id === "shipbest" ? (
                            <Badge className="border-0 bg-emerald-600 text-[10px] hover:bg-emerald-600/90">
                              Buy Labels
                            </Badge>
                          ) : isLive ? (
                            <Badge variant="outline" className="text-[10px] text-amber-700 border-amber-200 bg-amber-50">
                              Not connected
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    {isLive && p.id === "shopify" && (
                      <Button
                        size="sm"
                        className="h-10 w-full shrink-0 touch-manipulation shadow-sm sm:h-9 sm:w-auto"
                        onClick={() => setConnectDialogOpen(true)}
                      >
                        <Plus className="h-4 w-4 sm:mr-1" />
                        {count > 0 ? "Add store" : "Connect"}
                      </Button>
                    )}
                    {isLive && p.id === "ebay" && (
                      <Button
                        size="sm"
                        className="h-10 w-full shrink-0 touch-manipulation shadow-sm sm:h-9 sm:w-auto"
                        onClick={() => handleConnectEbay(ebayConnections.length > 0)}
                        disabled={ebayConnectLoading}
                      >
                        {ebayConnectLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Plus className="h-4 w-4 sm:mr-1" />
                            {count > 0 ? "Add account" : "Connect"}
                          </>
                        )}
                      </Button>
                    )}
                    {isLive && p.id === "shipbest" && (
                      <Button
                        size="sm"
                        className="h-10 w-full shrink-0 touch-manipulation shadow-sm sm:h-9 sm:w-auto"
                        asChild
                      >
                        <Link href="/dashboard/buy-labels">
                          Buy Labels
                        </Link>
                      </Button>
                    )}
                  </div>
                  <CardDescription className="text-sm leading-relaxed">{p.description}</CardDescription>
                </CardHeader>
                <CardContent className="mt-auto flex flex-1 flex-col gap-3 px-4 pb-4 pt-0 sm:px-6 sm:pb-6">
                  {isSoon && (
                    <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-muted-foreground/20 bg-muted/20 px-4 py-8 text-center">
                      <Store className="mb-2 h-8 w-8 text-muted-foreground/40" />
                      <p className="text-sm font-medium text-muted-foreground">Coming soon</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        We&apos;ll announce when {p.name} is available for your workspace.
                      </p>
                    </div>
                  )}

                  {p.id === "shipbest" && isLive && (
                    <div className="rounded-xl border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                      Warehouse ShipBest credentials power rates and labels in{" "}
                      <Link href="/dashboard/buy-labels" className="font-medium text-foreground underline-offset-2 hover:underline">
                        Buy Labels
                      </Link>
                      . Same Stripe checkout flow as Shippo.
                    </div>
                  )}

                  {p.id === "shopify" && isLive && (
                    <>
                      <Alert className="border-sky-200 bg-sky-50/80 text-sky-950 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-50">
                        <Info className="h-4 w-4 text-sky-700 dark:text-sky-300" />
                        <AlertTitle className="text-sky-900 dark:text-sky-100">
                          Free Shopify integration · App Store review in progress
                        </AlertTitle>
                        <AlertDescription className="text-sky-800/90 dark:text-sky-200/90">
                          PrepCorex does not charge any Shopify app subscription fee. After Shopify approves our
                          listing, install from the official Shopify App Store (Add app). Until then, you can connect a
                          development or test store below using our secure OAuth route—this is for testing only, not the
                          final public install path.
                        </AlertDescription>
                      </Alert>
                      {shopifyConnections.length === 0 ? (
                        <div className="rounded-xl border border-dashed bg-muted/15 px-4 py-6 text-center text-sm text-muted-foreground">
                          No stores linked yet. Use <strong className="text-foreground">Connect</strong> to add one.
                        </div>
                      ) : (
                        <ul className="space-y-2">
                          {shopifyConnections.map((conn) => (
                            <li
                              key={conn.id}
                              className="rounded-lg border bg-background/80 p-3 shadow-sm ring-1 ring-border/50"
                            >
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0">
                                  <p className="truncate font-medium">{conn.shopName || conn.shop}</p>
                                  <p className="truncate text-xs text-muted-foreground">{conn.shop}</p>
                                  <p className="text-[11px] text-muted-foreground">Since {formatConnectedAt(conn.connectedAt)}</p>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  <Button variant="secondary" size="sm" className="h-8" asChild>
                                    <Link
                                      href={`/dashboard/integrations/shopify/products?shop=${encodeURIComponent(conn.shop)}`}
                                    >
                                      <Package className="h-3.5 w-3.5 mr-1" />
                                      {Array.isArray(conn.selectedVariants) && conn.selectedVariants.length > 0
                                        ? `${conn.selectedVariants.length} products`
                                        : "Products"}
                                    </Link>
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 text-destructive hover:text-destructive"
                                    onClick={() => openDisconnectDialog(conn)}
                                    disabled={disconnectingId === conn.id}
                                  >
                                    {disconnectingId === conn.id ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-3.5 w-3.5" />
                                    )}
                                  </Button>
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}

                  {p.id === "ebay" && isLive && (
                    <>
                      {ebayConnections.length === 0 ? (
                        <div className="rounded-xl border border-dashed bg-muted/15 px-4 py-6 text-center text-sm text-muted-foreground">
                          No seller account linked. Use <strong className="text-foreground">Connect</strong> to authorize
                          eBay.
                        </div>
                      ) : (
                        <ul className="space-y-2">
                          {ebayConnections.map((conn) => (
                            <li
                              key={conn.id}
                              className="rounded-lg border bg-background/80 p-3 shadow-sm ring-1 ring-border/50"
                            >
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0">
                                  <p className="font-medium">eBay · {conn.environment}</p>
                                  <p className="text-[11px] text-muted-foreground">Since {formatConnectedAt(conn.connectedAt)}</p>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  <Button variant="secondary" size="sm" className="h-8" asChild>
                                    <Link
                                      href={`/dashboard/integrations/ebay/listings?connectionId=${encodeURIComponent(conn.id)}`}
                                    >
                                      <ShoppingBag className="h-3.5 w-3.5 mr-1" />
                                      Listings
                                    </Link>
                                  </Button>
                                  <Button variant="secondary" size="sm" className="h-8" asChild>
                                    <Link
                                      href={`/dashboard/integrations/ebay/orders?connectionId=${encodeURIComponent(conn.id)}`}
                                    >
                                      <ShoppingCart className="h-3.5 w-3.5 mr-1" />
                                      Orders
                                    </Link>
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 text-destructive hover:text-destructive"
                                    onClick={() => handleDisconnectEbay(conn.id)}
                                    disabled={ebayDisconnectId === conn.id}
                                  >
                                    {ebayDisconnectId === conn.id ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-3.5 w-3.5" />
                                    )}
                                  </Button>
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={connectDialogOpen} onOpenChange={setConnectDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect Shopify store (testing)</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  <strong className="text-foreground">100% free</strong> — no app subscription or install charge from
                  PrepCorex.
                </p>
                <p>
                  PrepCorex is under Shopify App Store review. Entering your store name here is only for testing on a dev
                  or test store. After approval, connect via{" "}
                  <strong className="text-foreground">Shopify Admin → Apps → Add app</strong> (PrepCorex in the App Store).
                </p>
                <p>We use Shopify&apos;s secure OAuth flow; you approve permissions on Shopify&apos;s screen.</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Store name</Label>
              <Input
                placeholder="e.g. mystore or my-store"
                value={shopInput}
                onChange={(e) => setShopInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleConnectShopify()}
              />
              <p className="text-xs text-muted-foreground">
                From <span className="font-mono">mystore.myshopify.com</span> use <span className="font-mono">mystore</span>.
                Letters, numbers, and hyphens only.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConnectDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleConnectShopify}>
                <ShoppingBag className="mr-2 h-4 w-4" />
                Continue to Shopify
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={disconnectDialogOpen}
        onOpenChange={(open) => {
          setDisconnectDialogOpen(open);
          if (!open) setPendingDisconnect(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Disconnect Shopify store?</DialogTitle>
            <DialogDescription>
              This will remove the connection to {pendingDisconnect?.shopName ?? "this store"}. You can either keep the
              products that were linked to this store in your PrepCorex inventory, or remove them.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => pendingDisconnect && handleDisconnect(pendingDisconnect.id, false)}
              disabled={!pendingDisconnect || disconnectingId === pendingDisconnect.id}
            >
              {pendingDisconnect && disconnectingId === pendingDisconnect.id ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Disconnect only (keep linked products in inventory)
            </Button>
            <Button
              variant="destructive"
              onClick={() => pendingDisconnect && handleDisconnect(pendingDisconnect.id, true)}
              disabled={!pendingDisconnect || disconnectingId === pendingDisconnect.id}
            >
              Disconnect and remove linked products from inventory
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setDisconnectDialogOpen(false);
                setPendingDisconnect(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
