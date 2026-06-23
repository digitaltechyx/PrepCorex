"use client";

import { useEffect, useMemo, useState, Fragment } from "react";
import { format } from "date-fns";
import { Eye, Filter, History, Search, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCollection } from "@/hooks/use-collection";
import type {
  DeleteLog,
  EditLog,
  InventoryChangeLog,
  InventoryItem,
  InventoryRequest,
  RecycledInventoryItem,
  RestockHistory,
  ShippedItem,
} from "@/types";
import {
  buildInventoryHistory,
  findLastStockOutCause,
  formatChangeCell,
  formatStockOutSummary,
  type InventoryHistoryRow,
} from "@/lib/inventory-history";
import { InventoryHistoryDialog } from "@/components/inventory/inventory-history-dialog";

export type OutOfStockInventoryRow = {
  id: string;
  productName: string;
  sku?: string;
  variantLabel?: string;
  retailIdentifier?: string;
  expiryDate?: unknown;
  quantity?: number;
  dateAdded?: unknown;
  receivingDate?: unknown;
  remarks?: string;
  imageUrls?: string[];
  source?: string;
};

function getTimestampMs(date: unknown): number {
  if (!date) return 0;
  if (typeof date === "string") {
    const ms = new Date(date).getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof date === "object" && date !== null && "seconds" in (date as Record<string, unknown>)) {
    const sec = Number((date as { seconds: number }).seconds);
    return Number.isFinite(sec) ? sec * 1000 : 0;
  }
  if (date instanceof Date && !Number.isNaN(date.getTime())) {
    return date.getTime();
  }
  return 0;
}

function formatDisplayDate(date: unknown): string {
  const ms = getTimestampMs(date);
  if (!ms) return "N/A";
  return format(new Date(ms), "MMM d, yyyy");
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: OutOfStockInventoryRow[];
  inventoryItems: InventoryItem[];
  userId?: string;
  ownerLabel?: string;
};

