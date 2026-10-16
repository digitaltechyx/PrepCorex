"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useManagedUsers } from "@/hooks/use-managed-users";
import { hasRole } from "@/lib/permissions";
import { formatUserDisplayName } from "@/lib/format-user-display";
import type { AdminAmazonOrder } from "@/lib/amazon-admin-orders";
import type { UserProfile } from "@/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AmazonOrderDetailBody } from "@/components/integrations/amazon-order-detail";
import { AmazonQuickFulfillDialog } from "@/components/admin/amazon-quick-fulfill-dialog";
import { AmazonFbaInboundCreateDialog } from "@/components/admin/amazon-fba-inbound-create-dialog";
import { Eye, Loader2, Package, Plus, RefreshCw, Search, ShoppingBag, Truck, Users } from "lucide-react";

type StatusFilter = "all" | "open" | "shipped";
type AmazonPanelTab = "fbm" | "fba" | "fba-inventory" | "fba-inbound";

type FbaInventoryRow = {
  sellerSku: string;
  fnSku: string | null;
  asin: string | null;
  productName: string | null;
  fulfillableQuantity: number;
  totalQuantity: number;
  inboundWorkingQuantity: number;
};

type FbaInboundRow = {
  inboundPlanId: string;
  name: string | null;
  status: string | null;
  createdAt: string | null;
  sourceAddressLabel?: string | null;
};

function inboundPlanTitle(plan: FbaInboundRow) {
  if (plan.name?.trim()) return plan.name.trim();
  if (plan.createdAt) return `FBA inbound · ${formatWhen(plan.createdAt)}`;
  return "FBA inbound plan";
}

function formatWhen(raw?: string | null) {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return format(d, "PPp");
}

function isOpenOrder(order: AdminAmazonOrder) {
  const s = (order.orderStatus || "").toLowerCase();
  return s === "unshipped" || s === "partiallyshipped" || s === "pending";
}

