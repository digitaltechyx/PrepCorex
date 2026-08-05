"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useManagedUsers } from "@/hooks/use-managed-users";
import { hasRole } from "@/lib/permissions";
import { formatUserDisplayName } from "@/lib/format-user-display";
import type { AdminShopifyOrder } from "@/lib/shopify-admin-orders";
import type { UserProfile } from "@/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ShopifyOrderDetailBody } from "@/components/integrations/shopify-order-detail";
import { ShopifyCreateLabelDialog } from "@/components/admin/shopify-create-label-dialog";
import { ShopifyLabelSourceDialog } from "@/components/admin/shopify-label-source-dialog";
import { ShopifyQuickFulfillDialog } from "@/components/admin/shopify-quick-fulfill-dialog";
import {
  saveBuyLabelPrefillFromShopifyOrder,
  clearShopifyLabelFulfillHandoff,
  loadShopifyLabelFulfillHandoff,
  type ShopifyLabelFulfillHandoff,
} from "@/lib/shopify-order-buy-label-prefill";
import {
  ChevronsUpDown,
  Eye,
  Loader2,
  Package,
  RefreshCw,
  Search,
  ShoppingBag,
  Tag,
  Truck,
  Users,
  X,
} from "lucide-react";

type FulfillmentFilter = "all" | "unfulfilled" | "fulfilled" | "partial";

function formatWhen(raw?: string | null) {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return format(d, "PPp");
}

function formatMoney(amount?: string | null, currency?: string | null) {
  if (!amount) return "—";
  return currency ? `${currency} ${amount}` : amount;
}

