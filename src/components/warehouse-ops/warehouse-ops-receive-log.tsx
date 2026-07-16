"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useCollection } from "@/hooks/use-collection";
import {
  listWarehouseCartons,
  listWarehousePallets,
} from "@/lib/warehouse-carton-firestore";
import { dateFromFirestore } from "@/lib/warehouse-stock-sort";
import { CARTON_STATUS_LABELS } from "@/lib/warehouse-carton-states";
import type {
  UserProfile,
  WarehouseCartonDoc,
  WarehouseDoc,
  WarehousePalletDoc,
} from "@/types";
import {
  Boxes,
  ImageIcon,
  Layers,
  Loader2,
  Package,
  RefreshCw,
  Search,
  Truck,
  User as UserIcon,
} from "lucide-react";

type Props = {
  warehouse: WarehouseDoc;
};

type RangeFilter = "today" | "7d" | "30d" | "all" | "custom";

function startOfLocalDay(isoDate: string): number | null {
  if (!isoDate) return null;
  const d = new Date(`${isoDate}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function endOfLocalDay(isoDate: string): number | null {
  if (!isoDate) return null;
  const d = new Date(`${isoDate}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

type LogEntry = {
  id: string;
  kind: "carton" | "pallet";
  code: string;
  typeLabel: string;
  status: string;
  statusLabel: string;
  receivedAt: Date | null;
  receivedBy: string | null;
  clientLabel: string | null;
  tracking: string | null;
  carrier: string | null;
  notes: string | null;
  photoCount: number;
  totalQty: number;
  lines: Array<{
    sku: string;
    productTitle: string | null;
    quantity: number;
    lot: string | null;
    expiry: string | null;
    condition: "good" | "damaged";
  }>;
  searchText: string;
};

function cartonTypeLabel(c: WarehouseCartonDoc): string {
  if (c.isContainer) return "Container";
  if (c.isPackage) return "Package";
  if (c.isClosedCrossdock || c.receiveMode === "crossdock") return "Cross-dock";
  if (c.productReturnId) return "Return";
  if (c.isLoose) return "Open receive";
  return "Carton";
}

function fmtDateTime(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function WarehouseOpsReceiveLog({ warehouse }: Props) {
  const { toast } = useToast();
  const { data: allUsers } = useCollection<UserProfile>("users");

  const [cartons, setCartons] = useState<WarehouseCartonDoc[]>([]);
  const [pallets, setPallets] = useState<WarehousePalletDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<RangeFilter>("7d");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [receiverFilter, setReceiverFilter] = useState<string>("all");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [photosFilter, setPhotosFilter] = useState<"all" | "yes" | "no">("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, p] = await Promise.all([
        listWarehouseCartons(warehouse.id),
        listWarehousePallets(warehouse.id),
      ]);
      setCartons(c);
      setPallets(p);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Failed to load receive log",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setLoading(false);
    }
  }, [warehouse.id, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Resolve a receivedBy value (uid OR stored name/email) to a display name. */
  const resolveReceiver = useCallback(
    (raw: string | null | undefined): string | null => {
      const value = raw?.trim();
      if (!value) return null;
      const byUid = allUsers.find((u) => u.uid === value);
      if (byUid) return byUid.name || byUid.email || value;
      const byNameOrEmail = allUsers.find(
        (u) => u.name === value || u.email === value
      );
      if (byNameOrEmail) return byNameOrEmail.name || byNameOrEmail.email || value;
      return value;
    },
    [allUsers]
  );

  const resolveClient = useCallback(
    (c: WarehouseCartonDoc | WarehousePalletDoc): string | null => {
      const clientId = (c as WarehouseCartonDoc).clientId?.trim();
      if (clientId) {
        const u = allUsers.find((x) => x.uid === clientId);
        if (u) return u.name || u.email || clientId;
        return clientId;
      }
      const display = (c as WarehouseCartonDoc).receivedForClient?.trim();
      return display || null;
    },
    [allUsers]
  );

  const entries = useMemo<LogEntry[]>(() => {
    const palletIdsWithCartons = new Set(
      cartons.map((c) => c.palletId).filter(Boolean) as string[]
    );

    const cartonEntries: LogEntry[] = cartons
      .filter((c) => c.status !== "voided")
      .map((c) => {
        const receivedAt =
          dateFromFirestore(c.receivedAt) ?? dateFromFirestore(c.createdAt);
        const lines =
          c.lines && c.lines.length > 0
            ? c.lines.map((l) => ({
                sku: l.sku,
                productTitle: l.productTitle ?? null,
                quantity: l.quantity,
                lot: l.lot ?? null,
                expiry: l.expiry ?? null,
                condition: l.condition,
              }))
            : [
                {
                  sku: c.sku,
                  productTitle: c.productTitle ?? null,
                  quantity: c.quantity,
                  lot: c.lot ?? null,
                  expiry: c.expiry ?? null,
                  condition: "good" as const,
                },
              ];
        const receivedBy = resolveReceiver(c.receivedBy);
        const clientLabel = resolveClient(c);
        const photoCount =
          (c.photoUrls?.length ?? 0) + (c.photoUrl && !c.photoUrls?.length ? 1 : 0);
        const totalQty = lines.reduce((s, l) => s + (l.quantity || 0), 0);
        const searchText = [
          c.cartonCode,
          c.trackingNumber,
          c.carrier,
          clientLabel,
          receivedBy,
          c.receiveLot,
          ...lines.map((l) => `${l.sku} ${l.productTitle ?? ""} ${l.lot ?? ""}`),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return {
          id: c.id,
          kind: "carton" as const,
          code: c.cartonCode,
          typeLabel: cartonTypeLabel(c),
          status: c.status,
          statusLabel: CARTON_STATUS_LABELS[c.status] ?? c.status,
          receivedAt,
          receivedBy,
          clientLabel,
          tracking: c.trackingNumber ?? null,
          carrier: c.carrier ?? null,
          notes: c.notes ?? null,
          photoCount,
          totalQty,
          lines,
          searchText,
        };
      });

    // Include pallets that were received on their own (open-receive manifest not
    // yet split into child cartons) so nothing is missed in the audit trail.
    const palletEntries: LogEntry[] = pallets
      .filter((p) => !palletIdsWithCartons.has(p.id))
      .map((p) => {
        const receivedAt =
          dateFromFirestore(p.receivedAt) ?? dateFromFirestore(p.createdAt);
        const receivedBy = resolveReceiver(p.receivedBy);
        const clientLabel = resolveClient(p);
        const searchText = [
          p.palletCode,
          p.trackingNumber,
          p.carrier,
          clientLabel,
          receivedBy,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return {
          id: p.id,
          kind: "pallet" as const,
          code: p.palletCode,
          typeLabel: "Pallet",
          status: p.status,
          statusLabel: p.status,
          receivedAt,
          receivedBy,
          clientLabel,
          tracking: p.trackingNumber ?? null,
          carrier: p.carrier ?? null,
          notes: p.notes ?? null,
          photoCount: p.photoUrl ? 1 : 0,
          totalQty: 0,
          lines: [],
          searchText,
        };
      });

    return [...cartonEntries, ...palletEntries].sort((a, b) => {
      const at = a.receivedAt?.getTime() ?? 0;
      const bt = b.receivedAt?.getTime() ?? 0;
      return bt - at;
    });
  }, [cartons, pallets, resolveReceiver, resolveClient]);

  const typeOptions = useMemo(() => {
    const set = new Set(entries.map((e) => e.typeLabel));
    return ["all", ...Array.from(set).sort()];
  }, [entries]);

  const receiverOptions = useMemo(() => {
    const set = new Set(entries.map((e) => e.receivedBy).filter(Boolean) as string[]);
    return ["all", ...Array.from(set).sort()];
  }, [entries]);

  const clientOptions = useMemo(() => {
    const set = new Set(entries.map((e) => e.clientLabel).filter(Boolean) as string[]);
    return ["all", ...Array.from(set).sort()];
  }, [entries]);

  const statusOptions = useMemo(() => {
    const set = new Set(entries.map((e) => e.statusLabel));
    return ["all", ...Array.from(set).sort()];
  }, [entries]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const rangeMs =
      range === "today"
        ? 24 * 60 * 60 * 1000
        : range === "7d"
          ? 7 * 24 * 60 * 60 * 1000
          : range === "30d"
            ? 30 * 24 * 60 * 60 * 1000
            : null;
    const fromMs = range === "custom" ? startOfLocalDay(fromDate) : null;
    const toMs = range === "custom" ? endOfLocalDay(toDate) : null;
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (typeFilter !== "all" && e.typeLabel !== typeFilter) return false;
      if (receiverFilter !== "all" && e.receivedBy !== receiverFilter) return false;
      if (clientFilter !== "all" && e.clientLabel !== clientFilter) return false;
      if (statusFilter !== "all" && e.statusLabel !== statusFilter) return false;
      if (photosFilter === "yes" && e.photoCount < 1) return false;
      if (photosFilter === "no" && e.photoCount > 0) return false;
      const t = e.receivedAt?.getTime();
      if (range === "custom") {
        if (fromMs != null && (t == null || t < fromMs)) return false;
        if (toMs != null && (t == null || t > toMs)) return false;
      } else if (rangeMs != null) {
        if (t == null || now - t > rangeMs) return false;
      }
      if (q && !e.searchText.includes(q)) return false;
      return true;
    });
  }, [
    entries,
    query,
    range,
    fromDate,
    toDate,
    typeFilter,
    receiverFilter,
    clientFilter,
    statusFilter,
    photosFilter,
  ]);

  const totals = useMemo(() => {
    const units = filtered.reduce((s, e) => s + e.totalQty, 0);
    const receivers = new Set(
      filtered.map((e) => e.receivedBy).filter(Boolean) as string[]
    );
    return { count: filtered.length, units, receivers: receivers.size };
  }, [filtered]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Receive log</CardTitle>
            <CardDescription>
              Full audit of what was received, when, and by whom — cartons,
              pallets, packages, cross-dock and returns.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search code, SKU, tracking, client, receiver…"
              className="pl-8"
            />
          </div>
          <Select value={range} onValueChange={(v) => setRange(v as RangeFilter)}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="all">All time</SelectItem>
              <SelectItem value="custom">Custom dates</SelectItem>
            </SelectContent>
          </Select>
          {range === "custom" ? (
            <>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-[140px]"
              />
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-[140px]"
              />
            </>
          ) : null}
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {typeOptions.map((t) => (
                <SelectItem key={t} value={t}>
                  {t === "all" ? "All types" : t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {receiverOptions.length > 2 ? (
            <Select value={receiverFilter} onValueChange={setReceiverFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="Receiver" />
              </SelectTrigger>
              <SelectContent>
                {receiverOptions.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t === "all" ? "All receivers" : t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {clientOptions.length > 2 ? (
            <Select value={clientFilter} onValueChange={setClientFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Client" />
              </SelectTrigger>
              <SelectContent>
                {clientOptions.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t === "all" ? "All clients" : t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {statusOptions.length > 2 ? (
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t === "all" ? "All statuses" : t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Select
            value={photosFilter}
            onValueChange={(v) => setPhotosFilter(v as "all" | "yes" | "no")}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Photos: all</SelectItem>
              <SelectItem value="yes">With photos</SelectItem>
              <SelectItem value="no">No photos</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">{totals.count} receives</Badge>
          <Badge variant="secondary">{totals.units} units</Badge>
          <Badge variant="secondary">{totals.receivers} receivers</Badge>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading receive log…
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-md border border-dashed py-12 text-center text-sm text-muted-foreground">
            No receives match your filters.
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((e) => (
              <div
                key={`${e.kind}-${e.id}`}
                className="rounded-lg border p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-medium">
                    {e.kind === "pallet" ? (
                      <Layers className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Package className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="font-mono">{e.code}</span>
                    <Badge variant="outline">{e.typeLabel}</Badge>
                    <Badge variant="secondary">{e.statusLabel}</Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {fmtDateTime(e.receivedAt)}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <UserIcon className="h-3.5 w-3.5" />
                    {e.receivedBy ?? "Unknown receiver"}
                  </span>
                  {e.clientLabel && (
                    <span className="flex items-center gap-1">
                      <Boxes className="h-3.5 w-3.5" />
                      {e.clientLabel}
                    </span>
                  )}
                  {e.tracking && (
                    <span className="flex items-center gap-1">
                      <Truck className="h-3.5 w-3.5" />
                      {e.tracking}
                      {e.carrier ? ` · ${e.carrier}` : ""}
                    </span>
                  )}
                  {e.photoCount > 0 && (
                    <span className="flex items-center gap-1">
                      <ImageIcon className="h-3.5 w-3.5" />
                      {e.photoCount} photo{e.photoCount > 1 ? "s" : ""}
                    </span>
                  )}
                </div>

                {e.lines.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {e.lines.map((l, i) => (
                      <div
                        key={`${e.id}-${i}`}
                        className="flex flex-wrap items-center gap-2 rounded bg-muted/40 px-2 py-1 text-xs"
                      >
                        <span className="font-mono font-medium">{l.sku}</span>
                        {l.productTitle && (
                          <span className="text-muted-foreground">
                            {l.productTitle}
                          </span>
                        )}
                        <span className="ml-auto font-medium">
                          {l.quantity} {l.condition === "damaged" ? "damaged" : "units"}
                        </span>
                        {l.lot && (
                          <span className="text-muted-foreground">Lot {l.lot}</span>
                        )}
                        {l.expiry && (
                          <span className="text-muted-foreground">
                            Exp {l.expiry}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {e.notes && (
                  <p className="mt-2 text-xs italic text-muted-foreground">
                    “{e.notes}”
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