export function AmazonOrdersPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlUserId = searchParams.get("userId")?.trim() || "";
  const userFilter = urlUserId && urlUserId !== "all" ? urlUserId : "all";

  const { user } = useAuth();
  const { toast } = useToast();
  const { managedUsers: users, loading: usersLoading } = useManagedUsers();

  const [orders, setOrders] = useState<AdminAmazonOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<AmazonPanelTab>("fbm");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [detailsOrder, setDetailsOrder] = useState<AdminAmazonOrder | null>(null);
  const [fulfillDialogOpen, setFulfillDialogOpen] = useState(false);
  const [fulfillOrder, setFulfillOrder] = useState<AdminAmazonOrder | null>(null);
  const [inboundCreateOpen, setInboundCreateOpen] = useState(false);

  const [fbaLoading, setFbaLoading] = useState(false);
  const [fbaInventory, setFbaInventory] = useState<FbaInventoryRow[]>([]);
  const [fbaInbound, setFbaInbound] = useState<FbaInboundRow[]>([]);

  const selectableUsers = useMemo(
    () =>
      users
        .filter((u) => hasRole(u, "user") || hasRole(u, "commission_agent"))
        .filter((u) => u.status === "approved" || !u.status)
        .filter((u) => u.status !== "deleted")
        .sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [users]
  );

  const selectedUser = useMemo(() => {
    if (userFilter === "all") return null;
    return selectableUsers.find((u) => u.uid === userFilter) || null;
  }, [userFilter, selectableUsers]);

  const filteredClients = useMemo(() => {
    const q = userSearchQuery.trim().toLowerCase();
    if (!q) return selectableUsers;
    return selectableUsers.filter((u) => {
      const name = formatUserDisplayName(u).toLowerCase();
      const email = String(u.email || "").toLowerCase();
      const clientId = String(u.clientId || "").toLowerCase();
      return name.includes(q) || email.includes(q) || clientId.includes(q);
    });
  }, [selectableUsers, userSearchQuery]);

  const handleUserSelect = (profile: UserProfile | null) => {
    if (!profile) router.push("/admin/dashboard/amazon-orders?userId=all");
    else router.push(`/admin/dashboard/amazon-orders?userId=${encodeURIComponent(profile.uid)}`);
    setUserDialogOpen(false);
    setUserSearchQuery("");
  };

  const fetchOrders = useCallback(
    async (source: "cache" | "live" = "cache") => {
      if (!user) return;
      setLoading(true);
      try {
        const token = await user.getIdToken();
        const params = new URLSearchParams({ userId: userFilter, source });
        const res = await fetch(`/api/admin/amazon/orders?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            [data.error, ...(Array.isArray(data.errors) ? data.errors.slice(0, 2) : [])]
              .filter(Boolean)
              .join(" — ") || "Failed to load orders"
          );
        }
        setOrders(Array.isArray(data.orders) ? data.orders : []);
        if (source === "live" && Array.isArray(data.errors) && data.errors.length) {
          toast({
            variant: "destructive",
            title: "Some accounts could not sync",
            description: data.errors.slice(0, 2).join("; "),
          });
        }
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
    },
    [user, userFilter, toast]
  );

  const fetchFba = useCallback(async () => {
    if (!user || userFilter === "all") {
      setFbaInventory([]);
      setFbaInbound([]);
      return;
    }
    setFbaLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/amazon/fba?userId=${encodeURIComponent(userFilter)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data.error as string) || "Failed to load FBA data");
      setFbaInventory(Array.isArray(data.inventory) ? data.inventory : []);
      setFbaInbound(Array.isArray(data.inboundPlans) ? data.inboundPlans : []);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "FBA load failed",
        description: e instanceof Error ? e.message : "Could not load FBA inventory/inbound.",
      });
      setFbaInventory([]);
      setFbaInbound([]);
    } finally {
      setFbaLoading(false);
    }
  }, [user, userFilter, toast]);

  useEffect(() => {
    void fetchOrders("cache");
  }, [fetchOrders]);

  useEffect(() => {
    if (userFilter !== "all") void fetchFba();
    else {
      setFbaInventory([]);
      setFbaInbound([]);
    }
  }, [userFilter, fetchFba]);

  const fbaInventoryCount = fbaInventory.length;
  const fbaInboundCount = fbaInbound.length;
  const fbaOpsCountsReady = userFilter !== "all" && !fbaLoading;

  const applySearchAndStatus = useCallback(
    (list: AdminAmazonOrder[]) => {
      const q = search.trim().toLowerCase();
      return list.filter((o) => {
        if (statusFilter === "open" && !isOpenOrder(o)) return false;
        if (statusFilter === "shipped" && isOpenOrder(o)) return false;
        if (!q) return true;
        const hay = [
          o.amazonOrderId,
          o.storeName,
          o.ownerName,
          o.ownerEmail,
          ...o.lineItems.map((li) => li.sellerSku || li.title),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    },
    [search, statusFilter]
  );

  const fbmOrders = useMemo(
    () => applySearchAndStatus(orders.filter((o) => !o.isFba)),
    [orders, applySearchAndStatus]
  );
  const fbaOrders = useMemo(
    () => applySearchAndStatus(orders.filter((o) => o.isFba)),
    [orders, applySearchAndStatus]
  );
  const fbmCount = useMemo(() => orders.filter((o) => !o.isFba).length, [orders]);
  const fbaCount = useMemo(() => orders.filter((o) => o.isFba).length, [orders]);

  useEffect(() => {
    if (activeTab !== "fbm" && activeTab !== "fba") return;
    if (activeTab === "fbm" && fbmCount === 0 && fbaCount > 0) setActiveTab("fba");
    if (activeTab === "fba" && fbaCount === 0 && fbmCount > 0) setActiveTab("fbm");
  }, [activeTab, fbmCount, fbaCount]);

  const renderOrderList = (list: AdminAmazonOrder[], emptyLabel: string) => {
    if (loading || usersLoading) {
      return (
        <div className="flex items-center gap-2 text-muted-foreground py-8">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading orders…
        </div>
      );
    }
    if (list.length === 0) {
      return (
        <p className="text-sm text-muted-foreground py-8">
          {orders.length === 0
            ? "No Amazon orders found. Connect Amazon from Integrations and run Sync live."
            : emptyLabel}
        </p>
      );
    }
    return (
      <div className="space-y-1.5 sm:space-y-3">
        {list.map((order) => (
          <div key={`${order.ownerUserId}_${order.id}`} className="rounded-lg border px-2.5 py-2 sm:p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
              <div className="min-w-0 space-y-0.5 sm:space-y-1">
                <div className="flex flex-wrap items-center gap-1 sm:gap-2">
                  <p className="break-all text-sm font-semibold sm:text-base">{order.amazonOrderId}</p>
                  <Badge variant={order.isFba ? "secondary" : "outline"} className="text-[10px]">
                    {order.isFba ? "FBA" : "FBM"}
                  </Badge>
                  <Badge variant="outline" className="capitalize text-[10px]">
                    {order.orderStatus || "unknown"}
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground sm:text-xs">
                  {formatWhen(order.createdAt)} · {order.storeName} · {order.ownerName}
                </p>
                <p className="text-[11px] text-muted-foreground sm:text-xs">
                  {order.lineItems.length} line(s)
                  {order.orderTotal ? ` · ${order.currency || "USD"} ${order.orderTotal}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-1.5 sm:gap-2">
                <Button size="sm" variant="outline" className="h-8 flex-1 sm:flex-none" onClick={() => setDetailsOrder(order)}>
                  <Eye className="mr-1 h-3.5 w-3.5" />
                  Details
                </Button>
                {order.sellerFulfillable ? (
                  <Button
                    size="sm"
                    className="h-8 flex-1 sm:flex-none"
                    onClick={() => {
                      setFulfillOrder(order);
                      setFulfillDialogOpen(true);
                    }}
                  >
                    <Truck className="mr-1 h-3.5 w-3.5" />
                    Fulfill
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const handleSync = async () => {
    if (!user) return;
    setSyncing(true);
    await fetchOrders("live");
    setSyncing(false);
    toast({ title: "Amazon orders synced", description: "Pulled latest orders from SP-API." });
  };

  return (
    <div className="min-w-0 space-y-3 sm:space-y-6">
      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="p-3 sm:p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <ShoppingBag className="h-5 w-5 shrink-0 text-orange-600" />
                Amazon Orders
              </CardTitle>
              <CardDescription className="mt-0.5 text-xs sm:mt-1 sm:text-sm">
                FBM + FBA orders, quick fulfill for merchant-fulfilled (MFN), and FBA inventory/inbound views.
              </CardDescription>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
              <Dialog open={userDialogOpen} onOpenChange={setUserDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="w-full justify-start sm:w-auto">
                    <Users className="mr-2 h-4 w-4" />
                    <span className="truncate">{selectedUser ? formatUserDisplayName(selectedUser) : "All clients"}</span>
                  </Button>
                </DialogTrigger>
                <DialogContent className="w-[calc(100%-1.5rem)] max-w-lg p-4 sm:p-6">
                  <DialogHeader>
                    <DialogTitle>Select client</DialogTitle>
                  </DialogHeader>
                  <Input
                    placeholder="Search clients…"
                    value={userSearchQuery}
                    onChange={(e) => setUserSearchQuery(e.target.value)}
                  />
                  <div className="max-h-64 overflow-y-auto space-y-1">
                    <Button variant="ghost" className="w-full justify-start" onClick={() => handleUserSelect(null)}>
                      All clients
                    </Button>
                    {filteredClients.map((u) => (
                      <Button
                        key={u.uid}
                        variant="ghost"
                        className="w-full justify-start"
                        onClick={() => handleUserSelect(u)}
                      >
                        {formatUserDisplayName(u)}
                      </Button>
                    ))}
                  </div>
                </DialogContent>
              </Dialog>
              <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => void handleSync()} disabled={syncing || loading}>
                {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                Sync live
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-3 sm:p-6">
          <Tabs
            value={activeTab}
            onValueChange={(v) => {
              const tab = v as AmazonPanelTab;
              setActiveTab(tab);
              if (tab === "fba-inventory" || tab === "fba-inbound") void fetchFba();
            }}
          >
            <TabsList className="mb-3 grid h-auto w-full grid-cols-2 gap-0.5 p-0.5 sm:mb-4 sm:flex sm:h-10 sm:flex-wrap sm:gap-0 sm:p-1">
              <TabsTrigger value="fbm" className="gap-1 px-1.5 text-[11px] sm:gap-2 sm:px-3 sm:text-sm">
                FBM
                <Badge
                  variant={activeTab === "fbm" ? "default" : "secondary"}
                  className="h-4 min-w-4 px-1 text-[9px] tabular-nums sm:h-5 sm:min-w-5 sm:px-1.5 sm:text-[10px]"
                >
                  {fbmCount}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="fba" className="gap-1 px-1.5 text-[11px] sm:gap-2 sm:px-3 sm:text-sm">
                FBA
                <Badge
                  variant={activeTab === "fba" ? "default" : "secondary"}
                  className="h-4 min-w-4 px-1 text-[9px] tabular-nums sm:h-5 sm:min-w-5 sm:px-1.5 sm:text-[10px]"
                >
                  {fbaCount}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="fba-inventory" className="gap-1 px-1.5 text-[11px] sm:gap-2 sm:px-3 sm:text-sm">
                Inventory
                <Badge
                  variant={activeTab === "fba-inventory" ? "default" : "secondary"}
                  className="h-4 min-w-4 px-1 text-[9px] tabular-nums sm:h-5 sm:min-w-5 sm:px-1.5 sm:text-[10px]"
                >
                  {userFilter === "all" ? "—" : fbaOpsCountsReady ? fbaInventoryCount : "…"}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="fba-inbound" className="gap-1 px-1.5 text-[11px] sm:gap-2 sm:px-3 sm:text-sm">
                Inbound
                <Badge
                  variant={activeTab === "fba-inbound" ? "default" : "secondary"}
                  className="h-4 min-w-4 px-1 text-[9px] tabular-nums sm:h-5 sm:min-w-5 sm:px-1.5 sm:text-[10px]"
                >
                  {userFilter === "all" ? "—" : fbaOpsCountsReady ? fbaInboundCount : "…"}
                </Badge>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="fbm" className="space-y-4 mt-0">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="Search order ID, SKU, client…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                  <SelectTrigger className="w-full sm:w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All status</SelectItem>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="shipped">Shipped</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {renderOrderList(fbmOrders, "No FBM orders match your filters.")}
            </TabsContent>

            <TabsContent value="fba" className="space-y-4 mt-0">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="Search order ID, SKU, client…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                  <SelectTrigger className="w-full sm:w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All status</SelectItem>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="shipped">Shipped</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {renderOrderList(fbaOrders, "No FBA orders match your filters.")}
            </TabsContent>

            <TabsContent value="fba-inventory" className="mt-4">
              {userFilter === "all" ? (
                <p className="text-sm text-muted-foreground py-6">
                  Select a single client to view FBA stock at Amazon fulfillment centers.
                </p>
              ) : fbaLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground py-8">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Loading FBA inventory…
                </div>
              ) : fbaInventory.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6">No FBA inventory rows returned.</p>
              ) : (
                <div className="space-y-1.5 md:hidden">
                  {fbaInventory.map((row) => (
                    <div key={row.sellerSku} className="rounded-lg border px-2.5 py-2">
                      <p className="break-all text-sm font-medium">{row.sellerSku}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        ASIN {row.asin || "—"} · Fulfillable {row.fulfillableQuantity} · Total{" "}
                        {row.totalQuantity} · Inbound {row.inboundWorkingQuantity}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-3">SKU</th>
                        <th className="py-2 pr-3">ASIN</th>
                        <th className="py-2 pr-3">Fulfillable</th>
                        <th className="py-2 pr-3">Total</th>
                        <th className="py-2">Inbound working</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fbaInventory.map((row) => (
                        <tr key={row.sellerSku} className="border-b">
                          <td className="py-2 pr-3 font-medium">{row.sellerSku}</td>
                          <td className="py-2 pr-3">{row.asin || "—"}</td>
                          <td className="py-2 pr-3">{row.fulfillableQuantity}</td>
                          <td className="py-2 pr-3">{row.totalQuantity}</td>
                          <td className="py-2">{row.inboundWorkingQuantity}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="fba-inbound" className="mt-4">
              {userFilter === "all" ? (
                <p className="text-sm text-muted-foreground py-6">
                  Select a single client to view inbound shipment plans to Amazon FCs.
                </p>
              ) : (
                <div className="flex justify-end mb-3">
                  <Button size="sm" onClick={() => setInboundCreateOpen(true)} disabled={fbaLoading}>
                    <Plus className="h-4 w-4 mr-2" />
                    Create inbound plan
                  </Button>
                </div>
              )}
              {userFilter === "all" ? null : fbaLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground py-8">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Loading inbound plans…
                </div>
              ) : fbaInbound.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6">No inbound plans returned.</p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground mb-3">
                    Inbound plans are restock shipments into Amazon FCs. Creation is admin-only;
                    clients can view synced plans here if enabled later.
                  </p>
                  <div className="space-y-2">
                    {fbaInbound.map((plan) => (
                      <div key={plan.inboundPlanId} className="rounded-lg border p-3 flex items-center gap-3">
                        <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm">{inboundPlanTitle(plan)}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            <Badge variant="outline" className="text-[10px] mr-1 capitalize">
                              {plan.status || "unknown"}
                            </Badge>
                            {plan.sourceAddressLabel ? (
                              <>Ship from {plan.sourceAddressLabel}</>
                            ) : (
                              <>Created {formatWhen(plan.createdAt)}</>
                            )}
                          </p>
                          <p className="text-[10px] text-muted-foreground/70 font-mono truncate mt-0.5" title={plan.inboundPlanId}>
                            Plan {plan.inboundPlanId}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={!!detailsOrder} onOpenChange={(open) => !open && setDetailsOrder(null)}>
        <DialogContent className="max-h-[85vh] w-[calc(100%-1.5rem)] max-w-lg overflow-y-auto p-4 sm:p-6">
          <DialogHeader className="text-left">
            <DialogTitle className="break-all text-base sm:text-lg">Order {detailsOrder?.amazonOrderId}</DialogTitle>
          </DialogHeader>
          {detailsOrder ? <AmazonOrderDetailBody order={detailsOrder} /> : null}
        </DialogContent>
      </Dialog>

      <AmazonQuickFulfillDialog
        open={fulfillDialogOpen}
        onOpenChange={setFulfillDialogOpen}
        order={fulfillOrder}
        getAuthToken={async () => {
          if (!user) throw new Error("Not signed in");
          return user.getIdToken();
        }}
        onCompleted={() => void fetchOrders("cache")}
      />

      <AmazonFbaInboundCreateDialog
        open={inboundCreateOpen}
        onOpenChange={setInboundCreateOpen}
        clientUserId={userFilter}
        clientLabel={selectedUser ? formatUserDisplayName(selectedUser) : undefined}
        fbaInventory={fbaInventory}
        getAuthToken={async () => {
          if (!user) throw new Error("Not signed in");
          return user.getIdToken();
        }}
        onCompleted={() => void fetchFba()}
      />
    </div>
  );
}
