"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { PlatformBrandLogo } from "@/components/integrations/platform-brand-logo";
import {
  INTEGRATION_CATEGORY_OPTIONS,
  INTEGRATION_PLATFORM_CARDS,
  isLiveIntegrationPlatformId,
  type IntegrationPlatformCardDef,
} from "@/lib/integration-platform-ui";
import type { IntegrationPlatformId } from "@/lib/integration-permissions";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import {
  Loader2,
  Plug,
  Search,
  Sparkles,
  Link2,
  Trash2,
  Users,
  Store,
  ChevronRight,
} from "lucide-react";

type FilterTab = "all" | "connected" | "available" | "soon";

type PlatformStat = {
  id: IntegrationPlatformId;
  connectionCount: number;
  userCount: number;
};

type AdminConnectionRow = {
  platform: IntegrationPlatformId;
  connectionId: string;
  uid: string;
  userEmail: string;
  userDisplayName: string;
  clientId: string;
  label: string;
  sublabel: string;
  connectedAt: { seconds: number } | string | null;
};

type OverviewUser = {
  uid: string;
  email: string;
  displayName: string;
  clientId: string;
  counts: Record<IntegrationPlatformId, number>;
  totalConnections: number;
};

type PendingDisconnect = {
  platform: IntegrationPlatformId;
  platformName: string;
  connectionId: string;
  targetUid: string;
  label: string;
  userDisplayName: string;
  supportsRemoveInventory: boolean;
};

function formatConnectedAt(raw: AdminConnectionRow["connectedAt"]) {
  if (!raw) return "—";
  if (typeof raw === "string") return format(new Date(raw), "PP");
  if (typeof raw === "object" && "seconds" in raw && raw.seconds) {
    return format(new Date(raw.seconds * 1000), "PP");
  }
  return "—";
}

function platformStatFor(stats: PlatformStat[], id: string): PlatformStat | undefined {
  return stats.find((s) => s.id === id);
}

