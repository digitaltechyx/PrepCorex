"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ExternalLink, Loader2, RefreshCw, ShoppingBag } from "lucide-react";
import { format } from "date-fns";
import type { ShopifyOrder } from "@/types";

type ShopifyConnectionSummary = {
  id: string;
  shop: string;
  shopName: string;
};

function normalizeShop(shop: string | undefined): string {
  if (!shop) return "";
  const s = shop.trim().toLowerCase();
  return s.endsWith(".myshopify.com") ? s : `${s}.myshopify.com`;
}

function formatOrderDate(raw: string | undefined) {
  if (!raw) return "—";
  try {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? raw : format(d, "PPp");
  } catch {
    return raw;
  }
}

function addressLine(a: ShopifyOrder["shipping_address"]) {
  if (!a) return "—";
  const parts = [a.address1, a.city, a.province, a.country, a.zip].filter(Boolean);
  return parts.length ? parts.join(", ") : "—";
}

function shopifyAdminOrderUrl(order: ShopifyOrder & { id: string }) {
  const shop = order.shop?.trim();
  if (!shop) return null;
  return `https://${shop}/admin/orders/${order.id}`;
}

export default function ShopifyOrdersPage() {
  const searchParams = useSearchParams();
  const shopParam = searchParams.get("shop")?.trim() || undefined;
  const { user } = useAuth();
  const { toast } = useToast();
  const [orders, setOrders] = useState<Array<ShopifyOrder & { id: string }>>([]);
  const [connections, setConnections] = useState<ShopifyConnectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [storeFilter, setStoreFilter] = useState<string>("all");

  useEffect(() => {
    if (shopParam) setStoreFilter(normalizeShop(shopParam));
  }, [shopParam]);

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
      const res = await fetch("/api/shopify/orders", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data.error as string) || "Failed to load orders");
      }
      const data = await res.json();
      setOrders(Array.isArray(data.orders) ? data.orders : []);
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
    fetchConnections();
    fetchOrders();
  }, [user, fetchConnections, fetchOrders]);

  const handleRefresh = async () => {
    if (!user) return;
    setRefreshing(true);
    await fetchOrders();
    setRefreshing(false);
    toast({ title: "Orders refreshed", description: "Showing the latest synced orders from your store(s)." });
  };

  const storeOptions = useMemo(() => {
    const fromOrders = new Set(orders.map((o) => normalizeShop(o.shop)).filter(Boolean));
    const fromConnections = connections.map((c) => normalizeShop(c.shop)).filter(Boolean);
    const all = new Set([...fromOrders, ...fromConnections]);
    return Array.from(all).sort();
  }, [orders, connections]);

  const filteredOrders = useMemo(() => {
    if (storeFilter === "all") return orders;
    const target = normalizeShop(storeFilter);
    return orders.filter((o) => normalizeShop(o.shop) === target);
  }, [orders, storeFilter]);

  const selectedStoreLabel = useMemo(() => {
    if (storeFilter === "all") return "All stores";
    const conn = connections.find((c) => normalizeShop(c.shop) === normalizeShop(storeFilter));
    return conn?.shopName || storeFilter.replace(".myshopify.com", "");
  }, [storeFilter, connections]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2">
                <ShoppingBag className="h-5 w-5 text-emerald-600" />
                Shopify Orders
              </CardTitle>
              <CardDescription className="mt-1">
                Orders from your connected Shopify store(s). New and updated orders sync automatically via
                Shopify webhooks.
              </CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {storeOptions.length > 1 && (
                <Select value={storeFilter} onValueChange={setStoreFilter}>
                  <SelectTrigger className="w-full sm:w-[220px]">
                    <SelectValue placeholder="Filter by store" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All stores</SelectItem>
                    {storeOptions.map((shop) => (
                      <SelectItem key={shop} value={shop}>
                        {connections.find((c) => normalizeShop(c.shop) === shop)?.shopName ||
                          shop.replace(".myshopify.com", "")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button onClick={handleRefresh} disabled={refreshing || !user || loading} variant="outline">
                {refreshing || loading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Refresh
              </Button>
            </div>
          </div>
          {storeFilter !== "all" && (
            <p className="text-xs text-muted-foreground pt-1">
              Showing orders for <span className="font-medium text-foreground">{selectedStoreLabel}</span>
            </p>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading orders…
            </div>
          ) : connections.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center">
              <p className="text-sm text-muted-foreground">No Shopify store connected.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Connect a store from{" "}
                <Link href="/dashboard/integrations" className="text-primary underline-offset-2 hover:underline">
                  Integrations
                </Link>{" "}
                to start receiving orders here.
              </p>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center">
              <p className="text-sm text-muted-foreground">No Shopify orders yet{storeFilter !== "all" ? " for this store" : ""}.</p>
              <p className="text-xs text-muted-foreground mt-1">
                When customers place orders on your Shopify store, they will appear here after webhook sync. Try
                Refresh if you just placed a test order.
              </p>
            </div>
          ) : (
            <ul className="space-y-4">
              {filteredOrders.map((order) => {
                const adminUrl = shopifyAdminOrderUrl(order);
                const customerLabel =
                  order.email ||
                  [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(" ") ||
                  "—";
                const fulfilled = order.fulfillment_status === "fulfilled";

                return (
                  <li key={`${order.shop}-${order.id}`} className="rounded-xl border bg-card p-4 shadow-sm">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">{order.name || `#${order.order_number}`}</p>
                          {order.shop && (
                            <Badge variant="outline" className="text-[10px] font-normal">
                              {order.shop.replace(".myshopify.com", "")}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          Placed {formatOrderDate(order.created_at)}
                        </p>
                        <p className="text-sm text-muted-foreground">Customer: {customerLabel}</p>
                        <p className="text-sm text-muted-foreground truncate" title={addressLine(order.shipping_address)}>
                          Ship to: {addressLine(order.shipping_address)}
                        </p>
                        {(order.line_items ?? []).length > 0 && (
                          <ul className="mt-2 space-y-1 text-sm border-t pt-2">
                            {(order.line_items ?? []).map((li, i) => (
                              <li key={li.id ?? i}>
                                {li.title ?? "Item"}
                                {li.sku ? ` · ${li.sku}` : ""} × {li.quantity ?? 1}
                              </li>
                            ))}
                          </ul>
                        )}
                        {order.note && (
                          <p className="mt-2 text-xs text-muted-foreground italic">Note: {order.note}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                        <Badge variant={fulfilled ? "default" : "secondary"} className="capitalize">
                          {order.fulfillment_status || "unfulfilled"}
                        </Badge>
                        {adminUrl && (
                          <Button size="sm" variant="outline" asChild>
                            <a href={adminUrl} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-4 w-4 mr-1" />
                              View in Shopify
                            </a>
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
