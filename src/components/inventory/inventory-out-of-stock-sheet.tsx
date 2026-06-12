"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Eye, Filter, Search, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
};

export function InventoryOutOfStockSheet({ open, onOpenChange, items }: Props) {
  const [searchTerm, setSearchTerm] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [dateField, setDateField] = useState<"added" | "receiving">("added");
  const [remarksPreview, setRemarksPreview] = useState<{
    text: string;
    imageUrls: string[];
  } | null>(null);

  useEffect(() => {
    if (!open) {
      setSearchTerm("");
      setStartDate("");
      setEndDate("");
      setSourceFilter("all");
      setDateField("added");
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

        return (
          productName.includes(query) ||
          sku.includes(query) ||
          variant.includes(query) ||
          identifier.includes(query) ||
          remarks.includes(query)
        );
      })
      .sort((a, b) => getTimestampMs(b.dateAdded) - getTimestampMs(a.dateAdded));
  }, [items, searchTerm, startDate, endDate, sourceFilter, dateField]);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-xl md:max-w-2xl lg:max-w-3xl"
        >
          <SheetHeader className="space-y-1 border-b px-6 pb-4 pt-6 pr-14 text-left">
            <SheetTitle className="text-xl tracking-tight">Out of stock</SheetTitle>
            <SheetDescription>
              {filtered.length} of {items.length} product
              {items.length === 1 ? "" : "s"} — search, filter by date, or source.
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-1 flex-col gap-4 overflow-hidden px-6 py-4">
            <div className="space-y-3 shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search product, SKU, identifier, or remarks..."
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
                      <TableHead>Qty</TableHead>
                      <TableHead className="hidden sm:table-cell">Added</TableHead>
                      <TableHead className="hidden lg:table-cell">Source</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((item) => {
                      const src = item.source?.trim() || "Warehouse";
                      return (
                        <TableRow key={item.id}>
                          <TableCell>
                            <div className="space-y-0.5">
                              <p className="font-medium text-sm">{item.productName}</p>
                              {item.variantLabel ? (
                                <p className="text-xs text-muted-foreground">{item.variantLabel}</p>
                              ) : null}
                              <p className="text-xs text-muted-foreground md:hidden">
                                {item.sku || "No SKU"}
                              </p>
                              {(item.remarks?.trim() || (item.imageUrls?.length ?? 0) > 0) && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-auto justify-start px-0 py-0 text-left text-xs text-blue-600 lg:hidden"
                                  onClick={() =>
                                    setRemarksPreview({
                                      text: item.remarks?.trim() || "No remarks.",
                                      imageUrls: item.imageUrls ?? [],
                                    })
                                  }
                                >
                                  <span className="line-clamp-2">{item.remarks || "View photos"}</span>
                                  <Eye className="ml-1 inline h-3 w-3 shrink-0" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="hidden md:table-cell font-mono text-xs">
                            {item.sku || "N/A"}
                          </TableCell>
                          <TableCell className="text-sm">{item.quantity ?? 0}</TableCell>
                          <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                            {formatDisplayDate(item.dateAdded)}
                          </TableCell>
                          <TableCell className="hidden lg:table-cell text-xs capitalize text-muted-foreground">
                            {src}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>

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
