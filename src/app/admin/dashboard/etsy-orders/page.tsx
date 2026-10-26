"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import type { UserProfile } from "@/types";
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
import { formatUserDisplayName } from "@/lib/format-user-display";
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

function EtsyOrdersAdminContent() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const userIdParam = searchParams.get("userId")?.trim() || "";

  const { data: users, loading: usersLoading } = useCollection<UserProfile>("users");
  const selectableUsers = useMemo(
    () => (users ?? []).filter((u) => u.role === "user" || !u.role),
    [users]
  );

  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [orders, setOrders] = useState<EtsyOrderRow[]>([]);
  const [connections, setConnections] = useState<EtsyConnectionSummary[]>([]);
  const [shopFilter, setShopFilter] = useState("");
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [trackingByOrder, setTrackingByOrder] = useState<Record<string, string>>({});
  const [carrierByOrder, setCarrierByOrder] = useState<Record<string, string>>({});
  const [fulfillingId, setFulfillingId] = useState<string | null>(null);

  useEffect(() => {
    if (!userIdParam || !selectableUsers.length) return;
    const match = selectableUsers.find((u) => u.uid === userIdParam);
    if (match) setSelectedUser(match);
  }, [userIdParam, selectableUsers]);

  const handleUserSelect = (u: UserProfile) => {
    setSelectedUser(u);
    setShopFilter("");
    router.push(`/admin/dashboard/etsy-orders?userId=${u.uid}`);
  };

  const filteredUsers = useMemo(() => {
    const q = userSearchQuery.trim().toLowerCase();
    if (!q) return selectableUsers.slice(0, 40);
    return selectableUsers
      .filter((u) => {
        const name = formatUserDisplayName(u).toLowerCase();
        const email = (u.email || "").toLowerCase();
        const clientId = (u.clientId || "").toLowerCase();
        return name.includes(q) || email.includes(q) || clientId.includes(q);
      })
      .slice(0, 40);
  }, [selectableUsers, userSearchQuery]);

  const fetchData = useCallback(async () => {
    if (!user || !selectedUser?.uid) return;
    setOrdersLoading(true);
    try {
      const token = await user.getIdToken();
      const connRes = await fetch(
        `/api/integrations/etsy-connections?userId=${encodeURIComponent(selectedUser.uid)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      let conns: EtsyConnectionSummary[] = [];
      if (connRes.ok) {
        const data = await connRes.json();
        conns = data.connections ?? [];
        setConnections(conns);
      } else {
        setConnections([]);
      }

      const activeId = shopFilter || conns[0]?.id || "";
      if (!activeId) {
        setOrders([]);
        return;
      }
      if (!shopFilter && activeId) setShopFilter(activeId);

      const ordersRes = await fetch(
        `/api/etsy/orders?connectionId=${encodeURIComponent(activeId)}&userId=${encodeURIComponent(selectedUser.uid)}`,
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
      setOrdersLoading(false);
    }
  }, [user, selectedUser?.uid, shopFilter, toast]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleFulfill = async (order: EtsyOrderRow) => {
    if (!user || !selectedUser?.uid || !shopFilter) return;
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
          userId: selectedUser.uid,
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
        description: `Receipt #${order.receiptId} marked shipped.`,
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
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Etsy Orders</h1>
          <p className="text-sm text-muted-foreground">
            View unshipped paid receipts and mark shipped with tracking.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void fetchData()}
          disabled={ordersLoading || !selectedUser}
        >
          {ordersLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Clients</CardTitle>
            <CardDescription>Select a user with an Etsy connection.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="Search name, email, client ID…"
              value={userSearchQuery}
              onChange={(e) => setUserSearchQuery(e.target.value)}
            />
            {usersLoading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading users…
              </div>
            ) : (
              <ul className="max-h-[28rem] space-y-1 overflow-y-auto">
                {filteredUsers.map((u) => {
                  const active = selectedUser?.uid === u.uid;
                  return (
                    <li key={u.uid}>
                      <button
                        type="button"
                        onClick={() => handleUserSelect(u)}
                        className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                          active
                            ? "border-orange-300 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/40"
                            : "hover:bg-muted/50"
                        }`}
                      >
                        <p className="truncate font-medium">{formatUserDisplayName(u)}</p>
                        <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShoppingBag className="h-4 w-4" />
              Open orders
            </CardTitle>
            <CardDescription>
              {selectedUser
                ? `Paid, not shipped · ${formatUserDisplayName(selectedUser)}`
                : "Select a user to see their Etsy orders."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!selectedUser ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Select a user to see their Etsy orders.
              </p>
            ) : connections.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                This user has no Etsy shop connected.
              </p>
            ) : (
              <>
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

                {ordersLoading ? (
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
                              <label className="text-xs font-medium text-muted-foreground">
                                Carrier
                              </label>
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
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function AdminEtsyOrdersPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading…
        </div>
      }
    >
      <EtsyOrdersAdminContent />
    </Suspense>
  );
}
