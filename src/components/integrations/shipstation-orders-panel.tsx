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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  ChevronsUpDown,
  Eye,
  Loader2,
  Package,
  RefreshCw,
  Search,
  Users,
  X,
} from "lucide-react";
import { format } from "date-fns";

export type ShipStationOrderRow = {
  id: string;
  orderId?: number;
  orderNumber?: string;
  orderKey?: string;
  orderStatus?: string;
  customerName?: string | null;
  customerEmail?: string | null;
  orderTotal?: number | null;
  amountPaid?: number | null;
  shippingAmount?: number | null;
  hasPurchasedLabel?: boolean;
  trackingNumber?: string | null;
  carrierCode?: string | null;
  serviceCode?: string | null;
  shipmentId?: number | null;
  shipmentCost?: number | null;
  labelShipDate?: string | null;
  modifyDate?: string | null;
  orderDate?: string | null;
  createDate?: string | null;
  syncedAt?: string;
  connectionId?: string;
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

type LabelFilter = "all" | "labeled" | "open";
type DateField = "orderDate" | "labelShipDate" | "modifyDate" | "syncedAt";

type ShipStationOrdersPanelProps = {
  mode: "user" | "admin";
  /** Optional back link (user integrations). */
  backHref?: string;
  backLabel?: string;
};

function formatWhen(raw?: string | null) {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return format(d, "PPp");
}

function formatMoney(value?: number | null) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `$${Number(value).toFixed(2)}`;
}

