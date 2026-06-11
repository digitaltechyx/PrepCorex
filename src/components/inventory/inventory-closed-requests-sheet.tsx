"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Eye, Filter, Search, X } from "lucide-react";
import type { InventoryRequest } from "@/types";
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
import { formatInboundQuantityDisplay } from "@/lib/inventory-qty-display";

export type ClosedRequestMode = "rejected" | "cancelled";

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
  return 0;
}

function formatDisplayDate(date: unknown): string {
  const ms = getTimestampMs(date);
  if (!ms) return "N/A";
  return format(new Date(ms), "MMM d, yyyy");
}

function getImageUrls(data: { imageUrl?: string; imageUrls?: string[] } | undefined): string[] {
  if (!data) return [];
  if (Array.isArray(data.imageUrls) && data.imageUrls.length > 0) return data.imageUrls;
  if (typeof data.imageUrl === "string" && data.imageUrl.length > 0) return [data.imageUrl];
  return [];
}

function statusDateForRequest(req: InventoryRequest, mode: ClosedRequestMode): unknown {
  if (mode === "rejected") return req.rejectedAt ?? req.addDate ?? req.requestedAt;
  return req.cancelledAt ?? req.addDate ?? req.requestedAt;
}

function reasonForRequest(req: InventoryRequest, mode: ClosedRequestMode): string {
  if (mode === "rejected") return req.rejectionReason?.trim() || req.remarks?.trim() || "";
  return req.cancellationReason?.trim() || req.remarks?.trim() || "";
}

const INVENTORY_TYPE_LABELS: Record<InventoryRequest["inventoryType"], string> = {
  product: "Product",
  box: "Box",
  pallet: "Pallet",
  container: "Container",
};

type Props = {
  mode: ClosedRequestMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requests: InventoryRequest[];
};

