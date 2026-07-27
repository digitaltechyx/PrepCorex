"use client";

import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, ShoppingBag } from "lucide-react";
import type { ShopifyNormalizedOrder } from "@/lib/shopify-order-normalize";
import { ShopifyOrderDetailBody } from "@/components/integrations/shopify-order-detail";

type ShopifyConnectionSummary = {
  id: string;
  shop: string;
  shopName: string;
};

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
      if (storeFilter !== "all") {
        if (storeFilter.includes(".myshopify.com")) params.set("shop", storeFilter);
        else params.set("connectionId", storeFilter);
      }
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
  }, [user, toast, storeFilter]);

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
    const fromConnections = connections.map((c) => ({
      key: c.id,
      label: c.shopName || c.shop.replace(".myshopify.com", ""),
    }));
    return fromConnections;
  }, [connections]);

  const filteredOrders = useMemo(() => {
    if (storeFilter === "all") return orders;
    if (connections.some((c) => c.id === storeFilter)) {
      return orders.filter((o) => o.connectionId === storeFilter);
    }
    const target = normalizeShop(storeFilter);
    return orders.filter((o) => normalizeShop(o.shop) === target);
  }, [orders, storeFilter, connections]);

  const selectedStoreLabel = useMemo(() => {
    if (storeFilter === "all") return "All stores";
    const conn = connections.find((c) => c.id === storeFilter);
    if (conn) return conn.shopName || conn.shop.replace(".myshopify.com", "");
    return storeFilter.replace(".myshopify.com", "");
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
                Full order details from your connected Shopify store(s) — line items, shipping address,
                totals, and tracking. Click Refresh to pull the latest from Shopify.
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
                    {storeOptions.map((opt) => (
                      <SelectItem key={opt.key} value={opt.key}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button onClick={() => void handleRefresh()} disabled={refreshing || !user || loading} variant="outline">
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
              <p className="text-sm text-muted-foreground">
                No Shopify orders yet{storeFilter !== "all" ? " for this store" : ""}.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                When customers place orders on your Shopify store, they will appear here after you refresh.
              </p>
            </div>
          ) : (
            <ul className="space-y-4">
              {filteredOrders.map((order) => (
                <li
                  key={`${order.shop}-${order.id}`}
                  className="rounded-xl border bg-card p-4 shadow-sm"
                >
                  <ShopifyOrderDetailBody order={order} />
                </li>
              ))}
            </ul>
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
        <div className="flex items-center gap-2 text-muted-foreground p-6">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading…
        </div>
      }
    >
      <ShopifyOrdersContent />
    </Suspense>
  );
}
