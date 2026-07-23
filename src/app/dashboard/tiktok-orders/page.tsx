"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
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
import type { TikTokNormalizedOrder } from "@/lib/tiktok-order-normalize";
import { TikTokOrderDetailBody } from "@/components/integrations/tiktok-order-detail";

type TikTokConnectionSummary = {
  id: string;
  shopId?: string;
  shopName: string;
};

function TikTokOrdersContent() {
  const searchParams = useSearchParams();
  const connectionParam = searchParams.get("connectionId")?.trim() || "";
  const { user } = useAuth();
  const { toast } = useToast();
  const [orders, setOrders] = useState<TikTokNormalizedOrder[]>([]);
  const [connections, setConnections] = useState<TikTokConnectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [shopFilter, setShopFilter] = useState<string>(connectionParam || "all");

  useEffect(() => {
    if (connectionParam) setShopFilter(connectionParam);
  }, [connectionParam]);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const [connRes, ordersRes] = await Promise.all([
        fetch("/api/integrations/tiktok-connections", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch("/api/tiktok/orders", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      if (connRes.ok) {
        const data = await connRes.json();
        setConnections(data.connections ?? []);
      }
      if (!ordersRes.ok) {
        const data = await ordersRes.json().catch(() => ({}));
        throw new Error(
          [data.error, data.detail].filter(Boolean).join(" — ") || "Failed to load orders"
        );
      }
      const data = await ordersRes.json();
      setOrders(Array.isArray(data.orders) ? data.orders : []);
      if (Array.isArray(data.connections) && data.connections.length) {
        setConnections((prev) => (prev.length ? prev : data.connections));
      }
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e instanceof Error ? e.message : "Failed to load TikTok orders.",
      });
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
    toast({ title: "Orders refreshed", description: "Showing the latest TikTok Shop orders." });
  };

  const filteredOrders = useMemo(() => {
    if (shopFilter === "all") return orders;
    return orders.filter((o) => o.connectionId === shopFilter);
  }, [orders, shopFilter]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2">
                <ShoppingBag className="h-5 w-5 text-fuchsia-600" />
                TikTok Shop Orders
              </CardTitle>
              <CardDescription className="mt-1">
                Full order details from your connected TikTok Shop(s). Shipping and tracking updates are handled by
                PrepCorex admins.
              </CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {connections.length > 1 && (
                <Select value={shopFilter} onValueChange={setShopFilter}>
                  <SelectTrigger className="w-full sm:w-[220px]">
                    <SelectValue placeholder="Filter by shop" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All shops</SelectItem>
                    {connections.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.shopName || c.shopId || c.id}
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
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading orders…
            </div>
          ) : connections.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center">
              <p className="text-sm text-muted-foreground">No TikTok Shop connected.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Connect a shop from{" "}
                <Link href="/dashboard/integrations" className="text-primary underline-offset-2 hover:underline">
                  Integrations
                </Link>
                .
              </p>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center">
              <p className="text-sm text-muted-foreground">No TikTok orders yet.</p>
              <p className="text-xs text-muted-foreground mt-1">
                When customers place orders on TikTok Shop, they will appear here. Try Refresh after a test order.
              </p>
            </div>
          ) : (
            <ul className="space-y-4">
              {filteredOrders.map((o) => (
                <li
                  key={`${o.connectionId || ""}-${o.id}`}
                  className="rounded-xl border bg-card p-4 shadow-sm"
                >
                  <TikTokOrderDetailBody order={o} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function TikTokOrdersPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center gap-2 text-muted-foreground p-6">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading…
        </div>
      }
    >
      <TikTokOrdersContent />
    </Suspense>
  );
}