export function InventoryClosedRequestsSheet({ mode, open, onOpenChange, requests }: Props) {
  const [searchTerm, setSearchTerm] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [inventoryTypeFilter, setInventoryTypeFilter] = useState<string>("all");
  const [dateField, setDateField] = useState<"status" | "submitted">("status");
  const [remarksPreview, setRemarksPreview] = useState<{
    title: string;
    text: string;
    imageUrls: string[];
  } | null>(null);

  useEffect(() => {
    if (!open) {
      setSearchTerm("");
      setStartDate("");
      setEndDate("");
      setInventoryTypeFilter("all");
      setDateField("status");
    }
  }, [open]);

  const modeRequests = useMemo(
    () => requests.filter((req) => req.status === mode),
    [requests, mode]
  );

  const filtered = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const startMs = startDate ? new Date(`${startDate}T00:00:00`).getTime() : null;
    const endMs = endDate ? new Date(`${endDate}T23:59:59.999`).getTime() : null;

    return modeRequests
      .filter((req) => {
        if (inventoryTypeFilter !== "all" && req.inventoryType !== inventoryTypeFilter) {
          return false;
        }

        const compareDate =
          dateField === "status"
            ? statusDateForRequest(req, mode)
            : req.addDate ?? req.requestedAt;
        const dateMs = getTimestampMs(compareDate);

        if (startMs != null && dateMs < startMs) return false;
        if (endMs != null && dateMs > endMs) return false;

        if (!query) return true;

        const reason = reasonForRequest(req, mode).toLowerCase();
        const productName = (req.productName || "").toLowerCase();
        const sku = (req.sku || "").toLowerCase();
        const variant = (req.variantLabel || "").toLowerCase();
        const identifier = (req.retailIdentifier || "").toLowerCase();

        return (
          productName.includes(query) ||
          sku.includes(query) ||
          variant.includes(query) ||
          identifier.includes(query) ||
          reason.includes(query)
        );
      })
      .sort(
        (a, b) =>
          getTimestampMs(statusDateForRequest(b, mode)) -
          getTimestampMs(statusDateForRequest(a, mode))
      );
  }, [modeRequests, searchTerm, startDate, endDate, inventoryTypeFilter, dateField, mode]);

  const title = mode === "rejected" ? "Rejected requests" : "Cancelled requests";
  const statusLabel = mode === "rejected" ? "Rejected" : "Cancelled";
  const reasonLabel = mode === "rejected" ? "Rejection reason" : "Cancellation reason";

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-xl md:max-w-2xl lg:max-w-3xl"
        >
          <SheetHeader className="space-y-1 border-b px-6 pb-4 pt-6 pr-14 text-left">
            <SheetTitle className="text-xl tracking-tight">{title}</SheetTitle>
            <SheetDescription>
              {filtered.length} of {modeRequests.length} inbound{" "}
              {modeRequests.length === 1 ? "request" : "requests"} — search, filter by date, or
              inventory type.
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-1 flex-col gap-4 overflow-hidden px-6 py-4">
            <div className="space-y-3 shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search product, SKU, identifier, or reason..."
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
                  <Select value={dateField} onValueChange={(v: "status" | "submitted") => setDateField(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="status">
                        {mode === "rejected" ? "Rejected date" : "Cancelled date"}
                      </SelectItem>
                      <SelectItem value="submitted">Date submitted</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Inventory type</label>
                  <Select value={inventoryTypeFilter} onValueChange={setInventoryTypeFilter}>
                    <SelectTrigger>
                      <Filter className="mr-2 h-4 w-4 shrink-0" />
                      <SelectValue placeholder="All types" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      <SelectItem value="product">Product</SelectItem>
                      <SelectItem value="box">Box</SelectItem>
                      <SelectItem value="pallet">Pallet</SelectItem>
                      <SelectItem value="container">Container</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {(startDate || endDate || searchTerm || inventoryTypeFilter !== "all") && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearchTerm("");
                    setStartDate("");
                    setEndDate("");
                    setInventoryTypeFilter("all");
                    setDateField("status");
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-auto rounded-md border">
              {filtered.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  No {mode} requests match your filters.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="hidden md:table-cell">SKU</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead className="hidden sm:table-cell">Submitted</TableHead>
                      <TableHead>{statusLabel}</TableHead>
                      <TableHead className="hidden lg:table-cell">{reasonLabel}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((req) => {
                      const reason = reasonForRequest(req, mode);
                      const imageUrls = getImageUrls(req);
                      const statusDate = statusDateForRequest(req, mode);
                      return (
                        <TableRow key={req.id}>
                          <TableCell>
                            <div className="space-y-0.5">
                              <p className="font-medium text-sm">{req.productName}</p>
                              <p className="text-xs text-muted-foreground md:hidden">
                                {req.sku || "No SKU"}
                              </p>
                              <Badge variant="outline" className="text-[10px]">
                                {INVENTORY_TYPE_LABELS[req.inventoryType]}
                              </Badge>
                              {(reason || imageUrls.length > 0) && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-auto justify-start px-0 py-0 text-left text-xs text-blue-600 lg:hidden"
                                  onClick={() =>
                                    setRemarksPreview({
                                      title: reasonLabel,
                                      text: reason || "No text provided.",
                                      imageUrls,
                                    })
                                  }
                                >
                                  <span className="line-clamp-2">{reason || "View photos"}</span>
                                  <Eye className="ml-1 inline h-3 w-3 shrink-0" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="hidden md:table-cell font-mono text-xs">
                            {req.sku || "N/A"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {formatInboundQuantityDisplay({
                              quantity: req.quantity,
                              requestedQuantity: req.requestedQuantity ?? req.quantity,
                              receivedQuantity: req.receivedQuantity,
                              isRequest: false,
                              status: mode,
                            })}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                            {formatDisplayDate(req.addDate ?? req.requestedAt)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDisplayDate(statusDate)}
                          </TableCell>
                          <TableCell className="hidden lg:table-cell max-w-[200px]">
                            {reason || imageUrls.length > 0 ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-auto max-w-full justify-start px-0 py-0 text-left text-xs text-blue-600"
                                onClick={() =>
                                  setRemarksPreview({
                                    title: reasonLabel,
                                    text: reason || "No text provided.",
                                    imageUrls,
                                  })
                                }
                              >
                                <span className="line-clamp-2">{reason || "View photos"}</span>
                                <Eye className="ml-1 inline h-3 w-3 shrink-0" />
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
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
            <DialogTitle>{remarksPreview?.title}</DialogTitle>
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
