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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useCollection } from "@/hooks/use-collection";
import {
  loadDispatchLog,
  type DispatchLogEntry,
} from "@/lib/warehouse-dispatch-log";
import type { UserProfile, WarehouseDoc } from "@/types";
import {
  Boxes,
  ChevronRight,
  Loader2,
  Package,
  RefreshCw,
  Search,
  Truck,
  User as UserIcon,
} from "lucide-react";
import { format } from "date-fns";

type Props = {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
};

type RangeFilter = "today" | "7d" | "30d" | "all" | "custom";
type KindFilter = "all" | "outbound" | "crossdock";

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

function formatWhen(date: Date | null): string {
  if (!date) return "—";
  return format(date, "MMM d, yyyy h:mm a");
}

export function WarehouseOpsDispatchLog({ warehouse, clients }: Props) {
  const { toast } = useToast();
  const { data: allUsers } = useCollection<UserProfile>("users");

  const [entries, setEntries] = useState<DispatchLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<RangeFilter>("7d");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [dispatcherFilter, setDispatcherFilter] = useState<string>("all");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [selected, setSelected] = useState<DispatchLogEntry | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await loadDispatchLog({
        warehouse,
        clients,
        users: allUsers.length > 0 ? allUsers : clients,
        max: 250,
      });
      setEntries(rows);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Failed to load dispatch log",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setLoading(false);
    }
  }, [warehouse, clients, allUsers, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const dispatcherOptions = useMemo(() => {
    const set = new Set(
      entries.map((e) => e.dispatcherLabel).filter(Boolean) as string[]
    );
    return ["all", ...Array.from(set).sort()];
  }, [entries]);

  const clientOptions = useMemo(() => {
    const set = new Set(
      entries.map((e) => e.clientLabel).filter(Boolean) as string[]
    );
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
      if (kindFilter !== "all" && e.kind !== kindFilter) return false;
      if (dispatcherFilter !== "all" && e.dispatcherLabel !== dispatcherFilter)
        return false;
      if (clientFilter !== "all" && e.clientLabel !== clientFilter) return false;
      const t = e.dispatchedAt?.getTime();
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
    kindFilter,
    dispatcherFilter,
    clientFilter,
  ]);

  const totals = useMemo(() => {
    const units = filtered.reduce(
      (s, e) =>
        s +
        (e.lines.length > 0
          ? e.lines.reduce((n, l) => n + (l.quantity || 0), 0)
          : e.shippedQty ?? 0),
      0
    );
    const dispatchers = new Set(
      filtered.map((e) => e.dispatcherLabel).filter(Boolean) as string[]
    );
    return { count: filtered.length, units, dispatchers: dispatchers.size };
  }, [filtered]);

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Dispatch log</CardTitle>
              <CardDescription>
                What was handed to the carrier, when, and by whom. Click a parcel
                for owner and contents.
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
                placeholder="Search tracking, client, dispatcher, SKU…"
                className="pl-8"
              />
            </div>
            <Select
              value={range}
              onValueChange={(v) => setRange(v as RangeFilter)}
            >
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
            <Select
              value={kindFilter}
              onValueChange={(v) => setKindFilter(v as KindFilter)}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="outbound">Outbound</SelectItem>
                <SelectItem value="crossdock">Cross-dock</SelectItem>
              </SelectContent>
            </Select>
            {dispatcherOptions.length > 2 ? (
              <Select
                value={dispatcherFilter}
                onValueChange={setDispatcherFilter}
              >
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Dispatcher" />
                </SelectTrigger>
                <SelectContent>
                  {dispatcherOptions.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t === "all" ? "All dispatchers" : t}
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
          </div>

          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">{totals.count} dispatches</Badge>
            <Badge variant="secondary">{totals.units} units</Badge>
            <Badge variant="secondary">{totals.dispatchers} dispatchers</Badge>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading dispatch log…
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-md border border-dashed py-12 text-center text-sm text-muted-foreground">
              No dispatches match your filters.
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setSelected(e)}
                  className="w-full rounded-lg border p-3 text-left text-sm transition-colors hover:bg-muted/40"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-medium">
                      {e.kind === "crossdock" ? (
                        <Package className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Truck className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="font-mono text-xs sm:text-sm">
                        {e.courierTracking ?? e.unitCode ?? e.shipmentRequestId ?? e.id.slice(0, 8)}
                      </span>
                      <Badge variant="outline">
                        {e.kind === "crossdock" ? "Cross-dock" : "Outbound"}
                      </Badge>
                    </div>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      {formatWhen(e.dispatchedAt)}
                      <ChevronRight className="h-3.5 w-3.5" />
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <UserIcon className="h-3.5 w-3.5" />
                      {e.dispatcherLabel ?? "Unknown dispatcher"}
                    </span>
                    {e.clientLabel && (
                      <span className="flex items-center gap-1">
                        <Boxes className="h-3.5 w-3.5" />
                        {e.clientLabel}
                      </span>
                    )}
                    {e.shipTo && <span>To: {e.shipTo}</span>}
                  </div>

                  {e.lines.length > 0 && (
                    <p className="mt-1.5 truncate text-xs text-muted-foreground">
                      {e.lines
                        .map(
                          (l) =>
                            `${l.quantity}× ${l.sku ?? l.productName}`
                        )
                        .join(" · ")}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Truck className="h-4 w-4" />
                  Parcel details
                </DialogTitle>
                <DialogDescription>
                  Dispatched {formatWhen(selected.dispatchedAt)}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 text-sm">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md border p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Owner
                    </p>
                    <p className="mt-1 font-medium">
                      {selected.clientLabel ?? "Unknown client"}
                    </p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Dispatcher
                    </p>
                    <p className="mt-1 font-medium">
                      {selected.dispatcherLabel ?? "Unknown"}
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5 rounded-md border p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Shipment
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">
                      {selected.kind === "crossdock" ? "Cross-dock" : "Outbound"}
                    </Badge>
                    {selected.qcUnitType && (
                      <Badge variant="secondary">{selected.qcUnitType}</Badge>
                    )}
                    {selected.unitCode && (
                      <Badge variant="secondary" className="font-mono">
                        {selected.unitCode}
                      </Badge>
                    )}
                  </div>
                  {selected.courierTracking && (
                    <p className="font-mono text-xs">
                      Tracking: {selected.courierTracking}
                    </p>
                  )}
                  {selected.service && (
                    <p className="text-xs text-muted-foreground">
                      Service: {selected.service}
                    </p>
                  )}
                  {selected.shipFrom && (
                    <p className="text-xs">
                      <span className="text-muted-foreground">From: </span>
                      {selected.shipFrom}
                    </p>
                  )}
                  {selected.shipTo && (
                    <p className="text-xs">
                      <span className="text-muted-foreground">To: </span>
                      {selected.shipTo}
                    </p>
                  )}
                  {selected.shipmentRequestId && (
                    <p className="font-mono text-[10px] text-muted-foreground">
                      Order {selected.shipmentRequestId}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Contents
                  </p>
                  {selected.lines.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {selected.shippedQty != null
                        ? `${selected.shippedQty} unit(s) — line details not available.`
                        : "No line items on file."}
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {selected.lines.map((l, i) => (
                        <div
                          key={`${selected.id}-line-${i}`}
                          className="flex flex-wrap items-center gap-2 rounded bg-muted/40 px-2 py-1.5 text-xs"
                        >
                          {l.sku && (
                            <span className="font-mono font-medium">{l.sku}</span>
                          )}
                          <span className="text-muted-foreground">
                            {l.productName}
                          </span>
                          <span className="ml-auto font-medium">
                            {l.quantity} units
                            {l.packOf && l.packOf > 1
                              ? ` (pack of ${l.packOf})`
                              : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
