"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ETSY_COMMON_CARRIERS } from "@/lib/etsy-api";
import { Loader2, RefreshCw, ShoppingBag, Truck } from "lucide-react";

type EtsyConnectionSummary = { id: string; shopId?: string; shopName: string };

type EtsyOrderRow = {
  receiptId: string;
  status: string | null;
  isPaid: boolean;
  isShipped: boolean;
  createdAt: string | null;
  buyerName: string | null;
  total: number;
  currency: string | null;
  lineItems: Array<{
    title: string | null;
    quantity: number | null;
    sku: string | null;
  }>;
};

function EtsyOrdersContent() {
  const searchParams = useSearchParams();
  const connectionParam = searchParams.get("connectionId")?.trim() || "";
  const { user } = useAuth();
  const { toast } = useToast();
  const [orders, setOrders] = useState<EtsyOrderRow[]>([]);
  const [connections, setConnections] = useState<EtsyConnectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [shopFilter, setShopFilter] = useState<string>(connectionParam || "");
  const [trackingByOrder, setTrackingByOrder] = useState<Record<string, string>>({});
  const [carrierByOrder, setCarrierByOrder] = useState<Record<string, string>>({});
  const [fulfillingId, setFulfillingId] = useState<string | null>(null);

  useEffect(() => {
    if (connectionParam) setShopFilter(connectionParam);
  }, [connectionParam]);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const connRes = await fetch("/api/integrations/etsy-connections", {
        headers: { Authorization: `Bearer ${token}` },
      });
      let conns: EtsyConnectionSummary[] = [];
      if (connRes.ok) {
        const data = await connRes.json();
        conns = data.connections ?? [];
        setConnections(conns);
      }
      const activeId =
        shopFilter && shopFilter !== "all"
          ? shopFilter
          : connectionParam || conns[0]?.id || "";
      if (!activeId) {
        setOrders([]);
        return;
      }
      if (!shopFilter && activeId) setShopFilter(activeId);

      const ordersRes = await fetch(
        `/api/etsy/orders?connectionId=${encodeURIComponent(activeId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!ordersRes.ok) {
        const data = await ordersRes.json().catch(() => ({}));
        throw new Error(data.error || "Failed to load orders");
      }
      const data = await ordersRes.json();
      setOrders(Array.isArray(data.orders) ? data.orders : []);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e instanceof Error ? e.message : "Failed to load Etsy orders.",
      });
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [user, toast, shopFilter, connectionParam]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleFulfill = async (order: EtsyOrderRow) => {
    if (!user || !shopFilter) return;
    const trackingCode = (trackingByOrder[order.receiptId] || "").trim();
    const carrierName = (carrierByOrder[order.receiptId] || "usps").trim();
    if (!trackingCode) {
      toast({
        variant: "destructive",
        title: "Tracking required",
        description: "Enter a tracking number before marking shipped.",
      });
      return;
    }
    setFulfillingId(order.receiptId);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/etsy/fulfill", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          connectionId: shopFilter,
          receiptId: order.receiptId,
          trackingCode,
          carrierName,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Fulfill failed");
      toast({
        title: "Shipped on Etsy",
        description: `Receipt #${order.receiptId} marked shipped with ${trackingCode}.`,
      });
      void fetchData();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Fulfill failed",
        description: e instanceof Error ? e.message : "Could not mark shipped on Etsy.",
      });
    } finally {
      setFulfillingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Etsy orders</h1>
          <p className="text-sm text-muted-foreground">
            Unshipped paid receipts — mark shipped with tracking to notify the buyer on Etsy.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/integrations">Integrations</Link>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void fetchData()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {connections.length > 1 ? (
        <Select value={shopFilter || connections[0]?.id} onValueChange={setShopFilter}>
          <SelectTrigger className="max-w-xs">
            <SelectValue placeholder="Shop" />
          </SelectTrigger>
          <SelectContent>
            {connections.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.shopName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShoppingBag className="h-4 w-4" />
            Open orders
          </CardTitle>
          <CardDescription>Paid and not yet marked shipped on Etsy.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading…
            </div>
          ) : orders.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No open Etsy orders right now.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {orders.map((o) => (
                <li key={o.receiptId} className="space-y-3 p-3 sm:p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">#{o.receiptId}</p>
                      <p className="text-xs text-muted-foreground">
                        {o.buyerName || "Buyer"}
                        {o.createdAt
                          ? ` · ${new Date(o.createdAt).toLocaleString()}`
                          : ""}
                      </p>
                    </div>
                    <p className="text-sm font-medium tabular-nums">
                      {o.currency || "USD"} {o.total.toFixed(2)}
                    </p>
                  </div>
                  <ul className="text-sm text-muted-foreground">
                    {o.lineItems.map((li, i) => (
                      <li key={i}>
                        {li.quantity ?? 1}× {li.title || "Item"}
                        {li.sku ? ` (${li.sku})` : ""}
                      </li>
                    ))}
                  </ul>
                  {!o.isShipped ? (
                    <div className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3 sm:flex-row sm:items-end">
                      <div className="min-w-0 flex-1 space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">
                          Tracking number
                        </label>
                        <Input
                          value={trackingByOrder[o.receiptId] || ""}
                          onChange={(e) =>
                            setTrackingByOrder((prev) => ({
                              ...prev,
                              [o.receiptId]: e.target.value,
                            }))
                          }
                          placeholder="Tracking #"
                          className="h-9"
                        />
                      </div>
                      <div className="w-full space-y-1 sm:w-40">
                        <label className="text-xs font-medium text-muted-foreground">Carrier</label>
                        <Select
                          value={carrierByOrder[o.receiptId] || "usps"}
                          onValueChange={(v) =>
                            setCarrierByOrder((prev) => ({ ...prev, [o.receiptId]: v }))
                          }
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ETSY_COMMON_CARRIERS.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        size="sm"
                        className="h-9 shrink-0"
                        onClick={() => void handleFulfill(o)}
                        disabled={fulfillingId === o.receiptId}
                      >
                        {fulfillingId === o.receiptId ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Truck className="mr-1 h-4 w-4" />
                            Mark shipped
                          </>
                        )}
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function EtsyOrdersPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading…
        </div>
      }
    >
      <EtsyOrdersContent />
    </Suspense>
  );
}
