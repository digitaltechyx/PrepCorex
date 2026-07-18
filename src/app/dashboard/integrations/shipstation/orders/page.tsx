"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Loader2, RefreshCw, Package } from "lucide-react";
import { format } from "date-fns";

type ShipStationOrderRow = {
  id: string;
  orderId?: number;
  orderNumber?: string;
  orderStatus?: string;
  customerName?: string | null;
  customerEmail?: string | null;
  orderTotal?: number | null;
  hasPurchasedLabel?: boolean;
  trackingNumber?: string | null;
  carrierCode?: string | null;
  serviceCode?: string | null;
  shipmentCost?: number | null;
  labelShipDate?: string | null;
  modifyDate?: string | null;
  orderDate?: string | null;
  syncedAt?: string;
  items?: Array<{ sku?: string; name?: string; quantity?: number }>;
};

function formatWhen(raw?: string | null) {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return format(d, "PPp");
}

export default function ShipStationOrdersPage() {
  const searchParams = useSearchParams();
  const connectionId = searchParams.get("connectionId")?.trim() || undefined;
  const { user } = useAuth();
  const { toast } = useToast();
  const [orders, setOrders] = useState<ShipStationOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState<"all" | "labeled" | "open">("all");
  const [search, setSearch] = useState("");

  const fetchOrders = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const params = new URLSearchParams();
      if (connectionId) params.set("connectionId", connectionId);
      const res = await fetch(`/api/integrations/shipstation/orders?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load orders");
      setOrders(data.orders ?? []);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e instanceof Error ? e.message : "Failed to load ShipStation orders.",
      });
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [user, toast, connectionId]);

  useEffect(() => {
    if (user) void fetchOrders();
  }, [user, fetchOrders]);

  const handleSync = async () => {
    if (!user) return;
    setSyncing(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/integrations/shipstation/orders", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ connectionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Sync failed");
      toast({
        title: "ShipStation synced",
        description: `${data.synced ?? 0} orders · ${data.withLabels ?? 0} with purchased labels`,
      });
      await fetchOrders();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Sync failed",
        description: e instanceof Error ? e.message : "Could not sync ShipStation.",
      });
    } finally {
      setSyncing(false);
    }
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (filter === "labeled" && !o.hasPurchasedLabel) return false;
      if (filter === "open" && o.hasPurchasedLabel) return false;
      if (!q) return true;
      return (
        String(o.orderNumber || "").toLowerCase().includes(q) ||
        String(o.customerName || "").toLowerCase().includes(q) ||
        String(o.trackingNumber || "").toLowerCase().includes(q) ||
        String(o.customerEmail || "").toLowerCase().includes(q)
      );
    });
  }, [orders, filter, search]);

  const labeledCount = orders.filter((o) => o.hasPurchasedLabel).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Button variant="ghost" size="sm" className="mb-2 -ml-2 h-8 px-2" asChild>
            <Link href="/dashboard/integrations">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Integrations
            </Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">ShipStation Orders</h1>
          <p className="text-sm text-muted-foreground">
            Orders synced from your ShipStation account, including shipments with purchased labels.
          </p>
        </div>
        <Button onClick={() => void handleSync()} disabled={syncing || !user}>
          {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Sync now
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Synced orders</CardDescription>
            <CardTitle className="text-2xl">{orders.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>With purchased label</CardDescription>
            <CardTitle className="text-2xl">{labeledCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Open / no SS label</CardDescription>
            <CardTitle className="text-2xl">{orders.length - labeledCount}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader className="gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-lg">Orders</CardTitle>
            <CardDescription>Filter by label status or search order # / tracking.</CardDescription>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="sm:w-[200px]"
            />
            <Select value={filter} onValueChange={(v: "all" | "labeled" | "open") => setFilter(v)}>
              <SelectTrigger className="sm:w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All orders</SelectItem>
                <SelectItem value="labeled">Purchased labels</SelectItem>
                <SelectItem value="open">No SS label yet</SelectItem>
              </SelectContent>
            </Select>
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
              <p className="text-sm">Connect ShipStation and sync, or change the filter.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {visible.map((order) => (
                <div
                  key={order.id}
                  className="rounded-lg border px-4 py-3 transition-colors hover:bg-muted/30"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">#{order.orderNumber || order.orderId}</p>
                        <Badge variant="outline" className="capitalize">
                          {String(order.orderStatus || "unknown").replace(/_/g, " ")}
                        </Badge>
                        {order.hasPurchasedLabel ? (
                          <Badge className="border-0 bg-emerald-600 hover:bg-emerald-600/90">
                            Label purchased
                          </Badge>
                        ) : (
                          <Badge variant="secondary">No SS label</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {order.customerName || "Customer"}
                        {order.customerEmail ? ` · ${order.customerEmail}` : ""}
                      </p>
                      {order.items && order.items.length > 0 && (
                        <p className="truncate text-xs text-muted-foreground">
                          {order.items
                            .slice(0, 3)
                            .map((i) => `${i.quantity || 1}× ${i.name || i.sku || "Item"}`)
                            .join(" · ")}
                          {order.items.length > 3 ? ` · +${order.items.length - 3} more` : ""}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 text-left sm:text-right">
                      {order.orderTotal != null && (
                        <p className="font-semibold">${Number(order.orderTotal).toFixed(2)}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {formatWhen(order.modifyDate || order.orderDate || order.syncedAt)}
                      </p>
                      {order.hasPurchasedLabel && (
                        <div className="mt-1 space-y-0.5 text-xs">
                          {order.trackingNumber && (
                            <p>
                              Track: <span className="font-medium">{order.trackingNumber}</span>
                            </p>
                          )}
                          {(order.carrierCode || order.serviceCode) && (
                            <p className="text-muted-foreground">
                              {[order.carrierCode, order.serviceCode].filter(Boolean).join(" / ")}
                            </p>
                          )}
                          {order.shipmentCost != null && (
                            <p className="text-muted-foreground">
                              Label cost: ${Number(order.shipmentCost).toFixed(2)}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