export function InventoryOutOfStockSheet({
  open,
  onOpenChange,
  items,
  inventoryItems,
  userId,
  ownerLabel,
}: Props) {
  const [searchTerm, setSearchTerm] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [dateField, setDateField] = useState<"added" | "receiving">("added");
  const [remarksPreview, setRemarksPreview] = useState<{
    text: string;
    imageUrls: string[];
  } | null>(null);
  const [historyItem, setHistoryItem] = useState<InventoryItem | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const path = open && userId ? `users/${userId}` : "";
  const { data: editLogs } = useCollection<EditLog>(path ? `${path}/editLogs` : "");
  const { data: deleteLogs } = useCollection<DeleteLog>(path ? `${path}/deleteLogs` : "");
  const { data: restockHistory } = useCollection<RestockHistory>(path ? `${path}/restockHistory` : "");
  const { data: shipped } = useCollection<ShippedItem>(path ? `${path}/shipped` : "");
  const { data: inventoryRequests } = useCollection<InventoryRequest>(
    path ? `${path}/inventoryRequests` : ""
  );
  const { data: recycledInventory } = useCollection<RecycledInventoryItem>(
    path ? `${path}/recycledInventory` : ""
  );
  const { data: inventoryChangeLogs } = useCollection<InventoryChangeLog>(
    path ? `${path}/inventoryChangeLogs` : ""
  );

  const inventoryById = useMemo(
    () => new Map(inventoryItems.map((item) => [item.id, item])),
    [inventoryItems]
  );

  const historySources = useMemo(
    () => ({
      editLogs,
      deleteLogs,
      restockHistory,
      shipped,
      inventoryRequests,
      inventoryTransfers: [],
      recycledInventory,
      inventoryChangeLogs,
    }),
    [
      editLogs,
      deleteLogs,
      restockHistory,
      shipped,
      inventoryRequests,
      recycledInventory,
      inventoryChangeLogs,
    ]
  );

  const stockOutByItemId = useMemo(() => {
    const map = new Map<
      string,
      { summary: ReturnType<typeof findLastStockOutCause>; history: InventoryHistoryRow[] }
    >();
    for (const row of items) {
      const item = inventoryById.get(row.id);
      if (!item) continue;
      map.set(row.id, {
        summary: findLastStockOutCause(item, historySources),
        history: buildInventoryHistory(item, historySources),
      });
    }
    return map;
  }, [items, inventoryById, historySources]);

  useEffect(() => {
    if (!open) {
      setSearchTerm("");
      setStartDate("");
      setEndDate("");
      setSourceFilter("all");
      setDateField("added");
      setExpandedId(null);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const startMs = startDate ? new Date(`${startDate}T00:00:00`).getTime() : null;
    const endMs = endDate ? new Date(`${endDate}T23:59:59.999`).getTime() : null;

    return items
      .filter((item) => {
        if (sourceFilter !== "all") {
          const src = (item.source ?? "warehouse").toLowerCase();
          if (sourceFilter === "warehouse" && src !== "warehouse") return false;
          if (sourceFilter !== "warehouse" && src !== sourceFilter) return false;
        }

        const compareDate =
          dateField === "receiving" ? item.receivingDate : item.dateAdded;
        const dateMs = getTimestampMs(compareDate);
        if (startMs != null && dateMs < startMs) return false;
        if (endMs != null && dateMs > endMs) return false;

        if (!query) return true;

        const productName = (item.productName || "").toLowerCase();
        const sku = (item.sku || "").toLowerCase();
        const variant = (item.variantLabel || "").toLowerCase();
        const identifier = (item.retailIdentifier || "").toLowerCase();
        const remarks = (item.remarks || "").toLowerCase();
        const stockOut = stockOutByItemId.get(item.id)?.summary;
        const stockOutText = stockOut ? formatStockOutSummary(stockOut).toLowerCase() : "";

        return (
          productName.includes(query) ||
          sku.includes(query) ||
          variant.includes(query) ||
          identifier.includes(query) ||
          remarks.includes(query) ||
          stockOutText.includes(query)
        );
      })
      .sort((a, b) => getTimestampMs(b.dateAdded) - getTimestampMs(a.dateAdded));
  }, [items, searchTerm, startDate, endDate, sourceFilter, dateField, stockOutByItemId]);

  function openFullHistory(itemId: string) {
    const item = inventoryById.get(itemId);
    if (!item) return;
    setHistoryItem(item);
    setHistoryOpen(true);
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-xl md:max-w-3xl lg:max-w-4xl"
        >
          <SheetHeader className="space-y-1 border-b px-6 pb-4 pt-6 pr-14 text-left">
            <SheetTitle className="text-xl tracking-tight">Out of stock</SheetTitle>
            <SheetDescription>
              {filtered.length} of {items.length} product
              {items.length === 1 ? "" : "s"} — see why each item went out of stock and open full
              history.
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-1 flex-col gap-4 overflow-hidden px-6 py-4">
            <div className="space-y-3 shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search product, SKU, identifier, or out-of-stock reason..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
                {searchTerm ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-2 top-1/2 h-6 w-6 -translate-y-1/2 p-0"
                    onClick={() => setSearchTerm("")}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                ) : null}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">From date</label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">To date</label>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Date applies to</label>
                  <Select value={dateField} onValueChange={(v: "added" | "receiving") => setDateField(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="added">Date added</SelectItem>
                      <SelectItem value="receiving">Receiving date</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Source</label>
                  <Select value={sourceFilter} onValueChange={setSourceFilter}>
                    <SelectTrigger>
                      <Filter className="mr-2 h-4 w-4 shrink-0" />
                      <SelectValue placeholder="All sources" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All sources</SelectItem>
                      <SelectItem value="warehouse">Warehouse / manual</SelectItem>
                      <SelectItem value="shopify">Shopify</SelectItem>
                      <SelectItem value="ebay">eBay</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {(startDate || endDate || searchTerm || sourceFilter !== "all") && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearchTerm("");
                    setStartDate("");
                    setEndDate("");
                    setSourceFilter("all");
                    setDateField("added");
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-auto rounded-md border">
              {filtered.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  No out-of-stock items match your filters.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="hidden md:table-cell">SKU</TableHead>
                      <TableHead>Why out of stock</TableHead>
                      <TableHead className="w-[88px] text-right">History</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((item) => {
                      const src = item.source?.trim() || "Warehouse";
                      const stockOut = stockOutByItemId.get(item.id);
                      const summary = stockOut?.summary;
                      const recentDecreases = (stockOut?.history ?? [])
                        .filter((row) => row.qtyChange != null && row.qtyChange < 0)
                        .sort((a, b) => b.timestamp - a.timestamp)
                        .slice(0, 3);
                      const isExpanded = expandedId === item.id;

                      return (
                        <Fragment key={item.id}>
                          <TableRow>
                            <TableCell>
                              <div className="space-y-0.5">
                                <p className="font-medium text-sm">{item.productName}</p>
                                {item.variantLabel ? (
                                  <p className="text-xs text-muted-foreground">{item.variantLabel}</p>
                                ) : null}
                                <p className="text-xs text-muted-foreground md:hidden">
                                  {item.sku || "No SKU"} · Qty {item.quantity ?? 0}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Added {formatDisplayDate(item.dateAdded)} · {src}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell className="hidden md:table-cell font-mono text-xs">
                              {item.sku || "N/A"}
                            </TableCell>
                            <TableCell>
                              {summary ? (
                                <button
                                  type="button"
                                  className="text-left text-xs leading-relaxed text-foreground hover:underline"
                                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                                >
                                  {formatStockOutSummary(summary)}
                                </button>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  No outbound history found yet.
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 px-2"
                                onClick={() => openFullHistory(item.id)}
                              >
                                <History className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                          {isExpanded && recentDecreases.length > 0 ? (
                            <TableRow key={`${item.id}-history`} className="bg-muted/30 hover:bg-muted/30">
                              <TableCell colSpan={4} className="py-3">
                                <div className="space-y-2">
                                  <p className="text-xs font-medium text-muted-foreground">
                                    Recent stock decreases
                                  </p>
                                  <div className="space-y-1.5">
                                    {recentDecreases.map((row) => (
                                      <div
                                        key={`${row.timestamp}-${row.event}-${row.seq}`}
                                        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
                                      >
                                        <span className="font-medium">{row.event}</span>
                                        <span className="text-muted-foreground">{row.dateLabel}</span>
                                        <span>{formatChangeCell(row.qtyChange)} units</span>
                                        {row.qtyBefore != null && row.qtyAfter != null ? (
                                          <span className="text-muted-foreground">
                                            ({row.qtyBefore} → {row.qtyAfter})
                                          </span>
                                        ) : null}
                                        {row.details ? (
                                          <span className="text-muted-foreground">· {row.details}</span>
                                        ) : null}
                                      </div>
                                    ))}
                                  </div>
                                  {(item.remarks?.trim() || (item.imageUrls?.length ?? 0) > 0) && (
                                    <Button
                                      type="button"
                                      variant="link"
                                      size="sm"
                                      className="h-auto px-0 text-xs"
                                      onClick={() =>
                                        setRemarksPreview({
                                          text: item.remarks?.trim() || "No remarks.",
                                          imageUrls: item.imageUrls ?? [],
                                        })
                                      }
                                    >
                                      View remarks / photos
                                      <Eye className="ml-1 h-3 w-3" />
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <InventoryHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        item={historyItem}
        userId={userId}
        ownerLabel={ownerLabel}
      />

      <Dialog open={remarksPreview !== null} onOpenChange={(o) => !o && setRemarksPreview(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Remarks</DialogTitle>
          </DialogHeader>
          <p className="text-sm whitespace-pre-wrap break-words">{remarksPreview?.text}</p>
          {remarksPreview?.imageUrls.length ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {remarksPreview.imageUrls.map((url) => (
                <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                  <img src={url} alt="" className="rounded-md border object-cover w-full aspect-square" />
                </a>
              ))}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
