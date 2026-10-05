"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useManagedUsers } from "@/hooks/use-managed-users";
import { hasRole } from "@/lib/permissions";
import { formatUserDisplayName } from "@/lib/format-user-display";
import type { UserProfile } from "@/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  ChevronsUpDown,
  Eye,
  Loader2,
  Package,
  RefreshCw,
  Search,
  Ship,
  Users,
  X,
} from "lucide-react";
import { format } from "date-fns";

export type VeeqoOrderRow = {
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
  shipmentId?: number | null;
  labelShipDate?: string | null;
  modifyDate?: string | null;
  orderDate?: string | null;
  createDate?: string | null;
  syncedAt?: string;
  connectionId?: string;
  allocationId?: number | null;
  allocationIds?: number[];
  shipTo?: {
    name?: string;
    company?: string;
    street1?: string;
    street2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    phone?: string;
  } | null;
  items?: Array<{
    sku?: string;
    name?: string;
    quantity?: number;
    unitPrice?: number;
  }>;
};

type ConnectionSummary = {
  id: string;
  accountLabel?: string;
  lastSyncedAt?: unknown;
  lastSyncOrderCount?: number | null;
  lastSyncLabeledCount?: number | null;
  apiKeyHint?: string | null;
};

type VeeqoRate = {
  carrier: string;
  name: string;
  title?: string;
  title_with_price?: string;
  total_net_charge?: string | number;
  base_rate?: string | number;
  remote_shipment_id?: string;
  sub_carrier_id?: string;
  service_carrier?: string;
  expected_delivery_days?: number | null;
  shipping_service_options?: Array<{
    key: string;
    label?: string;
    values?: Array<{ value: string; label?: string; price?: number }>;
  }>;
};

type LabelFilter = "all" | "labeled" | "open";

type VeeqoOrdersPanelProps = {
  mode: "user" | "admin";
  backHref?: string;
  backLabel?: string;
};

function formatWhen(raw?: string | null) {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return format(d, "PPp");
}

function formatMoney(value?: number | string | null) {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  return `$${n.toFixed(2)}`;
}

function formatShipTo(shipTo?: VeeqoOrderRow["shipTo"]) {
  if (!shipTo) return [];
  const lines: string[] = [];
  const nameLine = [shipTo.name, shipTo.company].filter(Boolean).join(" · ");
  if (nameLine) lines.push(nameLine);
  if (shipTo.street1) lines.push(shipTo.street1);
  if (shipTo.street2) lines.push(shipTo.street2);
  const cityLine = [shipTo.city, shipTo.state, shipTo.postalCode].filter(Boolean).join(", ");
  if (cityLine) lines.push(cityLine);
  if (shipTo.country) lines.push(shipTo.country);
  if (shipTo.phone) lines.push(`Phone: ${shipTo.phone}`);
  return lines;
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2 text-sm sm:grid-cols-[140px_1fr]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words font-medium text-foreground">{value || "—"}</dd>
    </div>
  );
}