function formatShipTo(shipTo?: ShipStationOrderRow["shipTo"]) {
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

function startOfDay(isoDate: string): Date | null {
  if (!isoDate) return null;
  const d = new Date(`${isoDate}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function endOfDay(isoDate: string): Date | null {
  if (!isoDate) return null;
  const d = new Date(`${isoDate}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pickDateValue(order: ShipStationOrderRow, field: DateField): string | null {
  if (field === "orderDate") return order.orderDate || null;
  if (field === "labelShipDate") return order.labelShipDate || null;
  if (field === "modifyDate") return order.modifyDate || null;
  return order.syncedAt || null;
}

export function ShipStationOrdersPanel({
  mode,
  backHref,
  backLabel = "Integrations",
}: ShipStationOrdersPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialConnectionId = searchParams.get("connectionId")?.trim() || "";
  const urlUserId = searchParams.get("userId")?.trim() || "";

  const { user } = useAuth();
  const { toast } = useToast();

  const [orders, setOrders] = useState<ShipStationOrderRow[]>([]);
  const [connections, setConnections] = useState<ConnectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const [search, setSearch] = useState("");
  const [labelFilter, setLabelFilter] = useState<LabelFilter>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [carrierFilter, setCarrierFilter] = useState<string>("all");
  const [connectionFilter, setConnectionFilter] = useState<string>(initialConnectionId || "all");
  const [dateField, setDateField] = useState<DateField>("orderDate");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [detailsOrder, setDetailsOrder] = useState<ShipStationOrderRow | null>(null);

  const { managedUsers: users, loading: usersLoading } = useManagedUsers();

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
    router.push(`/admin/dashboard/shipstation-orders?userId=${encodeURIComponent(profile.uid)}`);
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
      const res = await fetch(`/api/integrations/shipstation-connections?${params.toString()}`, {
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
  }, [user, toast, mode, targetUserId, connectionFilter]);

  useEffect(() => {
    if (user) void fetchConnections();
  }, [user, fetchConnections]);

  useEffect(() => {
    if (user) void fetchOrders();
  }, [user, fetchOrders]);

  // Keep the open page fresh while webhooks/cron update Firestore in the background.
  useEffect(() => {
    if (!user) return;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void fetchOrders();
    };
    const id = window.setInterval(tick, 45_000);
    return () => window.clearInterval(id);
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
      const res = await fetch("/api/integrations/shipstation/orders", {
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
        title: "ShipStation synced",
        description: `${data.synced ?? 0} orders · ${data.withLabels ?? 0} with purchased labels`,
      });
      await Promise.all([fetchOrders(), fetchConnections()]);
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

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) {
      if (o.orderStatus) set.add(String(o.orderStatus));
    }
    return Array.from(set).sort();
  }, [orders]);

  const carrierOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) {
      if (o.carrierCode) set.add(String(o.carrierCode));
    }
    return Array.from(set).sort();
  }, [orders]);

  const connectionLabel = useCallback(
    (id?: string) => {
      if (!id) return "—";
      const c = connections.find((x) => x.id === id);
      return c?.accountLabel || "ShipStation";
    },
    [connections]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const from = startOfDay(dateFrom);
    const to = endOfDay(dateTo);

    return orders.filter((o) => {
      if (labelFilter === "labeled" && !o.hasPurchasedLabel) return false;
      if (labelFilter === "open" && o.hasPurchasedLabel) return false;
      if (statusFilter !== "all" && String(o.orderStatus || "") !== statusFilter) return false;
      if (carrierFilter !== "all" && String(o.carrierCode || "") !== carrierFilter) return false;

      if (from || to) {
        const raw = pickDateValue(o, dateField);
        if (!raw) return false;
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
      }

      if (!q) return true;
      const hay = [
        o.orderNumber,
        o.orderId,
        o.customerName,
        o.customerEmail,
        o.trackingNumber,
        o.carrierCode,
        o.serviceCode,
        o.orderStatus,
        ...(o.items || []).flatMap((i) => [i.sku, i.name]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [orders, search, labelFilter, statusFilter, carrierFilter, dateFrom, dateTo, dateField]);

  const labeledCount = orders.filter((o) => o.hasPurchasedLabel).length;
  const hasActiveFilters =
    search.trim() !== "" ||
    labelFilter !== "all" ||
    statusFilter !== "all" ||
    carrierFilter !== "all" ||
    connectionFilter !== "all" ||
    dateFrom !== "" ||
    dateTo !== "" ||
    dateField !== "orderDate";

  const clearFilters = () => {
    setSearch("");
    setLabelFilter("all");
    setStatusFilter("all");
    setCarrierFilter("all");
    setConnectionFilter("all");
    setDateField("orderDate");
    setDateFrom("");
    setDateTo("");
  };

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
          <h1 className="text-2xl font-bold tracking-tight">ShipStation Orders</h1>
          <p className="text-sm text-muted-foreground">
            {mode === "admin"
              ? "View synced ShipStation orders and purchased labels for a client. Updates arrive automatically via webhooks (plus scheduled backup sync)."
              : "Orders sync automatically when ShipStation has new orders or shipments. Use Sync now if you need an immediate refresh."}
          </p>
        </div>
        <Button onClick={() => void handleSync()} disabled={syncDisabled}>
          {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Sync now
        </Button>
      </div>

      {mode === "admin" && (
        <Card>
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Client:</span>
              <span className="text-sm">
                {usersLoading
                  ? "Loading…"
                  : selectedUser
                    ? formatUserDisplayName(selectedUser)
                    : "No clients available"}
              </span>
              {selectedUser?.clientId ? (
                <Badge variant="outline" className="text-[10px]">
                  {selectedUser.clientId}
                </Badge>
              ) : null}
              {selectedUser?.email ? (
                <span className="hidden text-xs text-muted-foreground sm:inline">{selectedUser.email}</span>
              ) : null}
            </div>
            <Dialog open={userDialogOpen} onOpenChange={setUserDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={usersLoading || selectableUsers.length === 0}>
                  Change client
                  <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Select client</DialogTitle>
                  <DialogDescription>Filter ShipStation orders by client account.</DialogDescription>
                </DialogHeader>
                <Input
                  placeholder="Search name, email, or client ID…"
                  value={userSearchQuery}
                  onChange={(e) => setUserSearchQuery(e.target.value)}
                  className="mb-3"
                />
                <div className="max-h-[360px] space-y-1 overflow-y-auto">
                  {filteredClients.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">No matching clients</p>
                  ) : (
                    filteredClients.map((u) => (
                      <button
                        key={u.uid}
                        type="button"
                        className="flex w-full flex-col rounded-md px-3 py-2 text-left hover:bg-muted"
                        onClick={() => handleUserSelect(u)}
                      >
                        <span className="text-sm font-medium">{formatUserDisplayName(u)}</span>
                        <span className="text-xs text-muted-foreground">
                          {[u.email, u.clientId].filter(Boolean).join(" · ")}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      )}

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
            <CardDescription>Showing (filtered)</CardDescription>
            <CardTitle className="text-2xl">{visible.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="text-lg">Orders & labels</CardTitle>
              <CardDescription>
                Filter the list, then open <strong>View details</strong> for address, items, totals, and label info.
              </CardDescription>
            </div>
            {hasActiveFilters ? (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="mr-1 h-4 w-4" />
                Clear filters
              </Button>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <div className="space-y-1.5 sm:col-span-2 lg:col-span-1 xl:col-span-2">
              <Label htmlFor="ss-search">Search</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="ss-search"
                  placeholder="Order #, customer, email, tracking, SKU…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Label</Label>
              <Select value={labelFilter} onValueChange={(v: LabelFilter) => setLabelFilter(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All orders</SelectItem>
                  <SelectItem value="labeled">Purchased labels</SelectItem>
                  <SelectItem value="open">No SS label yet</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Order status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue />
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
            </div>

            <div className="space-y-1.5">
              <Label>Carrier</Label>
              <Select value={carrierFilter} onValueChange={setCarrierFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All carriers</SelectItem>
                  {carrierOptions.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>ShipStation account</Label>
              <Select value={connectionFilter} onValueChange={setConnectionFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All accounts</SelectItem>
                  {connections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.accountLabel || "ShipStation"}
                      {c.apiKeyHint ? ` (${c.apiKeyHint})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Date field</Label>
              <Select value={dateField} onValueChange={(v: DateField) => setDateField(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="orderDate">Order date</SelectItem>
                  <SelectItem value="labelShipDate">Label / ship date</SelectItem>
                  <SelectItem value="modifyDate">Last modified</SelectItem>
                  <SelectItem value="syncedAt">Last synced</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ss-from">From</Label>
              <Input
                id="ss-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ss-to">To</Label>
              <Input
                id="ss-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {mode === "admin" && !selectedUser && !usersLoading ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
              <Users className="h-8 w-8 opacity-40" />
              <p className="font-medium">Select a client</p>
              <p className="text-sm">Choose a client to load their ShipStation orders.</p>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading orders…
            </div>
          ) : connections.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
              <Package className="h-8 w-8 opacity-40" />
              <p className="font-medium">No ShipStation connection</p>
              <p className="text-sm">
                {mode === "admin"
                  ? "This client has not connected ShipStation yet."
                  : "Connect ShipStation from Integrations, then sync."}
              </p>
              {mode === "user" ? (
                <Button variant="outline" size="sm" className="mt-2" asChild>
                  <Link href="/dashboard/integrations">Go to Integrations</Link>
                </Button>
              ) : null}
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
              <Package className="h-8 w-8 opacity-40" />
              <p className="font-medium">No orders to show</p>
              <p className="text-sm">Sync from ShipStation or adjust filters.</p>
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
                        {connections.length > 1 && order.connectionId ? (
                          <Badge variant="outline" className="text-[10px]">
                            {connectionLabel(order.connectionId)}
                          </Badge>
                        ) : null}
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
                        <p className="text-xs text-muted-foreground">
                          Updated: {formatWhen(order.modifyDate || order.syncedAt)}
                        </p>
                        {order.hasPurchasedLabel && order.trackingNumber ? (
                          <p className="mt-1 text-xs">
                            Track: <span className="font-medium">{order.trackingNumber}</span>
                          </p>
                        ) : null}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => setDetailsOrder(order)}
                      >
                        <Eye className="mr-1.5 h-3.5 w-3.5" />
                        View details
                      </Button>
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
            <DialogDescription>
              Full ShipStation order, ship-to, items, and label details.
            </DialogDescription>
          </DialogHeader>

          {detailsOrder ? (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="capitalize">
                  {String(detailsOrder.orderStatus || "unknown").replace(/_/g, " ")}
                </Badge>
                {detailsOrder.hasPurchasedLabel ? (
                  <Badge className="border-0 bg-emerald-600 hover:bg-emerald-600/90">
                    Label purchased
                  </Badge>
                ) : (
                  <Badge variant="secondary">No SS label</Badge>
                )}
              </div>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Order</h3>
                <dl className="space-y-1.5 rounded-lg border bg-muted/20 p-3">
                  <DetailRow label="Order ID" value={detailsOrder.orderId} />
                  <DetailRow label="Order key" value={detailsOrder.orderKey} />
                  <DetailRow label="Order date" value={formatWhen(detailsOrder.orderDate)} />
                  <DetailRow label="Created" value={formatWhen(detailsOrder.createDate)} />
                  <DetailRow
                    label="Modified"
                    value={formatWhen(detailsOrder.modifyDate)}
                  />
                  <DetailRow label="Last synced" value={formatWhen(detailsOrder.syncedAt)} />
                  {detailsOrder.connectionId ? (
                    <DetailRow
                      label="Account"
                      value={connectionLabel(detailsOrder.connectionId)}
                    />
                  ) : null}
                </dl>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Customer</h3>
                <dl className="space-y-1.5 rounded-lg border bg-muted/20 p-3">
                  <DetailRow label="Name" value={detailsOrder.customerName} />
                  <DetailRow label="Email" value={detailsOrder.customerEmail} />
                </dl>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Ship to</h3>
                <div className="rounded-lg border bg-muted/20 p-3 text-sm">
                  {formatShipTo(detailsOrder.shipTo).length > 0 ? (
                    <div className="space-y-0.5">
                      {formatShipTo(detailsOrder.shipTo).map((line) => (
                        <p key={line}>{line}</p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground">No ship-to address on this order.</p>
                  )}
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Items</h3>
                <div className="overflow-hidden rounded-lg border">
                  {(detailsOrder.items || []).length === 0 ? (
                    <p className="p-3 text-sm text-muted-foreground">No line items.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">Item</th>
                          <th className="px-3 py-2 font-medium">SKU</th>
                          <th className="px-3 py-2 font-medium text-right">Qty</th>
                          <th className="px-3 py-2 font-medium text-right">Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detailsOrder.items || []).map((item, idx) => (
                          <tr key={`${item.sku || item.name || "item"}-${idx}`} className="border-t">
                            <td className="px-3 py-2">{item.name || "—"}</td>
                            <td className="px-3 py-2 text-muted-foreground">{item.sku || "—"}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {item.quantity ?? 1}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatMoney(item.unitPrice)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Totals</h3>
                <dl className="space-y-1.5 rounded-lg border bg-muted/20 p-3">
                  <DetailRow label="Order total" value={formatMoney(detailsOrder.orderTotal)} />
                  <DetailRow label="Amount paid" value={formatMoney(detailsOrder.amountPaid)} />
                  <DetailRow
                    label="Shipping"
                    value={formatMoney(detailsOrder.shippingAmount)}
                  />
                </dl>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Label / shipment</h3>
                <dl className="space-y-1.5 rounded-lg border bg-muted/20 p-3">
                  <DetailRow
                    label="Status"
                    value={
                      detailsOrder.hasPurchasedLabel
                        ? "Label purchased in ShipStation"
                        : "No ShipStation label yet"
                    }
                  />
                  <DetailRow label="Tracking" value={detailsOrder.trackingNumber} />
                  <DetailRow label="Carrier" value={detailsOrder.carrierCode} />
                  <DetailRow label="Service" value={detailsOrder.serviceCode} />
                  <DetailRow
                    label="Label cost"
                    value={formatMoney(detailsOrder.shipmentCost)}
                  />
                  <DetailRow
                    label="Ship / label date"
                    value={formatWhen(detailsOrder.labelShipDate)}
                  />
                  <DetailRow label="Shipment ID" value={detailsOrder.shipmentId} />
                </dl>
              </section>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
