"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Download, History, Search, X, Package, Truck, AlertTriangle } from "lucide-react";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { endOfDay, startOfDay } from "date-fns";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCollection } from "@/hooks/use-collection";
import type {
  DeleteLog,
  EditLog,
  InboundReceiveLog,
  InventoryChangeLog,
  InventoryItem,
  InventoryRequest,
  RecycledInventoryItem,
  RestockHistory,
  ShipmentRequest,
  ShippedItem,
} from "@/types";
import {
  buildInventoryHistory,
  downloadInventoryHistoryCsv,
  formatChangeCell,
  formatInboundLogDate,
  formatQtyCell,
  getInboundRequestReceivedTotal,
  inboundReceiveLogsForItem,
  mergeInboundReceiveLogs,
  type InventoryHistoryEventType,
  type InventoryHistoryRow,
} from "@/lib/inventory-history";
import { getRequestedQuantity } from "@/lib/inventory-qty-display";
import { cn } from "@/lib/utils";
import { InboundReceiveVideoDialog } from "@/components/inventory/inbound-receive-video-dialog";
import { useWarehouseCameraSessions } from "@/hooks/use-warehouse-camera-sessions";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  QUARANTINE_REQUESTS,
  ensureQuarantineInventoryHistoryLogged,
} from "@/lib/quarantine-inventory-history";
import type { QuarantineRequest } from "@/types";

const EVENT_BADGE: Record<string, string> = {
  created: "bg-slate-100 text-slate-800",
  inbound_request: "bg-amber-100 text-amber-900",
  received: "bg-emerald-100 text-emerald-900",
  restock: "bg-blue-100 text-blue-900",
  shipped: "bg-violet-100 text-violet-900",
  edited: "bg-cyan-100 text-cyan-900",
  deleted: "bg-red-100 text-red-900",
  disposed: "bg-orange-100 text-orange-900",
  quarantine: "bg-amber-100 text-amber-950",
  transfer: "bg-indigo-100 text-indigo-900",
};

const EVENT_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All events" },
  { value: "received", label: "Inbound approved" },
  { value: "inbound_request", label: "Inbound requests" },
  { value: "restock", label: "Restock" },
  { value: "shipped", label: "Outbound / Scheduled" },
  { value: "quarantine", label: "Quarantine" },
  { value: "edited", label: "Edits" },
  { value: "disposed", label: "Disposed" },
  { value: "deleted", label: "Deleted" },
  { value: "created", label: "Created" },
];

const CHANGE_FILTERS = [
  { value: "all", label: "All changes" },
  { value: "in", label: "Increases only" },
  { value: "out", label: "Decreases only" },
] as const;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: InventoryItem | null;
  userId: string | undefined;
  ownerLabel?: string;
};

function matchesTimestampRange(ts: number, from?: Date, to?: Date): boolean {
  if (!from && !to) return true;
  if (!ts) return false;
  if (from && ts < startOfDay(from).getTime()) return false;
  if (to && ts > endOfDay(to).getTime()) return false;
  return true;
}

function filterHistoryRows(
  rows: InventoryHistoryRow[],
  opts: {
    search: string;
    eventType: string;
    fromDate?: Date;
    toDate?: Date;
    changeFilter: string;
  }
): InventoryHistoryRow[] {
  let list = rows.filter((r) => r.eventType !== "transfer");
  const q = opts.search.trim().toLowerCase();

  if (opts.eventType !== "all") {
    list = list.filter((r) => r.eventType === opts.eventType);
  }

  if (opts.changeFilter === "in") {
    list = list.filter((r) => r.qtyChange != null && r.qtyChange > 0);
  } else if (opts.changeFilter === "out") {
    list = list.filter((r) => r.qtyChange != null && r.qtyChange < 0);
  }

  if (opts.fromDate || opts.toDate) {
    list = list.filter((r) => matchesTimestampRange(r.timestamp, opts.fromDate, opts.toDate));
  }

  if (q) {
    list = list.filter(
      (r) =>
        r.event.toLowerCase().includes(q) ||
        r.details.toLowerCase().includes(q) ||
        r.user.toLowerCase().includes(q) ||
        r.dateLabel.toLowerCase().includes(q)
    );
  }

  return list;
}

const stickyHeadClass =
  "sticky top-0 z-10 bg-background text-xs shadow-[0_1px_0_0_hsl(var(--border))]";