export function AdminIntegrationsDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [platformStats, setPlatformStats] = useState<PlatformStat[]>([]);
  const [connections, setConnections] = useState<AdminConnectionRow[]>([]);
  const [overviewUsers, setOverviewUsers] = useState<OverviewUser[]>([]);
  const [totalConnections, setTotalConnections] = useState(0);
  const [totalUsersWithIntegrations, setTotalUsersWithIntegrations] = useState(0);
  const [livePlatformsWithConnections, setLivePlatformsWithConnections] = useState(0);

  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [categoryFilter, setCategoryFilter] = useState<
    "all" | IntegrationPlatformCardDef["category"]
  >("all");
  const [search, setSearch] = useState("");

  const [usersDialogOpen, setUsersDialogOpen] = useState(false);
  const [managePlatform, setManagePlatform] = useState<IntegrationPlatformCardDef | null>(null);
  const [pendingDisconnect, setPendingDisconnect] = useState<PendingDisconnect | null>(null);
  const [removeInventory, setRemoveInventory] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const fetchOverview = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/admin/integrations/overview", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load overview");
      setPlatformStats(data.platforms ?? []);
      setConnections(data.connections ?? []);
      setOverviewUsers(data.users ?? []);
      setTotalConnections(data.totalConnections ?? 0);
      setTotalUsersWithIntegrations(data.totalUsersWithIntegrations ?? 0);
      setLivePlatformsWithConnections(data.livePlatformsWithConnections ?? 0);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not load integrations",
        description: e instanceof Error ? e.message : "",
      });
      setPlatformStats([]);
      setConnections([]);
      setOverviewUsers([]);
      setTotalConnections(0);
      setTotalUsersWithIntegrations(0);
      setLivePlatformsWithConnections(0);
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  const connectionsByPlatform = useMemo(() => {
    const map = new Map<IntegrationPlatformId, AdminConnectionRow[]>();
    for (const row of connections) {
      const list = map.get(row.platform) ?? [];
      list.push(row);
      map.set(row.platform, list);
    }
    return map;
  }, [connections]);

  const visiblePlatforms = useMemo(() => {
    const q = search.trim().toLowerCase();
    return INTEGRATION_PLATFORM_CARDS.filter((p) => {
      if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
      if (q && !`${p.name} ${p.description} ${p.categoryLabel}`.toLowerCase().includes(q)) {
        return false;
      }
      const stat = isLiveIntegrationPlatformId(p.id)
        ? platformStatFor(platformStats, p.id)
        : undefined;
      const count = stat?.connectionCount ?? 0;
      if (filterTab === "connected") return p.status === "live" && count > 0;
      if (filterTab === "available") return p.status === "live" && count === 0;
      if (filterTab === "soon") return p.status === "coming_soon";
      return true;
    });
  }, [search, categoryFilter, filterTab, platformStats]);

  const manageConnections = useMemo(() => {
    if (!managePlatform || !isLiveIntegrationPlatformId(managePlatform.id)) return [];
    return connectionsByPlatform.get(managePlatform.id) ?? [];
  }, [managePlatform, connectionsByPlatform]);

  const runDisconnect = async () => {
    if (!user || !pendingDisconnect) return;
    setDisconnecting(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/admin/integrations/disconnect", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: pendingDisconnect.platform,
          targetUid: pendingDisconnect.targetUid,
          connectionId: pendingDisconnect.connectionId,
          removeInventory: pendingDisconnect.supportsRemoveInventory ? removeInventory : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Disconnect failed");
      toast({
        title: "Disconnected",
        description:
          data.removedInventoryCount > 0
            ? `Removed ${data.removedInventoryCount} linked inventory item(s).`
            : data.removedOrders > 0
              ? `Removed connection and ${data.removedOrders} synced order(s).`
              : `${pendingDisconnect.platformName} connection removed for ${pendingDisconnect.userDisplayName}.`,
      });
      setPendingDisconnect(null);
      setRemoveInventory(false);
      await fetchOverview();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Disconnect failed",
        description: e instanceof Error ? e.message : "",
      });
    } finally {
      setDisconnecting(false);
    }
  };

  const openDisconnect = (row: AdminConnectionRow, platformDef: IntegrationPlatformCardDef) => {
    const supportsRemoveInventory =
      row.platform === "shopify" ||
      row.platform === "ebay" ||
      row.platform === "tiktok" ||
      row.platform === "etsy";
    setRemoveInventory(row.platform === "tiktok" || row.platform === "etsy");
    setPendingDisconnect({
      platform: row.platform,
      platformName: platformDef.name,
      connectionId: row.connectionId,
      targetUid: row.uid,
      label: row.label,
      userDisplayName: row.userDisplayName,
      supportsRemoveInventory,
    });
  };

  return (
    <div className="mx-auto min-w-0 w-full max-w-[1440px] space-y-3 pb-2 sm:space-y-6 sm:pb-4">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-xl border border-border/60 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-3 py-4 text-white shadow-xl sm:rounded-2xl sm:px-8 sm:py-8 md:px-10 md:py-10">
        <div
          className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-emerald-500/20 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-24 -left-16 h-56 w-56 rounded-full bg-violet-500/15 blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between md:gap-8">
          <div className="min-w-0 max-w-2xl space-y-2 sm:space-y-3 md:flex-1">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[10px] font-medium text-emerald-200/90 backdrop-blur-sm sm:gap-2 sm:px-3 sm:py-1 sm:text-xs">
              <Sparkles className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" />
              Admin integrations
            </div>
            <h1 className="text-xl font-bold tracking-tight sm:text-3xl md:text-4xl lg:text-[2.5rem] lg:leading-tight">
              Integrations hub
            </h1>
            <p className="text-xs leading-relaxed text-slate-300 sm:text-base md:max-w-xl lg:max-w-2xl">
              Monitor every connected marketplace, storefront, and shipping tool across all clients.
              View account counts per platform and disconnect stores on a client&apos;s behalf when needed.
            </p>
          </div>
          <div className="grid w-full grid-cols-3 gap-2 sm:gap-3 md:w-auto md:min-w-[min(100%,20rem)] md:max-w-md md:shrink-0 lg:min-w-[22rem] lg:max-w-none">
            <div className="rounded-xl border border-white/10 bg-white/5 px-2 py-2.5 backdrop-blur-sm sm:px-4 sm:py-3">
              <p className="text-[10px] font-semibold uppercase leading-tight tracking-wider text-slate-400 sm:text-[11px]">
                Active links
              </p>
              <p className="text-xl font-bold tabular-nums sm:text-2xl">
                {loading ? "—" : totalConnections}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 px-2 py-2.5 backdrop-blur-sm sm:px-4 sm:py-3">
              <p className="text-[10px] font-semibold uppercase leading-tight tracking-wider text-slate-400 sm:text-[11px]">
                <span className="sm:hidden">Live use</span>
                <span className="hidden sm:inline">Live platforms</span>
              </p>
              <p className="text-xl font-bold tabular-nums sm:text-2xl">
                {loading ? "—" : livePlatformsWithConnections}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setUsersDialogOpen(true)}
              disabled={loading || totalUsersWithIntegrations === 0}
              className="rounded-xl border border-white/10 bg-white/5 px-2 py-2.5 text-left backdrop-blur-sm transition hover:bg-white/10 disabled:opacity-60 sm:px-4 sm:py-3"
            >
              <p className="text-[10px] font-semibold uppercase leading-tight tracking-wider text-slate-400 sm:text-[11px]">
                <span className="sm:hidden">Clients</span>
                <span className="hidden sm:inline">Connected clients</span>
              </p>
              <p className="text-xl font-bold tabular-nums sm:text-2xl">
                {loading ? "—" : totalUsersWithIntegrations}
              </p>
            </button>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <Card className="min-w-0 border-border/80 shadow-sm">
        <CardContent className="flex flex-col gap-3 p-3 sm:gap-4 sm:p-6">
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search platforms…"
              className="h-9 pl-10 text-sm sm:h-10"
            />
          </div>
          <div className="flex min-w-0 flex-col gap-3 sm:gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
            <Tabs
              value={filterTab}
              onValueChange={(v) => setFilterTab(v as FilterTab)}
              className="w-full min-w-0 md:max-w-[min(100%,36rem)]"
            >
              <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1 sm:inline-flex sm:w-full sm:flex-wrap sm:justify-start md:w-auto md:flex-nowrap">
                <TabsTrigger value="all" className="min-h-9 flex-1 px-2 py-1.5 text-xs sm:min-h-9 sm:flex-none sm:px-3 sm:text-sm">
                  All
                </TabsTrigger>
                <TabsTrigger value="connected" className="min-h-9 flex-1 px-2 py-1.5 text-xs sm:min-h-9 sm:flex-none sm:px-3 sm:text-sm">
                  <span className="sm:hidden">Linked</span>
                  <span className="hidden sm:inline">Connected</span>
                </TabsTrigger>
                <TabsTrigger value="available" className="min-h-9 flex-1 px-2 py-1.5 text-xs sm:min-h-9 sm:flex-none sm:px-3 sm:text-sm">
                  <span className="sm:hidden">Empty</span>
                  <span className="hidden sm:inline">No connections</span>
                </TabsTrigger>
                <TabsTrigger value="soon" className="min-h-9 flex-1 px-2 py-1.5 text-xs sm:min-h-9 sm:flex-none sm:px-3 sm:text-sm">
                  <span className="sm:hidden">Soon</span>
                  <span className="hidden sm:inline">Coming soon</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex min-w-0 flex-wrap gap-1.5 sm:gap-2 md:max-w-[min(100%,28rem)] md:justify-end lg:max-w-none">
              {INTEGRATION_CATEGORY_OPTIONS.map((c) => (
                <Button
                  key={c.id}
                  type="button"
                  size="sm"
                  variant={categoryFilter === c.id ? "default" : "outline"}
                  className={cn(
                    "h-8 shrink-0 rounded-full px-2.5 text-[11px] touch-manipulation sm:min-h-9 sm:px-3 sm:text-xs",
                    categoryFilter === c.id && "shadow-md"
                  )}
                  onClick={() => setCategoryFilter(c.id)}
                >
                  {c.id === "all" ? (
                    <>
                      <span className="sm:hidden">All</span>
                      <span className="hidden sm:inline">{c.label}</span>
                    </>
                  ) : c.id === "marketplace" ? (
                    <>
                      <span className="sm:hidden">Mkt</span>
                      <span className="hidden sm:inline">{c.label}</span>
                    </>
                  ) : c.id === "ecommerce" ? (
                    <>
                      <span className="sm:hidden">E‑com</span>
                      <span className="hidden sm:inline">{c.label}</span>
                    </>
                  ) : c.id === "social" ? (
                    <>
                      <span className="sm:hidden">Social</span>
                      <span className="hidden sm:inline">{c.label}</span>
                    </>
                  ) : (
                    <>
                      <span className="sm:hidden">Ship</span>
                      <span className="hidden sm:inline">{c.label}</span>
                    </>
                  )}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-xl sm:h-64 sm:rounded-2xl" />
          ))}
        </div>
      ) : visiblePlatforms.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-2 py-10 text-center sm:py-16">
            <Plug className="h-10 w-10 text-muted-foreground/50" />
            <p className="font-medium">No platforms match your filters</p>
            <p className="text-sm text-muted-foreground">Try &quot;All&quot; or clear search.</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 w-full max-w-xs sm:w-auto"
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 lg:gap-6">
          {visiblePlatforms.map((p) => {
            const stat = isLiveIntegrationPlatformId(p.id)
              ? platformStatFor(platformStats, p.id)
              : undefined;
            const count = stat?.connectionCount ?? 0;
            const userCount = stat?.userCount ?? 0;
            const isLive = p.status === "live";
            const isSoon = p.status === "coming_soon";
            const platformConnections = isLiveIntegrationPlatformId(p.id)
              ? (connectionsByPlatform.get(p.id) ?? [])
              : [];
            const preview = platformConnections.slice(0, 3);

            return (
              <Card
                key={p.id}
                className={cn(
                  "group relative flex flex-col overflow-hidden border-0 bg-card shadow-md ring-1 transition-shadow hover:shadow-lg",
                  p.ring
                )}
              >
                <div className={cn("h-1.5 w-full bg-gradient-to-r opacity-90", p.accent)} />
                <CardHeader className="space-y-2 px-3 pb-2 pt-3 sm:space-y-3 sm:px-6 sm:pb-3 sm:pt-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-black/[0.06] sm:h-12 sm:w-12 dark:bg-slate-50 dark:ring-white/10">
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
                            <>
                              <Badge className="border-0 bg-emerald-600 text-[10px] hover:bg-emerald-600/90">
                                <Link2 className="mr-1 h-3 w-3" />
                                {count} {count === 1 ? "account" : "accounts"}
                              </Badge>
                              <Badge variant="outline" className="text-[10px]">
                                <Users className="mr-1 h-3 w-3" />
                                {userCount} {userCount === 1 ? "client" : "clients"}
                              </Badge>
                            </>
                          ) : isLive ? (
                            <Badge
                              variant="outline"
                              className="border-amber-200 bg-amber-50 text-[10px] text-amber-700"
                            >
                              No connections
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    {isLive && count > 0 ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-10 w-full shrink-0 touch-manipulation sm:h-9 sm:w-auto"
                        onClick={() => setManagePlatform(p)}
                      >
                        Manage
                        <ChevronRight className="ml-1 h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                  <CardDescription className="text-sm leading-relaxed">{p.description}</CardDescription>
                </CardHeader>
                <CardContent className="mt-auto flex flex-1 flex-col gap-2 px-3 pb-3 pt-0 sm:gap-3 sm:px-6 sm:pb-6">
                  {isSoon && (
                    <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-muted-foreground/20 bg-muted/20 px-4 py-8 text-center">
                      <Store className="mb-2 h-8 w-8 text-muted-foreground/40" />
                      <p className="text-sm font-medium text-muted-foreground">Coming soon</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Not available for client connections yet.
                      </p>
                    </div>
                  )}

                  {isLive && count === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No client has connected {p.name} yet.
                    </p>
                  )}

                  {isLive && preview.length > 0 && (
                    <div className="space-y-2">
                      {preview.map((row) => (
                        <div
                          key={row.connectionId}
                          className="flex flex-col gap-2 rounded-lg border px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{row.label}</p>
                            <p className="truncate text-[11px] text-muted-foreground">
                              {row.userDisplayName}
                              {row.clientId ? ` · ${row.clientId}` : ""}
                            </p>
                            {row.sublabel ? (
                              <p className="truncate text-[11px] text-muted-foreground">{row.sublabel}</p>
                            ) : null}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-9 w-full shrink-0 text-destructive sm:h-8 sm:w-auto"
                            disabled={disconnecting}
                            onClick={() => openDisconnect(row, p)}
                          >
                            <Trash2 className="mr-1.5 h-3.5 w-3.5 sm:mr-0" />
                            <span className="sm:hidden">Disconnect</span>
                          </Button>
                        </div>
                      ))}
                      {platformConnections.length > 3 ? (
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          className="h-auto px-0 text-xs"
                          onClick={() => setManagePlatform(p)}
                        >
                          View all {platformConnections.length} accounts
                        </Button>
                      ) : null}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Connected clients dialog */}
      <Dialog open={usersDialogOpen} onOpenChange={setUsersDialogOpen}>
        <DialogContent className="flex max-h-[100dvh] w-[calc(100%-1.5rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-h-[85vh]">
          <DialogHeader className="shrink-0 border-b p-4 text-left sm:p-6">
            <DialogTitle className="text-base sm:text-lg">Clients with integrations</DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              All users who have at least one connected platform.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            <div className="space-y-3 sm:hidden">
              {overviewUsers.map((u) => (
                <div key={u.uid} className="rounded-lg border bg-card p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{u.displayName}</p>
                      <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                      {u.clientId ? (
                        <Badge variant="secondary" className="mt-1 text-[10px]">
                          {u.clientId}
                        </Badge>
                      ) : null}
                    </div>
                    <Badge variant="outline" className="shrink-0 tabular-nums">
                      {u.totalConnections} total
                    </Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-1.5 text-center text-[10px]">
                    {(
                      [
                        ["Shopify", u.counts.shopify],
                        ["eBay", u.counts.ebay],
                        ["Amazon", u.counts.amazon],
                        ["TikTok", u.counts.tiktok],
                        ["Etsy", u.counts.etsy],
                        ["Woo", u.counts.woocommerce],
                        ["ShipSt.", u.counts.shipstation],
                        ["Veeqo", u.counts.veeqo],
                      ] as const
                    ).map(([label, count]) => (
                      <div
                        key={label}
                        className="rounded-md border bg-muted/30 px-1 py-1.5 leading-tight"
                      >
                        <p className="font-medium text-muted-foreground">{label}</p>
                        <p className="tabular-nums">{count || "—"}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden min-w-0 overflow-x-auto sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead className="text-center">Total</TableHead>
                    <TableHead className="text-center">Shopify</TableHead>
                    <TableHead className="text-center">eBay</TableHead>
                    <TableHead className="hidden text-center md:table-cell">Amazon</TableHead>
                    <TableHead className="hidden text-center md:table-cell">TikTok</TableHead>
                    <TableHead className="hidden text-center md:table-cell">Etsy</TableHead>
                    <TableHead className="hidden text-center lg:table-cell">Woo</TableHead>
                    <TableHead className="hidden text-center lg:table-cell">ShipStation</TableHead>
                    <TableHead className="hidden text-center xl:table-cell">Veeqo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overviewUsers.map((u) => (
                    <TableRow key={u.uid}>
                      <TableCell>
                        <div className="font-medium">{u.displayName}</div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                        {u.clientId ? (
                          <Badge variant="secondary" className="mt-1 text-[10px]">
                            {u.clientId}
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-center font-semibold">{u.totalConnections}</TableCell>
                      <TableCell className="text-center">{u.counts.shopify || "—"}</TableCell>
                      <TableCell className="text-center">{u.counts.ebay || "—"}</TableCell>
                      <TableCell className="hidden text-center md:table-cell">
                        {u.counts.amazon || "—"}
                      </TableCell>
                      <TableCell className="hidden text-center md:table-cell">
                        {u.counts.tiktok || "—"}
                      </TableCell>
                      <TableCell className="hidden text-center md:table-cell">
                        {u.counts.etsy || "—"}
                      </TableCell>
                      <TableCell className="hidden text-center lg:table-cell">
                        {u.counts.woocommerce || "—"}
                      </TableCell>
                      <TableCell className="hidden text-center lg:table-cell">
                        {u.counts.shipstation || "—"}
                      </TableCell>
                      <TableCell className="hidden text-center xl:table-cell">
                        {u.counts.veeqo || "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manage platform dialog */}
      <Dialog open={!!managePlatform} onOpenChange={(o) => !o && setManagePlatform(null)}>
        <DialogContent className="flex max-h-[100dvh] w-[calc(100%-1.5rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-h-[85vh]">
          <DialogHeader className="shrink-0 border-b p-4 text-left sm:p-6">
            <DialogTitle className="text-base sm:text-lg">{managePlatform?.name} connections</DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              All client accounts linked to {managePlatform?.name}. Disconnect removes access for that
              client.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            {manageConnections.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No connections.</p>
            ) : (
              <div className="space-y-2">
                {manageConnections.map((row) => (
                  <div
                    key={row.connectionId}
                    className="flex flex-col gap-2 rounded-lg border px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{row.label}</p>
                      {row.sublabel ? (
                        <p className="truncate text-xs text-muted-foreground">{row.sublabel}</p>
                      ) : null}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {row.userDisplayName}
                        {row.clientId ? ` · ${row.clientId}` : ""}
                        {row.userEmail ? ` · ${row.userEmail}` : ""}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Since {formatConnectedAt(row.connectedAt)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 w-full shrink-0 text-destructive hover:bg-destructive/10 sm:h-8 sm:w-auto"
                      disabled={disconnecting}
                      onClick={() => managePlatform && openDisconnect(row, managePlatform)}
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      Disconnect
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Disconnect confirm */}
      <Dialog
        open={!!pendingDisconnect}
        onOpenChange={(o) => {
          if (!o) {
            setPendingDisconnect(null);
            setRemoveInventory(false);
          }
        }}
      >
        <DialogContent className="w-[calc(100%-1.5rem)] max-w-lg p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">
              Disconnect {pendingDisconnect?.platformName}
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              Remove <strong>{pendingDisconnect?.label}</strong> for{" "}
              <strong>{pendingDisconnect?.userDisplayName}</strong>. The client will need to reconnect to
              sync orders again.
            </DialogDescription>
          </DialogHeader>
          {pendingDisconnect?.supportsRemoveInventory ? (
            <div className="flex items-start gap-2 py-2">
              <Checkbox
                id="admin-rm-inv"
                checked={removeInventory}
                onCheckedChange={(c) => setRemoveInventory(c === true)}
              />
              <Label htmlFor="admin-rm-inv" className="text-xs font-normal leading-snug sm:text-sm">
                Also remove PrepCorex inventory items imported from this connection (same as client
                disconnect).
              </Label>
            </div>
          ) : null}
          <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setPendingDisconnect(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="w-full sm:w-auto"
              disabled={disconnecting}
              onClick={() => void runDisconnect()}
            >
              {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Disconnect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
