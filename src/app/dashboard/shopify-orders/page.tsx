"use client";

import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, Search, ShoppingBag, X } from "lucide-react";
import type { ShopifyNormalizedOrder } from "@/lib/shopify-order-normalize";
import { ShopifyOrderDetailBody } from "@/components/integrations/shopify-order-detail";
import { ShopifyOrdersCsvDownload } from "@/components/integrations/shopify-orders-csv-download";
import {
  isShopifyOrderCancelled,
  isShopifyOrderPaid,
  isShopifyOrderRefunded,
  isShopifyOrderUnfulfilledStatus,
  isShopifyOrderUnpaid,
} from "@/lib/shopify-order-status";

type ShopifyConnectionSummary = {
  id: string;
  shop: string;
  shopName: string;
};

type FulfillmentFilter = "all" | "unfulfilled" | "fulfilled";
type CancelledFilter = "all" | "cancelled" | "refunded";
type PaymentFilter = "all" | "paid" | "unpaid";

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

function ShopifyOrdersContent() {
  const searchParams = useSearchParams();
  const shopParam = searchParams.get("shop")?.trim() || "";
  const connectionParam = searchParams.get("connectionId")?.trim() || "";
  const { user } = useAuth();
  const { toast } = useToast();
  const [orders, setOrders] = useState<ShopifyNormalizedOrder[]>([]);
  const [connections, setConnections] = useState<ShopifyConnectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [fulfillmentFilter, setFulfillmentFilter] = useState<FulfillmentFilter>("all");
  const [cancelledFilter, setCancelledFilter] = useState<CancelledFilter>("all");
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    if (connectionParam) setStoreFilter(connectionParam);
    else if (shopParam) setStoreFilter(shopParam);
  }, [shopParam, connectionParam]);

  const normalizeShop = (shop: string | undefined) => {
    if (!shop) return "";
    const s = shop.trim().toLowerCase();
    return s.endsWith(".myshopify.com") ? s : `${s}.myshopify.com`;
  };

  const fetchConnections = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/integrations/shopify-connections", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setConnections(data.connections ?? []);
      }
    } catch {
      setConnections([]);
    }
  }, [user]);

  const fetchOrders = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const params = new URLSearchParams({ userId: user.uid, source: "live" });
      const res = await fetch(`/api/shopify/orders?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          [data.error, data.reconnect ? "Reconnect Shopify from Integrations." : null]
            .filter(Boolean)
            .join(" — ") || "Failed to load orders"
        );
      }
      const data = await res.json();
      setOrders(Array.isArray(data.orders) ? data.orders : []);
      if (Array.isArray(data.connections) && data.connections.length) {
        setConnections((prev) => (prev.length ? prev : data.connections));
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
  }, [user, toast]);

  useEffect(() => {
    if (!user) return;
    void fetchConnections();
  }, [user, fetchConnections]);

  useEffect(() => {
    if (!user) return;
    void fetchOrders();
  }, [user, fetchOrders]);

  const handleRefresh = async () => {
    if (!user) return;
    setRefreshing(true);
    await fetchOrders();
    setRefreshing(false);
    toast({
      title: "Orders refreshed",
      description: "Pulled full order details from your connected Shopify store(s).",
    });
  };

  const storeOptions = useMemo(() => {
    return connections.map((c) => ({
      key: c.id,
      label: c.shopName || c.shop.replace(".myshopify.com", ""),
      shop: c.shop,
    }));
  }, [connections]);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    const from = startOfDay(dateFrom);
    const to = endOfDay(dateTo);

    return orders
      .filter((o) => {
        if (storeFilter !== "all") {
          if (connections.some((c) => c.id === storeFilter)) {
            if (o.connectionId !== storeFilter) return false;
          } else {
            const target = normalizeShop(storeFilter);
            if (normalizeShop(o.shop) !== target) return false;
          }
        }

        if (paymentFilter === "paid" && !isShopifyOrderPaid(o)) return false;
        if (paymentFilter === "unpaid" && !isShopifyOrderUnpaid(o)) return false;

        if (cancelledFilter === "cancelled" && !isShopifyOrderCancelled(o)) return false;
        if (cancelledFilter === "refunded" && !isShopifyOrderRefunded(o)) return false;

        const fs = o.fulfillmentStatus || "unfulfilled";
        if (fulfillmentFilter === "unfulfilled" && !isShopifyOrderUnfulfilledStatus(fs)) return false;
        if (fulfillmentFilter === "fulfilled" && fs !== "fulfilled") return false;

        if (from || to) {
          if (!o.createdAt) return false;
          const d = new Date(o.createdAt);
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
      })
      .sort((a, b) => {
        const aMs = a.createdAt ? Date.parse(a.createdAt) : 0;
        const bMs = b.createdAt ? Date.parse(b.createdAt) : 0;
        return (Number.isNaN(bMs) ? 0 : bMs) - (Number.isNaN(aMs) ? 0 : aMs);
      });
  }, [
    orders,
    storeFilter,
    connections,
    search,
    fulfillmentFilter,
    cancelledFilter,
    paymentFilter,
    dateFrom,
    dateTo,
  ]);

  const hasActiveFilters =
    search.trim() !== "" ||
    fulfillmentFilter !== "all" ||
    cancelledFilter !== "all" ||
    paymentFilter !== "all" ||
    storeFilter !== "all" ||
    dateFrom !== "" ||
    dateTo !== "";

  const clearFilters = () => {
    setSearch("");
    setFulfillmentFilter("all");
    setCancelledFilter("all");
    setPaymentFilter("all");
    setStoreFilter("all");
    setDateFrom("");
    setDateTo("");
    setCurrentPage(1);
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [
    search,
    fulfillmentFilter,
    cancelledFilter,
    paymentFilter,
    storeFilter,
    dateFrom,
    dateTo,
  ]);

  const cancelledCount = orders.filter((o) => isShopifyOrderCancelled(o)).length;
  const refundedCount = orders.filter((o) => isShopifyOrderRefunded(o)).length;
  const unfulfilledCount = orders.filter(
    (o) => !isShopifyOrderCancelled(o) && isShopifyOrderUnfulfilledStatus(o.fulfillmentStatus)
  ).length;
  const fulfilledCount = orders.filter((o) => o.fulfillmentStatus === "fulfilled").length;

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / itemsPerPage));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const pagedOrders = filteredOrders.slice(startIndex, endIndex);

  return (
    <div className="space-y-4 sm:space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2">
                <ShoppingBag className="h-5 w-5 text-emerald-600" />
                Shopify Orders
              </CardTitle>
              <CardDescription className="mt-1">
                Full order details from your connected Shopify store(s). Clear statuses show cancelled /
                refunded so you know what not to ship. Filter and download CSV anytime.
              </CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <ShopifyOrdersCsvDownload
                orders={orders}
                filePrefix="shopify-orders-client"
                disabled={loading || orders.length === 0}
              />
              <Button
                onClick={() => void handleRefresh()}
                disabled={refreshing || !user || loading}
                variant="outline"
              >
                {refreshing || loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <Card>
          <CardHeader className="space-y-0 p-3 sm:p-4 sm:pb-2">
            <CardDescription className="text-xs">Total</CardDescription>
            <CardTitle className="text-xl tabular-nums sm:text-2xl">{orders.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="space-y-0 p-3 sm:p-4 sm:pb-2">
            <CardDescription className="text-xs">Unfulfilled</CardDescription>
            <CardTitle className="text-xl tabular-nums text-amber-700 sm:text-2xl">
              {unfulfilledCount}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="space-y-0 p-3 sm:p-4 sm:pb-2">
            <CardDescription className="text-xs">Fulfilled</CardDescription>
            <CardTitle className="text-xl tabular-nums text-emerald-700 sm:text-2xl">
              {fulfilledCount}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="space-y-0 p-3 sm:p-4 sm:pb-2">
            <CardDescription className="text-xs">
              Showing{hasActiveFilters ? " (filtered)" : ""}
            </CardDescription>
            <CardTitle className="text-xl tabular-nums sm:text-2xl">{filteredOrders.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-base sm:text-lg">Orders</CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Search and filter by store, fulfillment, payment, cancelled, or date.
              </CardDescription>
            </div>
            {hasActiveFilters ? (
              <Button variant="ghost" size="sm" className="self-start" onClick={clearFilters}>
                <X className="mr-1 h-4 w-4" />
                Clear filters
              </Button>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="client-shopify-search">Search</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="client-shopify-search"
                  placeholder="Order #, customer, email, SKU…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            {storeOptions.length > 0 ? (
              <div className="space-y-1.5">
                <Label>Store</Label>
                <Select value={storeFilter} onValueChange={setStoreFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Filter by store" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All stores</SelectItem>
                    {storeOptions.map((opt) => (
                      <SelectItem key={opt.key} value={opt.key}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

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
                  <SelectItem value="fulfilled">Fulfilled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Payment</Label>
              <Select
                value={paymentFilter}
                onValueChange={(v: PaymentFilter) => setPaymentFilter(v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="unpaid">Unpaid</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Cancelled / Refunded</Label>
              <Select
                value={cancelledFilter}
                onValueChange={(v: CancelledFilter) => setCancelledFilter(v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="cancelled">Cancelled ({cancelledCount})</SelectItem>
                  <SelectItem value="refunded">Refunded ({refundedCount})</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="client-shopify-from">From</Label>
              <Input
                id="client-shopify-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="client-shopify-to">To</Label>
              <Input
                id="client-shopify-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading orders…
            </div>
          ) : connections.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center">
              <p className="text-sm text-muted-foreground">No Shopify store connected.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Connect a store from{" "}
                <Link
                  href="/dashboard/integrations"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  Integrations
                </Link>{" "}
                to start receiving orders here.
              </p>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center">
              <p className="text-sm text-muted-foreground">No Shopify orders match these filters.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Refresh from Shopify or clear filters.
              </p>
            </div>
          ) : (
            <>
              <ul className="space-y-4">
                {pagedOrders.map((order) => (
                  <li
                    key={`${order.shop}-${order.id}`}
                    className="rounded-xl border bg-card p-4 shadow-sm"
                  >
                    <ShopifyOrderDetailBody order={order} />
                  </li>
                ))}
              </ul>

              {filteredOrders.length > itemsPerPage ? (
                <div className="mt-4 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-muted-foreground">
                    Showing {startIndex + 1} to {Math.min(endIndex, filteredOrders.length)} of{" "}
                    {filteredOrders.length} orders
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={safePage <= 1}
                    >
                      Previous
                    </Button>
                    <span className="text-sm tabular-nums">
                      Page {safePage} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={safePage >= totalPages}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function ShopifyOrdersPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center gap-2 p-6 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading…
        </div>
      }
    >
      <ShopifyOrdersContent />
    </Suspense>
  );
}
