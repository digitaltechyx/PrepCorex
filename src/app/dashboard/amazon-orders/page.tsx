"use client";

import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import type { AmazonNormalizedOrder } from "@/lib/amazon-order-normalize";
import { AmazonOrderDetailBody } from "@/components/integrations/amazon-order-detail";

type AmazonConnectionSummary = {
  id: string;
  storeName: string;
};

function AmazonOrdersContent() {
  const searchParams = useSearchParams();
  const connectionParam = searchParams.get("connectionId")?.trim() || "";
  const { user } = useAuth();
  const { toast } = useToast();
  const [orders, setOrders] = useState<AmazonNormalizedOrder[]>([]);
  const [connections, setConnections] = useState<AmazonConnectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [storeFilter, setStoreFilter] = useState<string>("all");
  const [orderTab, setOrderTab] = useState<"fbm" | "fba">("fbm");

  useEffect(() => {
    if (connectionParam) setStoreFilter(connectionParam);
  }, [connectionParam]);

  const fetchConnections = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/integrations/amazon-connections", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setConnections(
          (data.connections ?? []).map((c: { id: string; storeName?: string }) => ({
            id: c.id,
            storeName: c.storeName || "Amazon",
          }))
        );
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
      if (storeFilter !== "all") params.set("connectionId", storeFilter);
      const res = await fetch(`/api/amazon/orders?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data.error as string) || "Failed to load orders");
      setOrders(Array.isArray(data.orders) ? data.orders : []);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e instanceof Error ? e.message : "Failed to load Amazon orders.",
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

  const accountOrders = useMemo(() => {
    if (storeFilter === "all") return orders;
    return orders.filter((o) => o.connectionId === storeFilter);
  }, [orders, storeFilter]);

  const fbmOrders = useMemo(
    () => accountOrders.filter((o) => !o.isFba),
    [accountOrders]
  );
  const fbaOrders = useMemo(
    () => accountOrders.filter((o) => o.isFba),
    [accountOrders]
  );
  const fbmCount = fbmOrders.length;
  const fbaCount = fbaOrders.length;

  useEffect(() => {
    if (orderTab === "fbm" && fbmCount === 0 && fbaCount > 0) setOrderTab("fba");
    if (orderTab === "fba" && fbaCount === 0 && fbmCount > 0) setOrderTab("fbm");
  }, [orderTab, fbmCount, fbaCount]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchOrders();
    setRefreshing(false);
    toast({ title: "Orders refreshed", description: "Pulled latest Amazon orders." });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShoppingBag className="h-5 w-5 text-orange-600" />
                Amazon Orders
              </CardTitle>
              <CardDescription className="mt-1">
                FBM and FBA orders from your connected Amazon seller account(s). Fulfillment is handled by PrepCorex admin.
              </CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {connections.length > 1 && (
                <Select value={storeFilter} onValueChange={setStoreFilter}>
                  <SelectTrigger className="w-full sm:w-[220px]">
                    <SelectValue placeholder="Filter account" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All accounts</SelectItem>
                    {connections.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.storeName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button onClick={() => void handleRefresh()} disabled={refreshing || loading} variant="outline">
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
          ) : accountOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8">
              No Amazon orders yet. Connect Amazon from Integrations, then refresh.
            </p>
          ) : (
            <Tabs value={orderTab} onValueChange={(v) => setOrderTab(v as "fbm" | "fba")}>
              <TabsList className="mb-4">
                <TabsTrigger value="fbm" className="gap-2">
                  FBM Orders
                  <Badge
                    variant={orderTab === "fbm" ? "default" : "secondary"}
                    className="h-5 min-w-5 px-1.5 text-[10px] tabular-nums"
                  >
                    {fbmCount}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="fba" className="gap-2">
                  FBA Orders
                  <Badge
                    variant={orderTab === "fba" ? "default" : "secondary"}
                    className="h-5 min-w-5 px-1.5 text-[10px] tabular-nums"
                  >
                    {fbaCount}
                  </Badge>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="fbm" className="mt-0 space-y-4">
                {fbmOrders.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6">No FBM orders in this view.</p>
                ) : (
                  fbmOrders.map((order) => (
                    <div key={order.id} className="rounded-lg border p-4">
                      <AmazonOrderDetailBody order={order} compact />
                    </div>
                  ))
                )}
              </TabsContent>

              <TabsContent value="fba" className="mt-0 space-y-4">
                {fbaOrders.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6">No FBA orders in this view.</p>
                ) : (
                  fbaOrders.map((order) => (
                    <div key={order.id} className="rounded-lg border p-4">
                      <AmazonOrderDetailBody order={order} compact />
                    </div>
                  ))
                )}
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AmazonOrdersPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center gap-2 text-muted-foreground py-8">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading…
        </div>
      }
    >
      <AmazonOrdersContent />
    </Suspense>
  );
}
