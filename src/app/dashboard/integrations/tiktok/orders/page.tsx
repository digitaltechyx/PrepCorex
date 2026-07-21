"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, ShoppingBag, Truck } from "lucide-react";

type TikTokOrderRow = {
  id: string;
  status: string | null;
  createTime: number | null;
  lineItems: unknown;
};

export default function TikTokOrdersPage() {
  const searchParams = useSearchParams();
  const connectionId = searchParams.get("connectionId") ?? "";
  const { user } = useAuth();
  const { toast } = useToast();
  const [orders, setOrders] = useState<TikTokOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [shopName, setShopName] = useState("TikTok Shop");
  const [fulfillingId, setFulfillingId] = useState<string | null>(null);
  const [trackingByOrder, setTrackingByOrder] = useState<Record<string, string>>({});

  const fetchOrders = useCallback(async () => {
    if (!user || !connectionId) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/tiktok/orders?connectionId=${encodeURIComponent(connectionId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        throw new Error([data.error, data.detail].filter(Boolean).join(" — ") || "Failed to load orders");
      }
      const data = await res.json();
      setOrders(data.orders ?? []);
      if (data.shopName) setShopName(data.shopName);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e instanceof Error ? e.message : "Failed to load orders.",
      });
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [user, connectionId, toast]);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  const handleFulfill = async (orderId: string) => {
    if (!user || !connectionId) return;
    const trackingNumber = (trackingByOrder[orderId] || "").trim();
    if (!trackingNumber) {
      toast({
        variant: "destructive",
        title: "Tracking required",
        description: "Enter a tracking number before marking shipped.",
      });
      return;
    }
    setFulfillingId(orderId);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/tiktok/fulfill", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ connectionId, orderId, trackingNumber }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          [data.error, data.detail, data.altDetail].filter(Boolean).join(" — ") || "Fulfill failed"
        );
      }
      toast({ title: "Shipped", description: `Tracking ${trackingNumber} sent to TikTok.` });
      void fetchOrders();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Fulfill failed",
        description: e instanceof Error ? e.message : "Could not update delivery status.",
      });
    } finally {
      setFulfillingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard/integrations">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Integrations
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link
            href={`/dashboard/integrations/tiktok/products?connectionId=${encodeURIComponent(connectionId)}`}
          >
            Products
          </Link>
        </Button>
        <Button variant="outline" size="sm" onClick={() => void fetchOrders()} disabled={loading}>
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5" />
            TikTok orders
          </CardTitle>
          <CardDescription>
            Recent orders from {shopName} (last 30 days). Enter tracking and mark shipped to push delivery status.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading orders…
            </div>
          ) : orders.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No orders found.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {orders.map((o) => (
                <li key={o.id} className="space-y-3 p-3 sm:p-4">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium font-mono text-sm">{o.id}</p>
                      <p className="text-xs text-muted-foreground">
                        {o.createTime
                          ? new Date(Number(o.createTime) * 1000).toLocaleString()
                          : "—"}
                      </p>
                    </div>
                    <span className="text-sm text-muted-foreground">{String(o.status ?? "—")}</span>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <div className="flex-1 space-y-1">
                      <Label htmlFor={`track-${o.id}`} className="text-xs">
                        Tracking number
                      </Label>
                      <Input
                        id={`track-${o.id}`}
                        placeholder="e.g. 1Z999..."
                        value={trackingByOrder[o.id] ?? ""}
                        onChange={(e) =>
                          setTrackingByOrder((prev) => ({ ...prev, [o.id]: e.target.value }))
                        }
                      />
                    </div>
                    <Button
                      size="sm"
                      className="shrink-0"
                      disabled={fulfillingId === o.id}
                      onClick={() => void handleFulfill(o.id)}
                    >
                      {fulfillingId === o.id ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Truck className="mr-1 h-3.5 w-3.5" />
                      )}
                      Mark shipped
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
