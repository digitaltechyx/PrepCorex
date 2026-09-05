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
      row.platform === "shopify" || row.platform === "ebay" || row.platform === "tiktok";
    setRemoveInventory(row.platform === "tiktok");
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
              Admin integrations
            </div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl md:text-4xl lg:text-[2.5rem] lg:leading-tight">
              Integrations hub
            </h1>
            <p className="text-sm leading-relaxed text-slate-300 sm:text-base md:max-w-xl lg:max-w-2xl">
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
            <Tabs
              value={filterTab}
              onValueChange={(v) => setFilterTab(v as FilterTab)}
              className="w-full min-w-0 md:max-w-[min(100%,36rem)]"
            >
              <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1 sm:inline-flex sm:w-full sm:flex-wrap sm:justify-start md:w-auto md:flex-nowrap">
                <TabsTrigger value="all" className="min-h-10 flex-1 px-2 text-xs sm:min-h-9 sm:flex-none sm:px-3 sm:text-sm">
                  All
                </TabsTrigger>
                <TabsTrigger value="connected" className="min-h-10 flex-1 px-2 text-xs sm:min-h-9 sm:flex-none sm:px-3 sm:text-sm">
                  Connected
                </TabsTrigger>
                <TabsTrigger value="available" className="min-h-10 flex-1 px-2 text-xs sm:min-h-9 sm:flex-none sm:px-3 sm:text-sm">
                  <span className="sm:hidden">Empty</span>
                  <span className="hidden sm:inline">No connections</span>
                </TabsTrigger>
                <TabsTrigger value="soon" className="min-h-10 flex-1 px-2 text-xs sm:min-h-9 sm:flex-none sm:px-3 sm:text-sm">
                  Coming soon
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex min-w-0 flex-wrap gap-2 md:max-w-[min(100%,28rem)] md:justify-end lg:max-w-none">
              {INTEGRATION_CATEGORY_OPTIONS.map((c) => (
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-2xl" />
          ))}
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
                <CardHeader className="space-y-3 px-4 pb-3 pt-4 sm:px-6 sm:pt-6">
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
                <CardContent className="mt-auto flex flex-1 flex-col gap-3 px-4 pb-4 pt-0 sm:px-6 sm:pb-6">
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
                            className="h-8 shrink-0 text-destructive"
                            disabled={disconnecting}
                            onClick={() => openDisconnect(row, p)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
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
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Clients with integrations</DialogTitle>
            <DialogDescription>
              All users who have at least one connected platform.
            </DialogDescription>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead className="text-center">Total</TableHead>
                <TableHead className="hidden text-center sm:table-cell">Shopify</TableHead>
                <TableHead className="hidden text-center sm:table-cell">eBay</TableHead>
                <TableHead className="hidden text-center md:table-cell">Amazon</TableHead>
                <TableHead className="hidden text-center md:table-cell">TikTok</TableHead>
                <TableHead className="hidden text-center lg:table-cell">Woo</TableHead>
                <TableHead className="hidden text-center lg:table-cell">ShipStation</TableHead>
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
                  <TableCell className="hidden text-center sm:table-cell">{u.counts.shopify || "—"}</TableCell>
                  <TableCell className="hidden text-center sm:table-cell">{u.counts.ebay || "—"}</TableCell>
                  <TableCell className="hidden text-center md:table-cell">{u.counts.amazon || "—"}</TableCell>
                  <TableCell className="hidden text-center md:table-cell">{u.counts.tiktok || "—"}</TableCell>
                  <TableCell className="hidden text-center lg:table-cell">
                    {u.counts.woocommerce || "—"}
                  </TableCell>
                  <TableCell className="hidden text-center lg:table-cell">
                    {u.counts.shipstation || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>

      {/* Manage platform dialog */}
      <Dialog open={!!managePlatform} onOpenChange={(o) => !o && setManagePlatform(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{managePlatform?.name} connections</DialogTitle>
            <DialogDescription>
              All client accounts linked to {managePlatform?.name}. Disconnect removes access for that client.
            </DialogDescription>
          </DialogHeader>
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
                    className="shrink-0 text-destructive hover:bg-destructive/10"
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect {pendingDisconnect?.platformName}</DialogTitle>
            <DialogDescription>
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
              <Label htmlFor="admin-rm-inv" className="text-sm font-normal leading-snug">
                Also remove PrepCorex inventory items imported from this connection (same as client
                disconnect).
              </Label>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingDisconnect(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
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