export function VeeqoOrdersPanel({
  mode,
  backHref,
  backLabel = "Integrations",
}: VeeqoOrdersPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialConnectionId = searchParams.get("connectionId")?.trim() || "";
  const urlUserId = searchParams.get("userId")?.trim() || "";

  const { user } = useAuth();
  const { toast } = useToast();

  const [orders, setOrders] = useState<VeeqoOrderRow[]>([]);
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const [search, setSearch] = useState("");
  const [labelFilter, setLabelFilter] = useState<LabelFilter>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [connectionFilter, setConnectionFilter] = useState<string>(initialConnectionId || "all");

  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [detailsOrder, setDetailsOrder] = useState<VeeqoOrderRow | null>(null);

  const [buyOrder, setBuyOrder] = useState<VeeqoOrderRow | null>(null);
  const [pkgWeight, setPkgWeight] = useState("16");
  const [pkgWidth, setPkgWidth] = useState("10");
  const [pkgHeight, setPkgHeight] = useState("6");
  const [pkgDepth, setPkgDepth] = useState("4");
  const [ratesLoading, setRatesLoading] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [rates, setRates] = useState<VeeqoRate[]>([]);
  const [rateErrors, setRateErrors] = useState<string[]>([]);
  const [selectedRateKey, setSelectedRateKey] = useState<string>("");
  const [activeAllocationId, setActiveAllocationId] = useState<number | null>(null);

  const { managedUsers: users } = useManagedUsers();

  const selectableUsers = useMemo(() => {
    if (mode !== "admin") return [];
    return users
      .filter((u) => hasRole(u, "user") || hasRole(u, "commission_agent"))
      .filter((u) => u.status === "approved" || !u.status)
      .filter((u) => u.status !== "deleted")
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [mode, users]);

  const selectedUser = useMemo(() => {
    if (mode !== "admin") return null;
    if (urlUserId) return selectableUsers.find((u) => u.uid === urlUserId) || null;
    return selectableUsers[0] || null;
  }, [mode, urlUserId, selectableUsers]);

  const targetUserId = mode === "admin" ? selectedUser?.uid : undefined;

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

  const handleUserSelect = (profile: UserProfile) => {
    router.push(`/admin/dashboard/veeqo-orders?userId=${encodeURIComponent(profile.uid)}`);
    setUserDialogOpen(false);
    setUserSearchQuery("");
    setConnectionFilter("all");
  };

  const fetchConnections = useCallback(async () => {
    if (!user) return;
    if (mode === "admin" && !targetUserId) {
      setConnections([]);
      return;
    }
    try {
      const token = await user.getIdToken();
      const params = new URLSearchParams();
      if (mode === "admin" && targetUserId) params.set("userId", targetUserId);
      const res = await fetch(`/api/integrations/veeqo-connections?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load connections");
      setConnections(Array.isArray(data.connections) ? data.connections : []);
    } catch {
      setConnections([]);
    }
  }, [user, mode, targetUserId]);

  const fetchOrders = useCallback(async () => {
    if (!user) return;
    if (mode === "admin" && !targetUserId) {
      setOrders([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const params = new URLSearchParams();
      if (mode === "admin" && targetUserId) params.set("userId", targetUserId);
      if (connectionFilter && connectionFilter !== "all") {
        params.set("connectionId", connectionFilter);
      }
      const res = await fetch(`/api/integrations/veeqo/orders?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load orders");
      setOrders(data.orders ?? []);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e instanceof Error ? e.message : "Failed to load Veeqo orders.",
      });
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [user, toast, mode, targetUserId, connectionFilter]);

  useEffect(() => {
    if (user) void fetchConnections();
  }, [user, fetchConnections]);

  useEffect(() => {
    if (user) void fetchOrders();
  }, [user, fetchOrders]);

  useEffect(() => {
    if (initialConnectionId) setConnectionFilter(initialConnectionId);
  }, [initialConnectionId]);

  const handleSync = async () => {
    if (!user) return;
    if (mode === "admin" && !targetUserId) return;
    setSyncing(true);
    try {
      const token = await user.getIdToken();
      const body: { connectionId?: string; userId?: string } = {};
      if (connectionFilter && connectionFilter !== "all") body.connectionId = connectionFilter;
      if (mode === "admin" && targetUserId) body.userId = targetUserId;
      const res = await fetch("/api/integrations/veeqo/orders", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Sync failed");
      toast({
        title: "Veeqo synced",
        description: `${data.synced ?? 0} orders · ${data.withLabels ?? 0} labeled · ${data.openCount ?? 0} open`,
      });
      await Promise.all([fetchOrders(), fetchConnections()]);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Sync failed",
        description: e instanceof Error ? e.message : "Could not sync Veeqo.",
      });
    } finally {
      setSyncing(false);
    }
  };

  const openBuyLabel = (order: VeeqoOrderRow) => {
    setBuyOrder(order);
    setRates([]);
    setRateErrors([]);
    setSelectedRateKey("");
    setActiveAllocationId(order.allocationId ?? order.allocationIds?.[0] ?? null);
  };

  const handleGetRates = async () => {
    if (!user || !buyOrder?.connectionId || !buyOrder.orderId) return;
    setRatesLoading(true);
    setRateErrors([]);
    setRates([]);
    setSelectedRateKey("");
    try {
      const token = await user.getIdToken();
      const body: Record<string, unknown> = {
        connectionId: buyOrder.connectionId,
        orderId: buyOrder.orderId,
        allocationId: activeAllocationId || buyOrder.allocationId || undefined,
        package: {
          weight: Number(pkgWeight),
          width: Number(pkgWidth),
          height: Number(pkgHeight),
          depth: Number(pkgDepth),
          weightUnit: "oz",
          dimensionsUnit: "inches",
        },
      };
      if (mode === "admin" && targetUserId) body.userId = targetUserId;
      const res = await fetch("/api/integrations/veeqo/rates", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to get rates");
      const available: VeeqoRate[] = Array.isArray(data.available) ? data.available : [];
      setRates(available);
      setActiveAllocationId(data.allocationId ?? activeAllocationId);
      setRateErrors(
        Array.isArray(data.errorMessages)
          ? data.errorMessages.map((m: unknown) => String(m))
          : []
      );
      if (available[0]) {
        setSelectedRateKey(`${available[0].carrier}::${available[0].name}`);
      }
      if (available.length === 0) {
        toast({
          variant: "destructive",
          title: "No rates",
          description: "Veeqo returned no available rates for this package.",
        });
      }
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Rates failed",
        description: e instanceof Error ? e.message : "Could not fetch rates.",
      });
    } finally {
      setRatesLoading(false);
    }
  };

  const handlePurchase = async () => {
    if (!user || !buyOrder?.connectionId || !buyOrder.orderId || !activeAllocationId) return;
    const rate = rates.find((r) => `${r.carrier}::${r.name}` === selectedRateKey);
    if (!rate) {
      toast({
        variant: "destructive",
        title: "Select a rate",
        description: "Choose a shipping rate before purchasing.",
      });
      return;
    }
    setPurchasing(true);
    try {
      const token = await user.getIdToken();
      const body: Record<string, unknown> = {
        connectionId: buyOrder.connectionId,
        orderId: buyOrder.orderId,
        allocationId: activeAllocationId,
        rate,
      };
      if (mode === "admin" && targetUserId) body.userId = targetUserId;
      const res = await fetch("/api/integrations/veeqo/purchase-label", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Purchase failed");
      toast({
        title: "Label purchased",
        description: data.order?.trackingNumber
          ? `Tracking ${data.order.trackingNumber}`
          : "Label bought on your Veeqo account.",
      });
      setBuyOrder(null);
      await fetchOrders();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Purchase failed",
        description: e instanceof Error ? e.message : "Could not buy label.",
      });
    } finally {
      setPurchasing(false);
    }
  };

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) {
      if (o.orderStatus) set.add(String(o.orderStatus));
    }
    return Array.from(set).sort();
  }, [orders]);

  const connectionLabel = useCallback(
    (id?: string) => {
      if (!id) return "—";
      const c = connections.find((x) => x.id === id);
      return c?.accountLabel || "Veeqo";
    },
    [connections]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (labelFilter === "labeled" && !o.hasPurchasedLabel) return false;
      if (labelFilter === "open" && o.hasPurchasedLabel) return false;
      if (statusFilter !== "all" && String(o.orderStatus || "") !== statusFilter) return false;
      if (!q) return true;
      const hay = [
        o.orderNumber,
        o.orderId,
        o.customerName,
        o.customerEmail,
        o.trackingNumber,
        o.carrierCode,
        o.orderStatus,
        ...(o.items || []).flatMap((i) => [i.sku, i.name]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [orders, search, labelFilter, statusFilter]);

  const labeledCount = orders.filter((o) => o.hasPurchasedLabel).length;
  const syncDisabled =
    syncing || !user || (mode === "admin" && !targetUserId) || connections.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {backHref ? (
            <Button variant="ghost" size="sm" className="mb-2 -ml-2 h-8 px-2" asChild>
              <Link href={backHref}>
                <ArrowLeft className="mr-1 h-4 w-4" />
                {backLabel}
              </Link>
            </Button>
          ) : null}
          <h1 className="text-2xl font-bold tracking-tight">Veeqo Orders</h1>
          <p className="text-sm text-muted-foreground">
            Sync Veeqo orders and buy shipping labels (billed on your Veeqo account).
          </p>
        </div>
        <Button onClick={() => void handleSync()} disabled={syncDisabled}>
          {syncing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Sync now
        </Button>
      </div>

      {mode === "admin" ? (
        <Card>
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">Client</p>
              <p className="text-sm text-muted-foreground">
                {selectedUser ? formatUserDisplayName(selectedUser) : "Select a client"}
              </p>
            </div>
            <Dialog open={userDialogOpen} onOpenChange={setUserDialogOpen}>
              <Button variant="outline" onClick={() => setUserDialogOpen(true)}>
                <Users className="mr-2 h-4 w-4" />
                Change client
                <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
              </Button>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Select client</DialogTitle>
                  <DialogDescription>View Veeqo orders for a client account.</DialogDescription>
                </DialogHeader>
                <Input
                  placeholder="Search name, email, client ID…"
                  value={userSearchQuery}
                  onChange={(e) => setUserSearchQuery(e.target.value)}
                  className="mb-2"
                />
                <div className="max-h-72 space-y-1 overflow-y-auto">
                  {filteredClients.map((u) => (
                    <button
                      key={u.uid}
                      type="button"
                      className="flex w-full flex-col rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => handleUserSelect(u)}
                    >
                      <span className="font-medium">{formatUserDisplayName(u)}</span>
                      <span className="text-xs text-muted-foreground">{u.email}</span>
                    </button>
                  ))}
                </div>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {orders.length} orders
            {labeledCount > 0 ? ` · ${labeledCount} labeled` : ""}
          </CardTitle>
          <CardDescription>
            {connections.length === 0
              ? "Connect Veeqo from Integrations to sync orders."
              : "Filter and buy labels for open orders."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search order #, customer, SKU, tracking…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={labelFilter} onValueChange={(v) => setLabelFilter(v as LabelFilter)}>
              <SelectTrigger className="w-full sm:w-[160px]">
                <SelectValue placeholder="Label" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All labels</SelectItem>
                <SelectItem value="open">Needs label</SelectItem>
                <SelectItem value="labeled">Labeled</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {statusOptions.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {connections.length > 1 ? (
              <Select value={connectionFilter} onValueChange={setConnectionFilter}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="Account" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All accounts</SelectItem>
                  {connections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.accountLabel || "Veeqo"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {(search || labelFilter !== "all" || statusFilter !== "all") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setLabelFilter("all");
                  setStatusFilter("all");
                }}
              >
                <X className="mr-1 h-4 w-4" />
                Clear
              </Button>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading…
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
              <Package className="h-8 w-8 opacity-40" />
              <p className="font-medium">No orders to show</p>
              <p className="text-sm">Sync from Veeqo or adjust filters.</p>
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
                          <Badge variant="secondary">No label</Badge>
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
                    <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
                      <div className="text-left sm:text-right">
                        {order.orderTotal != null && (
                          <p className="font-semibold">{formatMoney(order.orderTotal)}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          Order: {formatWhen(order.orderDate)}
                        </p>
                        {order.hasPurchasedLabel && order.trackingNumber ? (
                          <p className="mt-1 text-xs">
                            Track: <span className="font-medium">{order.trackingNumber}</span>
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {!order.hasPurchasedLabel && order.connectionId && order.orderId ? (
                          <Button
                            size="sm"
                            className="h-8"
                            onClick={() => openBuyLabel(order)}
                          >
                            <Ship className="mr-1.5 h-3.5 w-3.5" />
                            Buy label
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8"
                          onClick={() => setDetailsOrder(order)}
                        >
                          <Eye className="mr-1.5 h-3.5 w-3.5" />
                          Details
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!detailsOrder} onOpenChange={(open) => !open && setDetailsOrder(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Order #{detailsOrder?.orderNumber || detailsOrder?.orderId || "—"}
            </DialogTitle>
            <DialogDescription>Veeqo order, ship-to, items, and label details.</DialogDescription>
          </DialogHeader>
          {detailsOrder ? (
            <div className="space-y-5">
              <dl className="space-y-1.5 rounded-lg border bg-muted/20 p-3">
                <DetailRow label="Status" value={detailsOrder.orderStatus} />
                <DetailRow label="Allocation" value={detailsOrder.allocationId} />
                <DetailRow label="Customer" value={detailsOrder.customerName} />
                <DetailRow label="Email" value={detailsOrder.customerEmail} />
                <DetailRow label="Total" value={formatMoney(detailsOrder.orderTotal)} />
                <DetailRow label="Tracking" value={detailsOrder.trackingNumber} />
                <DetailRow
                  label="Account"
                  value={connectionLabel(detailsOrder.connectionId)}
                />
              </dl>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Ship to</h3>
                <div className="rounded-lg border bg-muted/20 p-3 text-sm">
                  {formatShipTo(detailsOrder.shipTo).length > 0 ? (
                    formatShipTo(detailsOrder.shipTo).map((line) => <p key={line}>{line}</p>)
                  ) : (
                    <p className="text-muted-foreground">No ship-to address.</p>
                  )}
                </div>
              </section>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={!!buyOrder} onOpenChange={(open) => !open && setBuyOrder(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Buy label · #{buyOrder?.orderNumber || buyOrder?.orderId}
            </DialogTitle>
            <DialogDescription>
              Set package size, get Veeqo rates, then purchase. Label cost bills to the Veeqo
              account (payment method required in Veeqo).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="space-y-1.5">
                <Label>Weight (oz)</Label>
                <Input value={pkgWeight} onChange={(e) => setPkgWeight(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Width (in)</Label>
                <Input value={pkgWidth} onChange={(e) => setPkgWidth(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Height (in)</Label>
                <Input value={pkgHeight} onChange={(e) => setPkgHeight(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Depth (in)</Label>
                <Input value={pkgDepth} onChange={(e) => setPkgDepth(e.target.value)} />
              </div>
            </div>
            <Button onClick={() => void handleGetRates()} disabled={ratesLoading || purchasing}>
              {ratesLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Get rates
            </Button>
            {rateErrors.length > 0 ? (
              <p className="text-xs text-amber-700">{rateErrors.slice(0, 2).join(" · ")}</p>
            ) : null}
            {rates.length > 0 ? (
              <div className="space-y-2">
                <Label>Select rate</Label>
                <div className="max-h-56 space-y-2 overflow-y-auto">
                  {rates.map((r) => {
                    const key = `${r.carrier}::${r.name}`;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setSelectedRateKey(key)}
                        className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm ${
                          selectedRateKey === key
                            ? "border-primary bg-primary/5"
                            : "hover:bg-muted/40"
                        }`}
                      >
                        <span className="min-w-0 truncate font-medium">
                          {r.title_with_price || r.title || r.name}
                        </span>
                        <span className="ml-2 shrink-0 tabular-nums">
                          {formatMoney(r.total_net_charge)}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <Button
                  className="w-full"
                  onClick={() => void handlePurchase()}
                  disabled={purchasing || !selectedRateKey}
                >
                  {purchasing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Ship className="mr-2 h-4 w-4" />
                  )}
                  Purchase label
                </Button>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