export function InventoryHistoryDialog({
  open,
  onOpenChange,
  item,
  userId,
  ownerLabel,
}: Props) {
  const path = open && userId ? `users/${userId}` : "";
  const { recordedRequestIds } = useWarehouseCameraSessions(userId, open);
  const sourceRequestId = String(
    (item as InventoryItem & { sourceRequestId?: string } | null)?.sourceRequestId || ""
  ).trim();
  const headerVideoRequestId =
    sourceRequestId && recordedRequestIds.has(sourceRequestId) ? sourceRequestId : "";

  const [search, setSearch] = useState("");
  const [eventType, setEventType] = useState("all");
  const [fromDate, setFromDate] = useState<Date | undefined>();
  const [toDate, setToDate] = useState<Date | undefined>();
  const [changeFilter, setChangeFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("overview");

  useEffect(() => {
    if (open) {
      setSearch("");
      setEventType("all");
      setFromDate(undefined);
      setToDate(undefined);
      setChangeFilter("all");
      setActiveTab("overview");
    }
  }, [open, item?.id]);

  // Backfill quarantine Stock history (with reason/remarks) for this product if missing.
  // Uses thin quarantine-inventory-history (no warehouse ops) so admin inventory does not
  // hit circular module init ("Cannot access before initialization").
  useEffect(() => {
    if (!open || !userId || !item?.id) return;
    let cancelled = false;
    const productId = item.id;
    const sku = String(item.sku ?? "").trim().toLowerCase();
    const run = async () => {
      try {
        const snap = await getDocs(
          query(collection(db, QUARANTINE_REQUESTS), where("userId", "==", userId))
        );
        for (const d of snap.docs) {
          if (cancelled) return;
          const data = d.data() as Omit<QuarantineRequest, "id">;
          const req = { ...data, id: d.id } as QuarantineRequest;
          if (req.kind !== "quarantine") continue;
          const matchesProduct =
            req.productId === productId ||
            (sku && String(req.sku ?? "").trim().toLowerCase() === sku);
          if (!matchesProduct) continue;
          await ensureQuarantineInventoryHistoryLogged(req);
        }
      } catch (err) {
        console.warn("[inventory-history] quarantine history backfill failed", err);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [open, userId, item?.id, item?.sku]);

  const { data: editLogs, loading: l1 } = useCollection<EditLog>(path ? `${path}/editLogs` : "");
  const { data: deleteLogs, loading: l2 } = useCollection<DeleteLog>(path ? `${path}/deleteLogs` : "");
  const { data: restockHistory, loading: l3 } = useCollection<RestockHistory>(
    path ? `${path}/restockHistory` : ""
  );
  const { data: shipped, loading: l4 } = useCollection<ShippedItem>(path ? `${path}/shipped` : "");
  const { data: inventoryRequests, loading: l5 } = useCollection<InventoryRequest>(
    path ? `${path}/inventoryRequests` : ""
  );
  const { data: recycledInventory, loading: l6 } = useCollection<RecycledInventoryItem>(
    path ? `${path}/recycledInventory` : ""
  );
  const { data: inboundReceiveLogs, loading: l7 } = useCollection<InboundReceiveLog>(
    path ? `${path}/inboundReceiveLogs` : ""
  );
  const { data: inventoryChangeLogs, loading: l8 } = useCollection<InventoryChangeLog>(
    path ? `${path}/inventoryChangeLogs` : ""
  );
  const { data: shipmentRequests, loading: l9 } = useCollection<ShipmentRequest>(
    path ? `${path}/shipmentRequests` : ""
  );

  const loading = l1 || l2 || l3 || l4 || l5 || l6 || l7 || l8 || l9;

  const rows = useMemo(() => {
    if (!item) return [] as InventoryHistoryRow[];
    // A’s trail only. Merge already records net +qty from B — do not interleave B’s −4/before/after
    // into this timeline (that jumps 70 → 444 and breaks the running sequence).
    return buildInventoryHistory(
      item,
      {
        editLogs,
        deleteLogs,
        restockHistory,
        shipped,
        inventoryRequests,
        inventoryTransfers: [],
        recycledInventory,
        inventoryChangeLogs,
        inboundReceiveLogs,
        shipmentRequests,
      },
      { includeInternalEvents: false }
    );
  }, [
    item,
    editLogs,
    deleteLogs,
    restockHistory,
    shipped,
    inventoryRequests,
    recycledInventory,
    inventoryChangeLogs,
    inboundReceiveLogs,
    shipmentRequests,
  ]);

  const filteredRows = useMemo(
    () => filterHistoryRows(rows, { search, eventType, fromDate, toDate, changeFilter }),
    [rows, search, eventType, fromDate, toDate, changeFilter]
  );

  const displayRows = useMemo(() => [...filteredRows].reverse(), [filteredRows]);

  const outboundRows = useMemo(
    () => displayRows.filter((r) => r.eventType === "shipped"),
    [displayRows]
  );

  const inboundLogs = useMemo(() => {
    if (!item) return [];
    return mergeInboundReceiveLogs(inboundReceiveLogsForItem(item, inboundReceiveLogs));
  }, [item, inboundReceiveLogs]);

  const inboundRequestById = useMemo(
    () => new Map(inventoryRequests.map((req) => [req.id, req])),
    [inventoryRequests]
  );

  const damagedOnHand = Math.max(0, Number((item as InventoryItem & { damagedQuantity?: number })?.damagedQuantity ?? 0));

  const hasActiveFilters =
    search.trim() !== "" ||
    eventType !== "all" ||
    fromDate != null ||
    toDate != null ||
    changeFilter !== "all";

  function handleExport() {
    if (!item) return;
    downloadInventoryHistoryCsv(item, filteredRows, ownerLabel);
  }

  function clearFilters() {
    setSearch("");
    setEventType("all");
    setFromDate(undefined);
    setToDate(undefined);
    setChangeFilter("all");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "!flex !translate-x-0 !translate-y-0 left-0 top-0 h-[100dvh] max-h-[100dvh] w-full max-w-full flex-col gap-0 overflow-hidden rounded-none border-0 p-0",
          "sm:left-[50%] sm:top-[50%] sm:!h-auto sm:max-h-[90vh] sm:w-[calc(100%-2rem)] sm:max-w-5xl sm:!translate-x-[-50%] sm:!translate-y-[-50%] sm:rounded-lg sm:border"
        )}
      >
        <DialogHeader className="shrink-0 space-y-1.5 border-b px-3 pb-2.5 pr-12 pt-3 text-left sm:space-y-1.5 sm:px-6 sm:pb-4 sm:pt-6">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <History className="h-5 w-5 shrink-0" />
            Stock history
          </DialogTitle>
          <DialogDescription className="space-y-0.5 text-left">
            {item ? (
              <>
                <span className="block truncate font-medium text-foreground">
                  {item.productName}
                </span>
                {item.sku ? (
                  <span className="block truncate text-muted-foreground">
                    SKU {item.sku}
                  </span>
                ) : null}
                <span className="hidden text-xs sm:block">
                  Includes inbound, restocks, and shipments. Newest first; CSV uses filtered rows
                  (oldest → newest).
                </span>
              </>
            ) : null}
          </DialogDescription>
          <div className="flex flex-wrap items-center gap-1.5 pt-1 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 sm:h-9"
              disabled={!item || loading || filteredRows.length === 0}
              onClick={handleExport}
            >
              <Download className="mr-1 h-4 w-4" />
              Export CSV
            </Button>
            {item ? (
              <Badge variant="secondary" className="text-xs">
                In stock: {item.quantity}
              </Badge>
            ) : null}
            {item && damagedOnHand > 0 ? (
              <Badge variant="outline" className="border-amber-300 text-xs text-amber-900">
                Damaged: {damagedOnHand}
              </Badge>
            ) : null}
            {!loading && rows.length > 0 ? (
              <Badge variant="outline" className="text-xs">
                {filteredRows.length}/{rows.length} events
              </Badge>
            ) : null}
            {item && headerVideoRequestId ? (
              <InboundReceiveVideoDialog
                requestId={headerVideoRequestId}
                clientUserId={userId}
                triggerLabel="Watch receiving video"
              />
            ) : null}
          </div>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          {/* Single scroll region: tabs + filters + records */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="sticky top-0 z-20 border-b bg-background px-3 pb-2 pt-2 sm:px-6">
            <TabsList className="grid h-auto w-full grid-cols-3 gap-1 p-1 sm:inline-flex sm:w-fit sm:grid-cols-none">
              <TabsTrigger value="overview" className="min-h-9 px-2 text-[11px] sm:text-xs">
                Overview
              </TabsTrigger>
              <TabsTrigger value="inbound" className="min-h-9 gap-1 px-2 text-[11px] sm:text-xs">
                <Package className="hidden h-3.5 w-3.5 sm:block" />
                <span className="sm:hidden">Inbound</span>
                <span className="hidden sm:inline">Inbound &amp; damage</span>
                {inboundLogs.length > 0 ? (
                  <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-[10px]">
                    {inboundLogs.length}
                  </Badge>
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="outbound" className="min-h-9 gap-1 px-2 text-[11px] sm:text-xs">
                <Truck className="hidden h-3.5 w-3.5 sm:block" />
                Outbound
              </TabsTrigger>
            </TabsList>
          </div>

        {!loading && item && rows.length > 0 && activeTab !== "inbound" ? (
          <div className="space-y-2 border-b bg-muted/40 px-3 py-2.5 sm:space-y-3 sm:px-6 sm:py-3">
            <div className="relative min-w-0 w-full sm:max-w-md">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search event, details, user…"
                className="h-9 bg-background pl-8 text-sm"
              />
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
              <Select value={eventType} onValueChange={setEventType}>
                <SelectTrigger className="h-9 w-full bg-background text-xs sm:w-[160px]">
                  <SelectValue placeholder="Event type" />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_FILTER_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-xs">
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <DateRangePicker
                fromDate={fromDate}
                toDate={toDate}
                setFromDate={setFromDate}
                setToDate={setToDate}
                className="h-9 w-full bg-background text-xs sm:w-[220px] md:w-[260px]"
              />

              <Select value={changeFilter} onValueChange={setChangeFilter}>
                <SelectTrigger className="h-9 w-full bg-background text-xs sm:w-[140px]">
                  <SelectValue placeholder="Qty change" />
                </SelectTrigger>
                <SelectContent>
                  {CHANGE_FILTERS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-xs">
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {hasActiveFilters ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 w-full text-xs sm:w-auto"
                  onClick={clearFilters}
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  Clear filters
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="px-3 py-2 pb-6 sm:px-6">
          <TabsContent value="overview" className="mt-0 focus-visible:outline-none">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="mr-2 h-8 w-8 animate-spin" />
              Loading history…
            </div>
          ) : !item ? null : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No history found for this product yet.
            </p>
          ) : filteredRows.length === 0 ? (
            <div className="space-y-3 py-12 text-center">
              <p className="text-sm text-muted-foreground">No events match your filters.</p>
              <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          ) : (
            <HistoryTable rows={displayRows} />
          )}
          </TabsContent>

          <TabsContent value="inbound" className="mt-0 focus-visible:outline-none">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="mr-2 h-8 w-8 animate-spin" />
                Loading inbound logs…
              </div>
            ) : inboundLogs.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No warehouse inbound / putaway sessions recorded yet. Stock appears here after
                dock receive and putaway.
              </p>
            ) : (
              <div className="pb-4">
                {/* Mobile cards */}
                <div className="space-y-2 md:hidden">
                  {inboundLogs.map((row) => {
                    const rowRequestId = String(row.inventoryRequestId || "").trim();
                    const linkedRequest = rowRequestId
                      ? inboundRequestById.get(rowRequestId) ?? null
                      : null;
                    const requestedQty = linkedRequest ? getRequestedQuantity(linkedRequest) : null;
                    const receivedTotal = linkedRequest
                      ? getInboundRequestReceivedTotal(linkedRequest) || row.totalReceived
                      : row.totalReceived;
                    return (
                      <div
                        key={row.id}
                        className="min-w-0 space-y-2 rounded-lg border bg-card p-3 text-xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="break-words font-medium">{formatInboundLogDate(row)}</span>
                          <Badge variant="outline" className="shrink-0 text-[10px] font-normal capitalize">
                            {row.eventType === "restock" ? "Restock" : "Initial inbound"}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-2 tabular-nums">
                          <div>
                            <p className="text-[10px] text-muted-foreground">Requested / received</p>
                            <p
                              className={cn(
                                requestedQty != null &&
                                  requestedQty > 0 &&
                                  receivedTotal !== requestedQty &&
                                  "font-medium text-amber-800"
                              )}
                            >
                              {requestedQty != null && requestedQty > 0
                                ? `${requestedQty} / ${receivedTotal}`
                                : "—"}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground">This putaway</p>
                            <p className="font-semibold">{row.totalReceived}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground">Sellable</p>
                            <p className="font-medium text-emerald-700">
                              {row.goodQty}
                              {row.goodBinPath ? (
                                <span className="font-normal text-muted-foreground">
                                  {" "}
                                  · {row.goodBinPath}
                                </span>
                              ) : null}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground">Damaged</p>
                            {row.damagedQty > 0 ? (
                              <p className="inline-flex flex-wrap items-center gap-1 font-medium text-amber-800">
                                <AlertTriangle className="h-3 w-3 shrink-0" />
                                {row.damagedQty}
                                {row.damagedLocation ? (
                                  <span className="font-normal text-muted-foreground">
                                    · {row.damagedLocation}
                                  </span>
                                ) : null}
                              </p>
                            ) : (
                              <p className="text-muted-foreground">0</p>
                            )}
                          </div>
                        </div>
                        {rowRequestId && recordedRequestIds.has(rowRequestId) ? (
                          <InboundReceiveVideoDialog
                            requestId={rowRequestId}
                            clientUserId={userId}
                            triggerLabel="Watch receiving video"
                          />
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                {/* Desktop table */}
                <div className="hidden md:block">
                <Table containerClassName="overflow-visible">
                  <TableHeader>
                    <TableRow className="border-b-0 hover:bg-transparent">
                      <TableHead className={cn(stickyHeadClass, "whitespace-nowrap")}>
                        Date &amp; Time
                      </TableHead>
                      <TableHead className={stickyHeadClass}>Receive type</TableHead>
                      <TableHead className={cn(stickyHeadClass, "text-right")}>
                        Requested / received
                      </TableHead>
                      <TableHead className={cn(stickyHeadClass, "text-right")}>
                        This putaway
                      </TableHead>
                      <TableHead className={stickyHeadClass}>Sellable qty</TableHead>
                      <TableHead className={stickyHeadClass}>Damaged qty</TableHead>
                      <TableHead className={stickyHeadClass}>Receiving video</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inboundLogs.map((row) => {
                      const rowRequestId = String(row.inventoryRequestId || "").trim();
                      const linkedRequest = rowRequestId
                        ? inboundRequestById.get(rowRequestId) ?? null
                        : null;
                      const requestedQty = linkedRequest ? getRequestedQuantity(linkedRequest) : null;
                      const receivedTotal = linkedRequest
                        ? getInboundRequestReceivedTotal(linkedRequest) || row.totalReceived
                        : row.totalReceived;
                      return (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap py-2.5 text-xs">
                          {formatInboundLogDate(row)}
                        </TableCell>
                        <TableCell className="py-2.5 text-xs">
                          <Badge variant="outline" className="text-[10px] font-normal capitalize">
                            {row.eventType === "restock" ? "Restock" : "Initial inbound"}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-2.5 text-right text-xs tabular-nums">
                          {requestedQty != null && requestedQty > 0 ? (
                            <span
                              className={cn(
                                receivedTotal !== requestedQty && "font-medium text-amber-800"
                              )}
                            >
                              {requestedQty} / {receivedTotal}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-2.5 text-right text-xs font-semibold tabular-nums">
                          {row.totalReceived}
                        </TableCell>
                        <TableCell className="py-2.5 text-xs">
                          <span className="font-medium tabular-nums text-emerald-700">
                            {row.goodQty}
                          </span>
                          {row.goodBinPath ? (
                            <span className="text-muted-foreground">
                              {" "}
                              · Bin: {row.goodBinPath}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="py-2.5 text-xs">
                          {row.damagedQty > 0 ? (
                            <span className="inline-flex flex-wrap items-center gap-1">
                              <AlertTriangle className="h-3 w-3 shrink-0 text-amber-700" />
                              <span className="font-medium tabular-nums text-amber-800">
                                {row.damagedQty}
                              </span>
                              {row.damagedLocation ? (
                                <span className="text-muted-foreground">
                                  · Bin/Area: {row.damagedLocation}
                                </span>
                              ) : null}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                        <TableCell className="py-2.5 text-xs">
                          {rowRequestId && recordedRequestIds.has(rowRequestId) ? (
                            <InboundReceiveVideoDialog
                              requestId={rowRequestId}
                              clientUserId={userId}
                              triggerLabel="Watch receiving video"
                            />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                    })}
                  </TableBody>
                </Table>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="outbound" className="mt-0 focus-visible:outline-none">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="mr-2 h-8 w-8 animate-spin" />
                Loading…
              </div>
            ) : outboundRows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No outbound shipments recorded for this product.
              </p>
            ) : (
              <HistoryTable rows={outboundRows} />
            )}
          </TabsContent>
        </div>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function HistoryTable({ rows }: { rows: InventoryHistoryRow[] }) {
  return (
    <>
      {/* Mobile event cards */}
      <div className="space-y-2 pb-4 md:hidden">
        {rows.map((r) => (
          <div
            key={`${r.seq}-${r.timestamp}-${r.event}`}
            className="min-w-0 space-y-2 rounded-lg border bg-card p-3"
          >
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="min-w-0">
                <p className="text-[10px] font-mono text-muted-foreground">#{r.seq}</p>
                <p className="text-xs font-medium">
                  {r.dateLabel}{" "}
                  <span className="font-normal text-muted-foreground">{r.timeLabel}</span>
                </p>
              </div>
              <Badge
                variant="outline"
                className={cn(
                  "h-auto w-fit max-w-full whitespace-normal break-words px-2 py-0.5 text-left text-[10px] font-normal leading-snug",
                  r.event === "Pack details change"
                    ? "border-amber-200 bg-amber-100 text-amber-900"
                    : EVENT_BADGE[r.eventType as InventoryHistoryEventType]
                )}
              >
                {r.event}
              </Badge>
            </div>
            <div className="grid grid-cols-3 gap-2 rounded-md bg-muted/50 px-2 py-1.5 text-center text-xs tabular-nums">
              <div>
                <p className="text-[10px] text-muted-foreground">Before</p>
                <p>{formatQtyCell(r.qtyBefore)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Change</p>
                <p
                  className={cn(
                    "font-medium",
                    r.qtyChange != null && r.qtyChange > 0 && "text-emerald-700",
                    r.qtyChange != null && r.qtyChange < 0 && "text-red-700"
                  )}
                >
                  {formatChangeCell(r.qtyChange)}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">After</p>
                <p className="font-semibold">{formatQtyCell(r.qtyAfter)}</p>
              </div>
            </div>
            {r.details ? (
              <p className="break-words text-xs text-muted-foreground">{r.details}</p>
            ) : null}
            <p className="truncate text-[11px] text-muted-foreground">By {r.user}</p>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block">
            <Table containerClassName="overflow-visible">
              <TableHeader>
                <TableRow className="border-b-0 hover:bg-transparent">
                  <TableHead className={cn(stickyHeadClass, "w-10")}>#</TableHead>
                  <TableHead className={cn(stickyHeadClass, "whitespace-nowrap")}>Date</TableHead>
                  <TableHead className={cn(stickyHeadClass, "whitespace-nowrap")}>Time</TableHead>
                  <TableHead className={stickyHeadClass}>Event</TableHead>
                  <TableHead className={cn(stickyHeadClass, "text-right")}>Before</TableHead>
                  <TableHead className={cn(stickyHeadClass, "text-right")}>Action (+/-)</TableHead>
                  <TableHead className={cn(stickyHeadClass, "text-right")}>After</TableHead>
                  <TableHead className={cn(stickyHeadClass, "min-w-[140px]")}>Details</TableHead>
                  <TableHead className={stickyHeadClass}>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={`${r.seq}-${r.timestamp}-${r.event}`}>
                    <TableCell className="py-2 font-mono text-xs text-muted-foreground">
                      {r.seq}
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-2 text-xs">{r.dateLabel}</TableCell>
                    <TableCell className="whitespace-nowrap py-2 text-xs">{r.timeLabel}</TableCell>
                    <TableCell className="py-2 text-xs">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] font-normal",
                          r.event === "Pack details change"
                            ? "border-amber-200 bg-amber-100 text-amber-900"
                            : EVENT_BADGE[r.eventType as InventoryHistoryEventType]
                        )}
                      >
                        {r.event}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-2 text-right text-xs tabular-nums">
                      {formatQtyCell(r.qtyBefore)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "py-2 text-right text-xs font-medium tabular-nums",
                        r.qtyChange != null && r.qtyChange > 0 && "text-emerald-700",
                        r.qtyChange != null && r.qtyChange < 0 && "text-red-700"
                      )}
                    >
                      {formatChangeCell(r.qtyChange)}
                    </TableCell>
                    <TableCell className="py-2 text-right text-xs font-semibold tabular-nums">
                      {formatQtyCell(r.qtyAfter)}
                    </TableCell>
                    <TableCell
                      className="max-w-[280px] break-words py-2 text-xs text-muted-foreground"
                      title={r.details || undefined}
                    >
                      {r.details || "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-2 text-xs">{r.user}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
      </div>
    </>
  );
}
