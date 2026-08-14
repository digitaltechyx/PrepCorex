"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, RefreshCw, Truck } from "lucide-react";
import { format } from "date-fns";

type LineItem = {
  lineItemId?: string;
  legacyItemId?: string;
  sku?: string;
  title?: string;
  quantity?: number;
  lineItemFulfillmentStatus?: string;
};

type EbayOrder = {
  id: string;
  orderId?: string;
  creationDate?: string | null;
  lastModifiedDate?: string | null;
  orderFulfillmentStatus?: string | null;
  orderPaymentStatus?: string | null;
  buyer?: { email?: string; fullName?: string } | null;
  lineItems?: LineItem[];
  syncedAt?: string;
};

export default function EbayOrdersPage() {
  const searchParams = useSearchParams();
  const connectionId = searchParams.get("connectionId")?.trim() || undefined;
  const { user } = useAuth();
  const { toast } = useToast();
  const [orders, setOrders] = useState<EbayOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [fulfillDialog, setFulfillDialog] = useState<{ order: EbayOrder } | null>(null);
  const [fulfilling, setFulfilling] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState("");
  const [carrierCode, setCarrierCode] = useState("");

  const fetchOrders = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const url = connectionId
        ? `/api/integrations/ebay/orders?connectionId=${encodeURIComponent(connectionId)}`
        : "/api/integrations/ebay/orders";
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data.error as string) || "Failed to load orders");
      }
      const data = await res.json();
      setOrders(data.orders ?? []);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e instanceof Error ? e.message : "Failed to load eBay orders.",
      });
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [user, toast, connectionId]);

  useEffect(() => {
    if (user) fetchOrders();
  }, [user, fetchOrders]);

  const handleSync = async () => {
    if (!user) return;
    setSyncing(true);
    try {
      const token = await user.getIdToken();
      const url = connectionId
        ? `/api/integrations/ebay/orders?connectionId=${encodeURIComponent(connectionId)}`
        : "/api/integrations/ebay/orders";
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data.error as string) || "Sync failed");
      }
      toast({
        title: "Orders synced",
        description: `Fetched ${data.totalFetched ?? 0} order(s), saved ${data.totalSaved ?? 0} for your selected listings.`,
      });
      fetchOrders();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Sync failed",
        description: e instanceof Error ? e.message : "Could not sync eBay orders.",
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleMarkShipped = async () => {
    if (!user || !fulfillDialog) return;
    const order = fulfillDialog.order;
    const orderId = order.orderId ?? order.id;
    const lineItems = (order.lineItems ?? []).filter(
      (li) => li.lineItemId && (li.lineItemFulfillmentStatus === "NOT_STARTED" || li.lineItemFulfillmentStatus === "IN_PROGRESS")
    );
    if (lineItems.length === 0) {
      toast({ variant: "destructive", title: "No items to ship", description: "All line items are already fulfilled." });
      return;
    }

    setFulfilling(true);
    try {
      const token = await user.getIdToken();
      const body: {
        orderId: string;
        lineItems: Array<{ lineItemId: string; quantity: number }>;
        shippingCarrierCode?: string;
        trackingNumber?: string;
        connectionId?: string;
      } = {
        orderId,
        lineItems: lineItems.map((li) => ({
          lineItemId: li.lineItemId!,
          quantity: li.quantity ?? 1,
        })),
      };
      if (connectionId) body.connectionId = connectionId;
      const tn = trackingNumber.trim().replace(/\s/g, "");
      const cc = carrierCode.trim();
      if (tn && cc) {
        body.trackingNumber = tn;
        body.shippingCarrierCode = cc;
      }

      const res = await fetch("/api/integrations/ebay/fulfillment", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data.error as string) || "Fulfillment failed");
      }
      toast({ title: "Marked as shipped", description: "eBay order fulfillment was recorded." });
      setFulfillDialog(null);
      setTrackingNumber("");
      setCarrierCode("");
      fetchOrders();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e instanceof Error ? e.message : "Could not mark as shipped.",
      });
    } finally {
      setFulfilling(false);
    }
  };

  const openFulfillDialog = (order: EbayOrder) => {
    setFulfillDialog({ order });
    setTrackingNumber("");
    setCarrierCode("");
  };

  const formatDate = (raw: string | null | undefined) => {
    if (!raw) return "—";
    try {
      return format(new Date(raw), "PPp");
    } catch {
      return raw;
    }
  };

  const canFulfill = (order: EbayOrder) => {
    const status = order.orderFulfillmentStatus ?? "";
    if (status === "FULFILLED") return false;
    const items = order.lineItems ?? [];
    return items.some(
      (li) => li.lineItemFulfillmentStatus === "NOT_STARTED" || li.lineItemFulfillmentStatus === "IN_PROGRESS"
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Link
                  href="/dashboard/ebay-orders"
                  className="text-muted-foreground hover:text-foreground sr-only"
                >
                  eBay Orders
                </Link>
                <Link
                  href="/dashboard/integrations"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Link>
                eBay Orders
              </CardTitle>
              <CardDescription>
                Orders for your selected eBay listings. Sync to pull the latest from eBay, then mark as shipped when you
                fulfill. Existing connections must reconnect once so PrepCorex gets write access for quantity updates
                and fulfillment.
              </CardDescription>
            </div>
            <Button onClick={handleSync} disabled={syncing || !user}>
              {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Sync orders
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading orders…
            </div>
          ) : orders.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center">
              <p className="text-sm text-muted-foreground">No eBay orders yet.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Select listings in Manage listings, then click &quot;Sync orders&quot; to pull orders from eBay.
              </p>
            </div>
          ) : (
            <ul className="space-y-4">
              {orders.map((order) => (
                <li
                  key={order.id}
                  className="rounded-xl border bg-card p-4 shadow-sm"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono font-medium">{order.orderId ?? order.id}</p>
                      <p className="text-sm text-muted-foreground">
                        Created {formatDate(order.creationDate ?? undefined)}
                      </p>
                      {order.buyer?.fullName && (
                        <p className="text-sm text-muted-foreground">Buyer: {order.buyer.fullName}</p>
                      )}
                      <ul className="mt-2 space-y-1 text-sm">
                        {(order.lineItems ?? []).map((li, i) => (
                          <li key={li.lineItemId ?? i}>
                            {li.title ?? li.sku ?? li.lineItemId} × {li.quantity ?? 1}
                            {li.lineItemFulfillmentStatus && (
                              <span className="text-muted-foreground ml-2">({li.lineItemFulfillmentStatus})</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="shrink-0">
                      {canFulfill(order) ? (
                        <Button variant="outline" size="sm" onClick={() => openFulfillDialog(order)}>
                          <Truck className="h-4 w-4 mr-1" />
                          Mark shipped
                        </Button>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          {order.orderFulfillmentStatus === "FULFILLED" ? "Fulfilled" : "—"}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!fulfillDialog} onOpenChange={(open) => !open && setFulfillDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark order as shipped</DialogTitle>
            <DialogDescription>
              Optionally add tracking number and carrier. eBay accepts alphanumeric tracking only (no spaces or hyphens).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Tracking number (optional)</Label>
              <Input
                placeholder="e.g. 1Z999AA10123456784"
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Carrier code (optional, required if tracking provided)</Label>
              <Input
                placeholder="e.g. USPS, UPS, FEDEX"
                value={carrierCode}
                onChange={(e) => setCarrierCode(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setFulfillDialog(null)}>
                Cancel
              </Button>
              <Button onClick={handleMarkShipped} disabled={fulfilling}>
                {fulfilling ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Mark shipped
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
