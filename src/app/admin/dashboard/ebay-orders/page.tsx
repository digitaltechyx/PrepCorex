"use client";

import React, { Suspense, useState, useMemo, useEffect, useCallback } from "react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { useSearchParams, useRouter } from "next/navigation";
import { useManagedUsers } from "@/hooks/use-managed-users";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { hasRole } from "@/lib/permissions";
import { formatUserDisplayName } from "@/lib/format-user-display";
import { ShoppingBag, Users, ChevronsUpDown, RefreshCw, Truck, Loader2, Tag, Package } from "lucide-react";
import type { UserProfile } from "@/types";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { EbayQuickFulfillDialog } from "@/components/admin/ebay-quick-fulfill-dialog";
import {
  saveBuyLabelEbayPrefill,
  ebayShipToBuyLabelsAddress,
  loadEbayLabelFulfillHandoff,
  clearEbayLabelFulfillHandoff,
  type EbayShipToStored,
} from "@/lib/ebay-order-buy-label-prefill";

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
  connectionId?: string;
  creationDate?: string | null;
  lastModifiedDate?: string | null;
  orderFulfillmentStatus?: string | null;
  orderPaymentStatus?: string | null;
  buyer?: { email?: string; fullName?: string } | null;
  shipTo?: EbayShipToStored | null;
  lineItems?: LineItem[];
  syncedAt?: string;
};

function EbayOrdersContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const userId = searchParams.get("userId");
  const { user: authUser } = useAuth();
  const { toast } = useToast();
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [orders, setOrders] = useState<EbayOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [fulfillDialog, setFulfillDialog] = useState<{ order: EbayOrder } | null>(null);
  const [fulfilling, setFulfilling] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState("");
  const [carrierCode, setCarrierCode] = useState("");
  const [quickFulfillOrder, setQuickFulfillOrder] = useState<EbayOrder | null>(null);
  const [labelHandoff, setLabelHandoff] = useState<{
    inventoryProductId?: string | null;
    trackingNumber?: string | null;
    trackingCompany?: string | null;
    labelPrice?: number | null;
    labelPurchaseId?: string | null;
  } | null>(null);

  const { managedUsers: users, loading: usersLoading } = useManagedUsers();
  const selectableUsers = useMemo(() => {
    return users
      .filter((u) => hasRole(u, "user") || hasRole(u, "commission_agent"))
      .filter((u) => u.status === "approved" || !u.status)
      .filter((u) => u.status !== "deleted")
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [users]);

  const selectedUser = useMemo(() => {
    if (userId) return selectableUsers.find((u) => u.uid === userId);
    return selectableUsers[0];
  }, [userId, selectableUsers]);

  const handleUserSelect = (user: UserProfile) => {
    router.push(`/admin/dashboard/ebay-orders?userId=${user.uid}`);
    setUserDialogOpen(false);
    setUserSearchQuery("");
  };

  const fetchOrders = useCallback(async () => {
    if (!selectedUser?.uid || !authUser) {
      setOrders([]);
      return;
    }
    setOrdersLoading(true);
    try {
      const token = await authUser.getIdToken();
      const res = await fetch(`/api/integrations/ebay/orders?userId=${encodeURIComponent(selectedUser.uid)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load orders");
      setOrders(Array.isArray(data.orders) ? data.orders : []);
    } catch {
      setOrders([]);
    } finally {
      setOrdersLoading(false);
    }
  }, [selectedUser?.uid, authUser]);

  useEffect(() => {
    if (!selectedUser?.uid || !authUser) {
      setOrders([]);
      return;
    }
    fetchOrders();
  }, [selectedUser?.uid, authUser, fetchOrders]);

  // Return from Buy Labels → open Quick Fulfill with tracking/product.
  useEffect(() => {
    const fromBuyLabels = searchParams.get("from") === "buy-labels";
    const orderIdParam = searchParams.get("orderId")?.trim();
    if (!fromBuyLabels || !orderIdParam || orders.length === 0) return;
    const handoff = loadEbayLabelFulfillHandoff();
    const match = orders.find((o) => (o.orderId || o.id) === orderIdParam);
    if (match) {
      setQuickFulfillOrder(match);
      setLabelHandoff(
        handoff
          ? {
              inventoryProductId: handoff.inventoryProductId,
              trackingNumber: handoff.trackingNumber,
              trackingCompany: handoff.trackingCompany,
              labelPrice: handoff.labelPrice,
              labelPurchaseId: handoff.labelPurchaseId,
            }
          : null
      );
      clearEbayLabelFulfillHandoff();
    }
  }, [searchParams, orders]);

  const handleSync = async () => {
    if (!selectedUser?.uid || !authUser) return;
    setSyncing(true);
    try {
      const token = await authUser.getIdToken();
      const res = await fetch(`/api/integrations/ebay/orders?userId=${encodeURIComponent(selectedUser.uid)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Sync failed");
      toast({
        title: "Orders synced",
        description: `Fetched ${data.totalFetched ?? 0} order(s), saved ${data.totalSaved ?? 0} for selected listings.`,
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

  const canFulfill = (order: EbayOrder) => {
    const status = order.orderFulfillmentStatus ?? "";
    if (status === "FULFILLED") return false;
    const items = order.lineItems ?? [];
    return items.some(
      (li) => li.lineItemFulfillmentStatus === "NOT_STARTED" || li.lineItemFulfillmentStatus === "IN_PROGRESS"
    );
  };

  const openFulfillDialog = (order: EbayOrder) => {
    setFulfillDialog({ order });
    setTrackingNumber("");
    setCarrierCode("");
  };

  const handleMarkShipped = async () => {
    if (!authUser || !fulfillDialog || !selectedUser?.uid) return;
    const order = fulfillDialog.order;
    const orderId = order.orderId ?? order.id;
    const lineItems = (order.lineItems ?? []).filter(
      (li) =>
        li.lineItemId &&
        (li.lineItemFulfillmentStatus === "NOT_STARTED" || li.lineItemFulfillmentStatus === "IN_PROGRESS")
    );
    if (lineItems.length === 0) {
      toast({ variant: "destructive", title: "No items to ship", description: "All line items are already fulfilled." });
      return;
    }

    setFulfilling(true);
    try {
      const token = await authUser.getIdToken();
      const body: {
        orderId: string;
        lineItems: Array<{ lineItemId: string; quantity: number }>;
        shippingCarrierCode?: string;
        trackingNumber?: string;
        userId: string;
      } = {
        orderId,
        userId: selectedUser.uid,
        lineItems: lineItems.map((li) => ({
          lineItemId: li.lineItemId!,
          quantity: li.quantity ?? 1,
        })),
      };
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
      if (!res.ok) throw new Error(data.error || "Fulfillment failed");
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

  const openBuyLabels = (order: EbayOrder) => {
    if (!selectedUser?.uid) return;
    const orderId = order.orderId ?? order.id;
    const connectionId = order.connectionId?.trim();
    if (!connectionId) {
      toast({
        variant: "destructive",
        title: "Missing connection",
        description: "Sync this order again so the eBay connection id is stored.",
      });
      return;
    }
    const toAddress = ebayShipToBuyLabelsAddress(order.shipTo, {
      customerName: order.buyer?.fullName,
      email: order.buyer?.email,
    });
    saveBuyLabelEbayPrefill({
      orderId,
      connectionId,
      ownerUserId: selectedUser.uid,
      ownerName: formatUserDisplayName(selectedUser, { showEmail: true }),
      customerName: order.buyer?.fullName ?? null,
      email: order.buyer?.email ?? null,
      toAddress,
      lineItems: (order.lineItems ?? []).map((li) => ({
        title: li.title || li.sku || li.lineItemId || "Item",
        sku: li.sku ?? null,
        quantity: li.quantity ?? 1,
      })),
    });
    if (!toAddress) {
      toast({
        title: "Opening Buy Labels",
        description: "No ship-to address on this order — enter it manually on Buy Labels.",
      });
    }
    router.push("/admin/dashboard/buy-labels?from=ebay");
  };

  const formatDate = (raw: string | null | undefined) => {
    if (!raw) return "—";
    try {
      return format(new Date(raw), "PPp");
    } catch {
      return raw;
    }
  };

  return (
    <Card className="min-w-0 overflow-hidden border-2 shadow-xl">
      <CardHeader className="bg-gradient-to-r from-amber-600 to-orange-700 pb-3 text-white sm:pb-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-lg font-bold text-white sm:text-2xl">
              <ShoppingBag className="h-5 w-5 shrink-0 sm:h-6 sm:w-6" />
              eBay Orders
            </CardTitle>
            <CardDescription className="mt-1 text-xs text-amber-100 sm:mt-2 sm:text-sm">
              {selectedUser
                ? `View and fulfill eBay orders for ${selectedUser.name || selectedUser.email || "this user"}`
                : "Select a user to view their eBay orders"}
            </CardDescription>
          </div>
          <div className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm sm:flex">
            <ShoppingBag className="h-7 w-7 text-white" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 sm:p-6">
        <div className="mb-4 border-b pb-4 sm:mb-6 sm:pb-6">
          <div className="flex flex-col items-stretch justify-between gap-2 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-medium sm:text-sm">Select User:</span>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-1 sm:flex-row">
              {usersLoading ? (
                <Skeleton className="h-10 w-full sm:h-11 sm:w-[300px]" />
              ) : (
                <Dialog open={userDialogOpen} onOpenChange={setUserDialogOpen}>
                  <DialogTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 w-full justify-between sm:h-11 sm:w-[300px]"
                    >
                      <span className="mr-2 flex-1 truncate text-left">
                        {selectedUser
                          ? formatUserDisplayName(selectedUser, { showEmail: true })
                          : selectableUsers.length === 0
                            ? "No users"
                            : "Select user"}
                      </span>
                      <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="w-[calc(100%-1.5rem)] p-0 sm:max-w-lg">
                    <DialogTitle className="sr-only">Select user</DialogTitle>
                    <div className="border-b p-3">
                      <Input
                        placeholder="Search users..."
                        value={userSearchQuery}
                        onChange={(e) => setUserSearchQuery(e.target.value)}
                      />
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                      {selectableUsers
                        .filter(
                          (u) =>
                            !userSearchQuery.trim() ||
                            (u.name || "").toLowerCase().includes(userSearchQuery.trim().toLowerCase()) ||
                            (u.email || "").toLowerCase().includes(userSearchQuery.trim().toLowerCase()) ||
                            (u.clientId || "").toLowerCase().includes(userSearchQuery.trim().toLowerCase())
                        )
                        .map((u) => (
                          <div
                            key={u.uid}
                            role="button"
                            tabIndex={0}
                            className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-accent ${
                              selectedUser?.uid === u.uid ? "bg-accent" : ""
                            }`}
                            onClick={() => handleUserSelect(u)}
                          >
                            <span className="flex-1 truncate">
                              {formatUserDisplayName(u, { showEmail: true })}
                            </span>
                            {selectedUser?.uid === u.uid && <span className="text-primary">✓</span>}
                          </div>
                        ))}
                    </div>
                  </DialogContent>
                </Dialog>
              )}
              {selectedUser && (
                <Button className="w-full sm:w-auto" onClick={handleSync} disabled={syncing} variant="secondary" size="sm">
                  {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Sync orders
                </Button>
              )}
            </div>
          </div>
        </div>

        {!selectedUser ? (
          <p className="text-muted-foreground text-center py-8">Select a user to see their eBay orders.</p>
        ) : ordersLoading ? (
          <Skeleton className="h-64 w-full rounded-xl" />
        ) : orders.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            No eBay orders yet. User should connect eBay in Integrations, select listings, then sync orders here.
          </p>
        ) : (
          <ul className="space-y-1.5 sm:space-y-4">
            {orders.map((order) => (
              <li key={order.id} className="rounded-lg border bg-card px-2.5 py-2 shadow-sm sm:rounded-xl sm:p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                  <div className="min-w-0">
                    <p className="break-all font-mono text-sm font-medium sm:text-base">{order.orderId ?? order.id}</p>
                    <p className="text-xs text-muted-foreground sm:text-sm">Created {formatDate(order.creationDate ?? undefined)}</p>
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
                  <div className="shrink-0 flex flex-col gap-2">
                    {canFulfill(order) ? (
                      <>
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => {
                            setLabelHandoff(null);
                            setQuickFulfillOrder(order);
                          }}
                        >
                          <Package className="h-4 w-4 mr-1" />
                          Quick Fulfill
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => openBuyLabels(order)}>
                          <Tag className="h-4 w-4 mr-1" />
                          Buy Labels
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => openFulfillDialog(order)}>
                          <Truck className="h-4 w-4 mr-1" />
                          Mark shipped
                        </Button>
                      </>
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

      <EbayQuickFulfillDialog
        open={!!quickFulfillOrder}
        onOpenChange={(open) => {
          if (!open) {
            setQuickFulfillOrder(null);
            setLabelHandoff(null);
          }
        }}
        order={quickFulfillOrder}
        ownerUserId={selectedUser?.uid || ""}
        getAuthToken={async () => {
          if (!authUser) throw new Error("Not signed in");
          return authUser.getIdToken();
        }}
        labelHandoff={labelHandoff}
        onCompleted={() => {
          setQuickFulfillOrder(null);
          setLabelHandoff(null);
          void fetchOrders();
        }}
      />
    </Card>
  );
}

export default function AdminEbayOrdersPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
      <EbayOrdersContent />
    </Suspense>
  );
}