function startOfDay(isoDate: string): Date | null {
  if (!isoDate) return null;
  const d = new Date(`${isoDate}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function endOfDay(isoDate: string): Date | null {
  if (!isoDate) return null;
  const d = new Date(`${isoDate}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isUnfulfilled(status: string | null | undefined) {
  return !status || status === "unfulfilled" || status === "null";
}

export function ShopifyOrdersPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlUserId = searchParams.get("userId")?.trim() || "";
  const userFilter = urlUserId && urlUserId !== "all" ? urlUserId : "all";

  const { user } = useAuth();
  const { toast } = useToast();
  const { managedUsers: users, loading: usersLoading } = useManagedUsers();

  const [orders, setOrders] = useState<AdminShopifyOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const [search, setSearch] = useState("");
  const [fulfillmentFilter, setFulfillmentFilter] = useState<FulfillmentFilter>("all");
  const [financialFilter, setFinancialFilter] = useState("all");
  const [shopFilter, setShopFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [detailsOrder, setDetailsOrder] = useState<AdminShopifyOrder | null>(null);

  const [fulfillDialogOpen, setFulfillDialogOpen] = useState(false);
  const [fulfillOrder, setFulfillOrder] = useState<AdminShopifyOrder | null>(null);
  const [labelFulfillHandoff, setLabelFulfillHandoff] =
    useState<ShopifyLabelFulfillHandoff | null>(null);

  const [labelSourceDialogOpen, setLabelSourceDialogOpen] = useState(false);
  const [shopifyLabelDialogOpen, setShopifyLabelDialogOpen] = useState(false);
  const [labelOrder, setLabelOrder] = useState<AdminShopifyOrder | null>(null);

  const selectableUsers = useMemo(
    () =>
      users
        .filter((u) => hasRole(u, "user") || hasRole(u, "commission_agent"))
        .filter((u) => u.status === "approved" || !u.status)
        .filter((u) => u.status !== "deleted")
        .sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [users]
  );

  const selectedUser = useMemo(() => {
    if (userFilter === "all") return null;
    return selectableUsers.find((u) => u.uid === userFilter) || null;
  }, [userFilter, selectableUsers]);

  const filteredClients = useMemo(() => {
    const q = userSearchQuery.trim().toLowerCase();
    if (!q) return selectableUsers;
    return selectableUsers.filter((u) => {
      const name = formatUserDisplayName(u).toLowerCase();
      const email = String(u.email || "").toLowerCase();
      const clientId = String(u.clientId || "").toLowerCase();
      return name.includes(q) || email.includes(q) || clientId.includes(q);
    });
  }, [selectableUsers, userSearchQuery]);

  const handleUserSelect = (profile: UserProfile | null) => {
    if (!profile) {
      router.push("/admin/dashboard/shopify-orders?userId=all");
    } else {
      router.push(`/admin/dashboard/shopify-orders?userId=${encodeURIComponent(profile.uid)}`);
    }
    setUserDialogOpen(false);
    setUserSearchQuery("");
    setShopFilter("all");
  };

  const fetchOrders = useCallback(
    async (source: "cache" | "live" = "cache") => {
      if (!user) return;
      setLoading(true);
      try {
        const token = await user.getIdToken();
        const params = new URLSearchParams({
          userId: userFilter,
          source,
        });
        const res = await fetch(`/api/admin/shopify/orders?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            [data.error, ...(Array.isArray(data.errors) ? data.errors.slice(0, 2) : [])]
              .filter(Boolean)
              .join(" — ") || "Failed to load orders"
          );
        }
        setOrders(Array.isArray(data.orders) ? data.orders : []);
        if (source === "live" && Array.isArray(data.errors) && data.errors.length) {
          toast({
            variant: "destructive",
            title: "Some stores could not sync",
            description: data.errors.slice(0, 2).join("; "),
          });
        }
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Error",
          description: e instanceof Error ? e.message : "Failed to load Shopify orders.",
        });
        setOrders([]);
      } finally {
        setLoading(false);
      }
    },
    [user, userFilter, toast]
  );

  useEffect(() => {
    void fetchOrders("cache");
  }, [fetchOrders]);

  // Return from PrepCorex Buy Labels → open Quick Fulfill with tracking/product/label price.
  useEffect(() => {
    const orderId = searchParams.get("quickFulfillOrderId")?.trim() || "";
    if (!orderId || loading || orders.length === 0) return;

    const handoff = loadShopifyLabelFulfillHandoff();
    const match =
      orders.find(
        (o) =>
          o.id === orderId &&
          (!handoff?.ownerUserId || o.ownerUserId === handoff.ownerUserId) &&
          (!urlUserId || urlUserId === "all" || o.ownerUserId === urlUserId)
      ) || orders.find((o) => o.id === orderId);

    if (!match) return;

    setLabelFulfillHandoff(
      handoff && handoff.orderId === orderId
        ? handoff
        : {
            ownerUserId: match.ownerUserId,
            orderId: match.id,
            orderName: match.name || `#${match.orderNumber}`,
            shop: match.shop,
          }
    );
    setFulfillOrder(match);
    setFulfillDialogOpen(true);
    clearShopifyLabelFulfillHandoff();

    const params = new URLSearchParams(searchParams.toString());
    params.delete("quickFulfillOrderId");
    const next = params.toString();
    router.replace(
      next ? `/admin/dashboard/shopify-orders?${next}` : "/admin/dashboard/shopify-orders",
      { scroll: false }
    );
  }, [orders, loading, searchParams, urlUserId, router]);

  const syncFromShopify = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!user) return;
      const silent = options?.silent === true;
      setSyncing(true);
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/admin/shopify/orders", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ userId: userFilter }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Sync failed");
        setOrders(Array.isArray(data.orders) ? data.orders : []);
        try {
          sessionStorage.setItem(
            `prepcorex:admin-shopify-orders-sync:${userFilter}`,
            String(Date.now())
          );
        } catch {
          /* ignore */
        }
        if (!silent) {
          toast({
            title: "Shopify synced",
            description: `${data.orders?.length ?? 0} orders from ${data.syncedUsers ?? 0} client(s)`,
          });
        }
        if (Array.isArray(data.errors) && data.errors.length) {
          toast({
            variant: "destructive",
            title: "Some clients had errors",
            description: data.errors.slice(0, 2).join("; "),
          });
        }
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Sync failed",
          description: e instanceof Error ? e.message : "Could not sync Shopify orders.",
        });
      } finally {
        setSyncing(false);
      }
    },
    [user, userFilter, toast]
  );

  // Auto-sync from Shopify when the admin page opens / client filter changes.
  // Throttle ~90s so revisiting the page quickly does not hammer every store.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const run = async () => {
      let shouldSync = true;
      try {
        const raw = sessionStorage.getItem(
          `prepcorex:admin-shopify-orders-sync:${userFilter}`
        );
        if (raw) {
          const ageMs = Date.now() - Number(raw);
          if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 90_000) {
            shouldSync = false;
          }
        }
      } catch {
        shouldSync = true;
      }
      if (!shouldSync || cancelled) return;
      await syncFromShopify({ silent: true });
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [user, userFilter, syncFromShopify]);

  const handleSync = async () => {
    await syncFromShopify({ silent: false });
  };

  const shopOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) {
      if (o.shop) set.add(o.shop);
    }
    return Array.from(set).sort();
  }, [orders]);

  const financialOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) {
      if (o.financialStatus) set.add(o.financialStatus);
    }
    return Array.from(set).sort();
  }, [orders]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const from = startOfDay(dateFrom);
    const to = endOfDay(dateTo);

    return orders.filter((o) => {
      if (shopFilter !== "all" && o.shop !== shopFilter) return false;
      if (financialFilter !== "all" && (o.financialStatus || "") !== financialFilter) return false;

      const fs = o.fulfillmentStatus || "unfulfilled";
      if (fulfillmentFilter === "unfulfilled" && !isUnfulfilled(fs)) return false;
      if (fulfillmentFilter === "fulfilled" && fs !== "fulfilled") return false;
      if (fulfillmentFilter === "partial" && fs !== "partial") return false;

      if (from || to) {
        const raw = o.createdAt;
        if (!raw) return false;
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
      }

      if (!q) return true;
      const hay = [
        o.name,
        o.orderNumber,
        o.id,
        o.email,
        o.customerName,
        o.ownerName,
        o.ownerClientId,
        o.ownerEmail,
        o.shopName,
        o.shop,
        o.note,
        o.tags,
        ...o.trackingNumbers,
        ...o.lineItems.flatMap((li) => [li.title, li.sku, li.variantTitle]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [orders, search, fulfillmentFilter, financialFilter, shopFilter, dateFrom, dateTo]);

  const unfulfilledCount = orders.filter((o) => isUnfulfilled(o.fulfillmentStatus)).length;
  const fulfilledCount = orders.filter((o) => o.fulfillmentStatus === "fulfilled").length;

  const hasActiveFilters =
    search.trim() !== "" ||
    fulfillmentFilter !== "all" ||
    financialFilter !== "all" ||
    shopFilter !== "all" ||
    dateFrom !== "" ||
    dateTo !== "" ||
    userFilter !== "all";

  const clearFilters = () => {
    setSearch("");
    setFulfillmentFilter("all");
    setFinancialFilter("all");
    setShopFilter("all");
    setDateFrom("");
    setDateTo("");
    if (userFilter !== "all") router.push("/admin/dashboard/shopify-orders?userId=all");
  };

  const openFulfillDialog = (order: AdminShopifyOrder) => {
    setLabelFulfillHandoff(null);
    setFulfillOrder(order);
    setFulfillDialogOpen(true);
  };

  const openLabelFlow = (order: AdminShopifyOrder) => {
    setLabelOrder(order);
    setLabelSourceDialogOpen(true);
  };

  const handleChooseShopifyLabel = () => {
    setLabelSourceDialogOpen(false);
    setShopifyLabelDialogOpen(true);
  };

  const handleChoosePrepCorexLabel = () => {
    if (!labelOrder) return;
    const saved = saveBuyLabelPrefillFromShopifyOrder(labelOrder);
    setLabelSourceDialogOpen(false);
    if (!saved) {
      toast({
        variant: "destructive",
        title: "Could not open Buy Labels",
        description: "Missing Shopify order or client reference. Try syncing orders and open Label again.",
      });
      return;
    }
    const hasShipTo =
      Boolean(labelOrder.shippingAddress?.address1?.trim()) ||
      Boolean(labelOrder.billingAddress?.address1?.trim());
    if (!hasShipTo) {
      toast({
        title: "No shipping address on order",
        description:
          "Order details will still show on Buy Labels — enter the ship-to address manually.",
      });
    }
    router.push("/admin/dashboard/buy-labels?from=shopify");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ShoppingBag className="h-7 w-7 text-emerald-600" />
            Shopify Orders
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            All client Shopify orders in one place. Orders auto-sync when you open this page.
            Filter by client, store, status, or date — then fulfill or purchase labels.
          </p>
        </div>
        <Button onClick={() => void handleSync()} disabled={syncing || loading || !user}>
          {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Sync from Shopify
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Client:</span>
            <span className="text-sm">
              {userFilter === "all"
                ? "All clients"
                : usersLoading
                  ? "Loading…"
                  : selectedUser
                    ? formatUserDisplayName(selectedUser)
                    : "Unknown client"}
            </span>
            {selectedUser?.clientId ? (
              <Badge variant="outline" className="text-[10px]">
                {selectedUser.clientId}
              </Badge>
            ) : null}
          </div>
          <Dialog open={userDialogOpen} onOpenChange={setUserDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={usersLoading}>
                Change client
                <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Filter by client</DialogTitle>
                <DialogDescription>Choose all clients or one account to narrow the list.</DialogDescription>
              </DialogHeader>
              <Input
                placeholder="Search name, email, or client ID…"
                value={userSearchQuery}
                onChange={(e) => setUserSearchQuery(e.target.value)}
                className="mb-3"
              />
              <div className="max-h-[360px] space-y-1 overflow-y-auto">
                <button
                  type="button"
                  className={`flex w-full flex-col rounded-md px-3 py-2 text-left hover:bg-muted ${userFilter === "all" ? "bg-muted" : ""}`}
                  onClick={() => handleUserSelect(null)}
                >
                  <span className="text-sm font-medium">All clients</span>
                  <span className="text-xs text-muted-foreground">Show every connected Shopify store</span>
                </button>
                {filteredClients.map((u) => (
                  <button
                    key={u.uid}
                    type="button"
                    className={`flex w-full flex-col rounded-md px-3 py-2 text-left hover:bg-muted ${userFilter === u.uid ? "bg-muted" : ""}`}
                    onClick={() => handleUserSelect(u)}
                  >
                    <span className="text-sm font-medium">{formatUserDisplayName(u)}</span>
                    <span className="text-xs text-muted-foreground">
                      {[u.email, u.clientId].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                ))}
              </div>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total orders</CardDescription>
            <CardTitle className="text-2xl">{orders.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Unfulfilled</CardDescription>
            <CardTitle className="text-2xl text-amber-700">{unfulfilledCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Fulfilled</CardDescription>
            <CardTitle className="text-2xl text-emerald-700">{fulfilledCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Showing (filtered)</CardDescription>
            <CardTitle className="text-2xl">{visible.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-lg">Orders</CardTitle>
              <CardDescription>
                Search and filter, then open details or process unfulfilled orders.
              </CardDescription>
            </div>
            {hasActiveFilters ? (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="mr-1 h-4 w-4" />
                Clear filters
              </Button>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="shopify-admin-search">Search</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="shopify-admin-search"
                  placeholder="Order #, client, customer, email, SKU, tracking…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Fulfillment</Label>
              <Select
                value={fulfillmentFilter}
                onValueChange={(v: FulfillmentFilter) => setFulfillmentFilter(v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="unfulfilled">Unfulfilled</SelectItem>
                  <SelectItem value="partial">Partial</SelectItem>
                  <SelectItem value="fulfilled">Fulfilled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Payment</Label>
              <Select value={financialFilter} onValueChange={setFinancialFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {financialOptions.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Store</Label>
              <Select value={shopFilter} onValueChange={setShopFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All stores</SelectItem>
                  {shopOptions.map((shop) => (
                    <SelectItem key={shop} value={shop}>
                      {shop.replace(".myshopify.com", "")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="shopify-from">From</Label>
              <Input id="shopify-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="shopify-to">To</Label>
              <Input id="shopify-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading orders…
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
              <Package className="h-8 w-8 opacity-40" />
              <p className="font-medium">No orders to show</p>
              <p className="text-sm">Sync from Shopify or adjust filters.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {visible.map((order) => {
                const fulfilled = order.fulfillmentStatus === "fulfilled";
                return (
                  <div
                    key={`${order.ownerUserId}-${order.shop}-${order.id}`}
                    className="rounded-lg border px-4 py-3 transition-colors hover:bg-muted/30"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">{order.name || `#${order.orderNumber}`}</p>
                          <Badge variant="outline" className="capitalize text-[10px]">
                            {order.fulfillmentStatus || "unfulfilled"}
                          </Badge>
                          {order.financialStatus ? (
                            <Badge variant="secondary" className="capitalize text-[10px]">
                              {order.financialStatus}
                            </Badge>
                          ) : null}
                          <Badge variant="outline" className="text-[10px]">
                            {order.ownerName}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {order.shopName || order.shop.replace(".myshopify.com", "")}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {order.customerName || order.email || "Customer"}
                          {order.email && order.customerName ? ` · ${order.email}` : ""}
                        </p>
                        {order.lineItems.length > 0 ? (
                          <p className="truncate text-xs text-muted-foreground">
                            {order.lineItems
                              .slice(0, 3)
                              .map((li) => `${li.quantity}× ${li.title}`)
                              .join(" · ")}
                            {order.lineItems.length > 3 ? ` · +${order.lineItems.length - 3} more` : ""}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
                        <div className="text-left sm:text-right">
                          <p className="font-semibold">
                            {formatMoney(order.totalPrice, order.currency)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Placed {formatWhen(order.createdAt)}
                          </p>
                          {order.trackingNumbers[0] ? (
                            <p className="mt-1 text-xs">
                              Track: <span className="font-medium">{order.trackingNumbers[0]}</span>
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-1.5 justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8"
                            onClick={() => setDetailsOrder(order)}
                          >
                            <Eye className="mr-1.5 h-3.5 w-3.5" />
                            Details
                          </Button>
                          {!fulfilled ? (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8"
                                onClick={() => openFulfillDialog(order)}
                              >
                                <Truck className="mr-1.5 h-3.5 w-3.5" />
                                Quick Fulfill
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8"
                                onClick={() => openLabelFlow(order)}
                              >
                                <Tag className="mr-1.5 h-3.5 w-3.5" />
                                Label
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!detailsOrder} onOpenChange={(open) => !open && setDetailsOrder(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{detailsOrder?.name || `Order #${detailsOrder?.orderNumber}`}</DialogTitle>
            <DialogDescription>
              {detailsOrder
                ? `${detailsOrder.ownerName} · ${detailsOrder.shopName || detailsOrder.shop}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {detailsOrder ? (
            <ShopifyOrderDetailBody
              order={detailsOrder}
              actions={
                detailsOrder.fulfillmentStatus !== "fulfilled" ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => openFulfillDialog(detailsOrder)}>
                      <Truck className="h-4 w-4 mr-1" />
                      Quick Fulfill
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openLabelFlow(detailsOrder)}>
                      <Tag className="h-4 w-4 mr-1" />
                      Create label
                    </Button>
                  </>
                ) : null
              }
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <ShopifyQuickFulfillDialog
        open={fulfillDialogOpen}
        onOpenChange={(open) => {
          setFulfillDialogOpen(open);
          if (!open) {
            setFulfillOrder(null);
            setLabelFulfillHandoff(null);
          }
        }}
        order={fulfillOrder}
        labelHandoff={labelFulfillHandoff}
        getAuthToken={() => user!.getIdToken()}
        onCompleted={() => void fetchOrders("cache")}
      />

      <ShopifyLabelSourceDialog
        open={labelSourceDialogOpen}
        onOpenChange={setLabelSourceDialogOpen}
        order={labelOrder}
        onChooseShopify={handleChooseShopifyLabel}
        onChoosePrepCorex={handleChoosePrepCorexLabel}
      />

      {labelOrder ? (
        <ShopifyCreateLabelDialog
          open={shopifyLabelDialogOpen}
          onOpenChange={setShopifyLabelDialogOpen}
          order={labelOrder}
          userId={labelOrder.ownerUserId}
          getAuthToken={() => user!.getIdToken()}
          onPurchased={() => void fetchOrders("cache")}
        />
      ) : null}
    </div>
  );
}
