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
import { Loader2, Download, History, Search, X } from "lucide-react";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { endOfDay, startOfDay } from "date-fns";
import { useCollection } from "@/hooks/use-collection";
import type {
  DeleteLog,
  EditLog,
  InventoryItem,
  InventoryRequest,
  RecycledInventoryItem,
  RestockHistory,
  ShippedItem,
} from "@/types";
import {
  buildInventoryHistory,
  downloadInventoryHistoryCsv,
  formatChangeCell,
  formatQtyCell,
  type InventoryHistoryEventType,
  type InventoryHistoryRow,
} from "@/lib/inventory-history";
import { cn } from "@/lib/utils";

const EVENT_BADGE: Record<string, string> = {
  created: "bg-slate-100 text-slate-800",
  inbound_request: "bg-amber-100 text-amber-900",
  received: "bg-emerald-100 text-emerald-900",
  restock: "bg-blue-100 text-blue-900",
  shipped: "bg-violet-100 text-violet-900",
  edited: "bg-cyan-100 text-cyan-900",
  deleted: "bg-red-100 text-red-900",
  disposed: "bg-orange-100 text-orange-900",
  transfer: "bg-indigo-100 text-indigo-900",
};

const EVENT_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All events" },
  { value: "received", label: "Received / inbound" },
  { value: "inbound_request", label: "Inbound requests" },
  { value: "restock", label: "Restock" },
  { value: "shipped", label: "Shipped" },
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

  const [search, setSearch] = useState("");
  const [eventType, setEventType] = useState("all");
  const [fromDate, setFromDate] = useState<Date | undefined>();
  const [toDate, setToDate] = useState<Date | undefined>();
  const [changeFilter, setChangeFilter] = useState("all");

  useEffect(() => {
    if (open) {
      setSearch("");
      setEventType("all");
      setFromDate(undefined);
      setToDate(undefined);
      setChangeFilter("all");
    }
  }, [open, item?.id]);

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

  const loading = l1 || l2 || l3 || l4 || l5 || l6;

  const rows = useMemo(() => {
    if (!item) return [] as InventoryHistoryRow[];
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
      },
      { includeInternalEvents: false }
    );
  }, [item, editLogs, deleteLogs, restockHistory, shipped, inventoryRequests, recycledInventory]);

  const filteredRows = useMemo(
    () => filterHistoryRows(rows, { search, eventType, fromDate, toDate, changeFilter }),
    [rows, search, eventType, fromDate, toDate, changeFilter]
  );

  const displayRows = useMemo(() => [...filteredRows].reverse(), [filteredRows]);

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
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <History className="h-5 w-5" />
            Stock history
          </DialogTitle>
          <DialogDescription className="text-left space-y-1">
            {item ? (
              <>
                <span className="font-medium text-foreground">{item.productName}</span>
                {item.sku ? (
                  <span className="text-muted-foreground"> · SKU {item.sku}</span>
                ) : null}
                <span className="block text-xs">
                  Filter events below. Table shows newest first; CSV export uses filtered rows
                  (oldest → newest).
                </span>
              </>
            ) : null}
          </DialogDescription>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!item || loading || filteredRows.length === 0}
              onClick={handleExport}
            >
              <Download className="h-4 w-4 mr-1" />
              Export CSV
            </Button>
            {item ? (
              <Badge variant="secondary" className="text-xs">
                Current qty: {item.quantity}
              </Badge>
            ) : null}
            {!loading && rows.length > 0 ? (
              <Badge variant="outline" className="text-xs">
                Showing {filteredRows.length} of {rows.length} events
              </Badge>
            ) : null}
          </div>
        </DialogHeader>

        {!loading && item && rows.length > 0 ? (
          <div className="shrink-0 px-6 py-3 border-b bg-muted/40 space-y-3">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search event, details, user…"
                className="pl-8 h-9 text-sm bg-background"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={eventType} onValueChange={setEventType}>
                <SelectTrigger className="h-9 w-[160px] text-xs bg-background">
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
                className="h-9 w-[220px] sm:w-[260px] text-xs bg-background"
              />

              <Select value={changeFilter} onValueChange={setChangeFilter}>
                <SelectTrigger className="h-9 w-[140px] text-xs bg-background">
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
                  className="h-9 text-xs"
                  onClick={clearFilters}
                >
                  <X className="h-3.5 w-3.5 mr-1" />
                  Clear filters
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="flex-1 min-h-0 overflow-auto px-6 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin mr-2" />
              Loading history…
            </div>
          ) : !item ? null : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No history found for this product yet.
            </p>
          ) : filteredRows.length === 0 ? (
            <div className="py-12 text-center space-y-3">
              <p className="text-sm text-muted-foreground">No events match your filters.</p>
              <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          ) : (
            <Table containerClassName="overflow-visible">
              <TableHeader>
                <TableRow className="hover:bg-transparent border-b-0">
                  <TableHead className={cn(stickyHeadClass, "w-10")}>#</TableHead>
                  <TableHead className={cn(stickyHeadClass, "whitespace-nowrap")}>Date</TableHead>
                  <TableHead className={cn(stickyHeadClass, "whitespace-nowrap")}>Time</TableHead>
                  <TableHead className={stickyHeadClass}>Event</TableHead>
                  <TableHead className={cn(stickyHeadClass, "text-right")}>Before</TableHead>
                  <TableHead className={cn(stickyHeadClass, "text-right")}>Change</TableHead>
                  <TableHead className={cn(stickyHeadClass, "text-right")}>After</TableHead>
                  <TableHead className={cn(stickyHeadClass, "min-w-[140px]")}>Details</TableHead>
                  <TableHead className={stickyHeadClass}>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayRows.map((r) => (
                  <TableRow key={`${r.seq}-${r.timestamp}-${r.event}`}>
                    <TableCell className="text-xs font-mono text-muted-foreground py-2">
                      {r.seq}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap py-2">{r.dateLabel}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap py-2">{r.timeLabel}</TableCell>
                    <TableCell className="text-xs py-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          "font-normal text-[10px]",
                          EVENT_BADGE[r.eventType as InventoryHistoryEventType]
                        )}
                      >
                        {r.event}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums py-2">
                      {formatQtyCell(r.qtyBefore)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-xs text-right tabular-nums font-medium py-2",
                        r.qtyChange != null && r.qtyChange > 0 && "text-emerald-700",
                        r.qtyChange != null && r.qtyChange < 0 && "text-red-700"
                      )}
                    >
                      {formatChangeCell(r.qtyChange)}
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums font-semibold py-2">
                      {formatQtyCell(r.qtyAfter)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[220px] py-2">
                      {r.details || "—"}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap py-2">{r.user}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
