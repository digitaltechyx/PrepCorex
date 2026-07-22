"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import type { UserProfile } from "@/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { formatUserDisplayName } from "@/lib/format-user-display";
import { Loader2, ShoppingBag, Truck } from "lucide-react";

type TikTokOrderRow = {
  id: string;
  status: string | null;
  createTime: number | null;
  connectionId?: string;
  shopName?: string;
};

type TikTokConnectionSummary = {
  id: string;
  shopName?: string;
  shopId?: string;
};

function TikTokOrdersAdminContent() {
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
  const [orders, setOrders] = useState<TikTokOrderRow[]>([]);
  const [connections, setConnections] = useState<TikTokConnectionSummary[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [fulfillingId, setFulfillingId] = useState<string | null>(null);
  const [trackingByOrder, setTrackingByOrder] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!userIdParam || !selectableUsers.length) return;
    const match = selectableUsers.find((u) => u.uid === userIdParam);
    if (match) setSelectedUser(match);
  }, [userIdParam, selectableUsers]);

  const handleUserSelect = (u: UserProfile) => {
    setSelectedUser(u);
    router.push(`/admin/dashboard/tiktok-orders?userId=${u.uid}`);
  };

  const fetchOrders = useCallback(async () => {
    if (!user || !selectedUser?.uid) return;
    setOrdersLoading(true);
    try {
      const token = await user.getIdToken();
      const [connRes, ordersRes] = await Promise.all([
        fetch(`/api/integrations/tiktok-connections?userId=${encodeURIComponent(selectedUser.uid)}`, {
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => null),
        fetch(`/api/tiktok/orders?userId=${encodeURIComponent(selectedUser.uid)}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      if (!ordersRes.ok) {
        const data = await ordersRes.json().catch(() => ({}));
        throw new Error(
          [data.error, data.detail].filter(Boolean).join(" — ") || "Failed to load orders"
        );
      }
      const data = await ordersRes.json();
      setOrders(Array.isArray(data.orders) ? data.orders : []);
      setConnections(Array.isArray(data.connections) ? data.connections : []);
      if (connRes?.ok) {
        const c = await connRes.json();
        if (Array.isArray(c.connections)) setConnections(c.connections);
      }
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e instanceof Error ? e.message : "Failed to load TikTok orders.",
      });
      setOrders([]);
    } finally {
      setOrdersLoading(false);
    }
  }, [user, selectedUser?.uid, toast]);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  const handleFulfill = async (order: TikTokOrderRow) => {
    if (!user || !selectedUser?.uid || !order.connectionId) return;
    const trackingNumber = (trackingByOrder[order.id] || "").trim();
    if (!trackingNumber) {
      toast({
        variant: "destructive",
        title: "Tracking required",
        description: "Enter a tracking number before marking shipped.",
      });
      return;
    }
    setFulfillingId(order.id);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/tiktok/fulfill", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          userId: selectedUser.uid,
          connectionId: order.connectionId,
          orderId: order.id,
          trackingNumber,
        }),
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
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShoppingBag className="h-5 w-5 text-fuchsia-600" />
                TikTok Shop Orders
              </CardTitle>
              <CardDescription>
                View client TikTok orders and mark shipped with tracking (admin only).
              </CardDescription>
            </div>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">
                  {selectedUser
                    ? formatUserDisplayName(selectedUser, { showEmail: true })
                    : "Select user"}
                </Button>
              </DialogTrigger>
              <DialogContent className="p-0">
                <DialogHeader className="p-4 pb-0">
                  <DialogTitle>Select user</DialogTitle>
                </DialogHeader>
                <div className="p-3 border-b">
                  <Input
                    placeholder="Search users..."
                    value={userSearchQuery}
                    onChange={(e) => setUserSearchQuery(e.target.value)}
                  />
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {usersLoading ? (
                    <div className="p-4 text-sm text-muted-foreground">Loading users…</div>
                  ) : (
                    selectableUsers
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
                          className={`flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent cursor-pointer ${
                            selectedUser?.uid === u.uid ? "bg-accent" : ""
                          }`}
                          onClick={() => handleUserSelect(u)}
                        >
                          <span className="truncate flex-1">
                            {formatUserDisplayName(u, { showEmail: true })}
                          </span>
                          {selectedUser?.uid === u.uid && <span className="text-primary">✓</span>}
                        </div>
                      ))
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {!selectedUser ? (
            <p className="text-muted-foreground text-center py-8">
              Select a user to see their TikTok Shop orders.
            </p>
          ) : ordersLoading ? (
            <Skeleton className="h-64 w-full rounded-xl" />
          ) : connections.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              This user has no TikTok Shop connected.
            </p>
          ) : orders.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No TikTok orders found for this user.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {orders.map((o) => (
                <li key={`${o.connectionId}-${o.id}`} className="space-y-3 p-3 sm:p-4">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-mono text-sm font-medium">{o.id}</p>
                      <p className="text-xs text-muted-foreground">
                        {o.createTime
                          ? new Date(Number(o.createTime) * 1000).toLocaleString()
                          : "—"}
                        {o.shopName ? ` · ${o.shopName}` : ""}
                      </p>
                    </div>
                    <Badge variant="outline">{String(o.status ?? "—")}</Badge>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <div className="flex-1 space-y-1">
                      <Label htmlFor={`track-${o.id}`} className="text-xs">
                        Tracking number
                      </Label>
                      <Input
                        id={`track-${o.id}`}
                        placeholder="Tracking number"
                        value={trackingByOrder[o.id] ?? ""}
                        onChange={(e) =>
                          setTrackingByOrder((prev) => ({ ...prev, [o.id]: e.target.value }))
                        }
                      />
                    </div>
                    <Button
                      size="sm"
                      className="shrink-0"
                      disabled={fulfillingId === o.id || !o.connectionId}
                      onClick={() => void handleFulfill(o)}
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

export default function AdminTikTokOrdersPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
      <TikTokOrdersAdminContent />
    </Suspense>
  );
}
