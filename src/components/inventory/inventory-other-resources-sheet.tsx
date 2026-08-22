"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Boxes, Filter, Search, X } from "lucide-react";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  INTEGRATION_INVENTORY_SOURCES,
  integrationInventorySourceBadgeClass,
  integrationInventorySourceLabel,
  isIntegrationInventorySource,
  type IntegrationInventorySource,
} from "@/lib/integration-inventory-sources";

export type OtherResourcesInventoryRow = {
  id: string;
  productName: string;
  sku?: string;
  variantLabel?: string;
  retailIdentifier?: string;
  quantity?: number;
  status?: string;
  dateAdded?: unknown;
  shop?: string;
  source?: string;
  imageUrls?: string[];
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

function shopDetail(item: OtherResourcesInventoryRow): string | undefined {
  const shop = String(item.shop ?? "")
    .trim()
    .replace(/\.myshopify\.com$/i, "");
  return shop || undefined;
}

type ResourceTab = "all" | IntegrationInventorySource;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: OtherResourcesInventoryRow[];
};

export function InventoryOtherResourcesSheet({ open, onOpenChange, items }: Props) {
  const [resourceTab, setResourceTab] = useState<ResourceTab>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const countsBySource = useMemo(() => {
    const counts: Record<string, number> = { all: items.length };
    for (const source of INTEGRATION_INVENTORY_SOURCES) {
      counts[source] = 0;
    }
    for (const item of items) {
      if (isIntegrationInventorySource(item.source)) {
        counts[item.source] = (counts[item.source] || 0) + 1;
      }
    }
    return counts;
  }, [items]);

  const filtered = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    return items
      .filter((item) => {
        if (!isIntegrationInventorySource(item.source)) return false;
        if (resourceTab !== "all" && item.source !== resourceTab) return false;
        if (statusFilter !== "all" && String(item.status || "") !== statusFilter) return false;
        if (!query) return true;
        const haystack = [
          item.productName,
          item.sku,
          item.variantLabel,
          item.retailIdentifier,
          item.shop,
          integrationInventorySourceLabel(item.source),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => getTimestampMs(b.dateAdded) - getTimestampMs(a.dateAdded));
  }, [items, resourceTab, searchTerm, statusFilter]);

  const clearFilters = () => {
    setSearchTerm("");
    setStatusFilter("all");
    setResourceTab("all");
  };

  const hasActiveFilters =
    Boolean(searchTerm) || statusFilter !== "all" || resourceTab !== "all";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl md:max-w-3xl lg:max-w-4xl"
      >
        <SheetHeader className="space-y-1 border-b px-6 pb-4 pt-6 pr-14 text-left">
          <SheetTitle className="flex items-center gap-2 text-xl tracking-tight">
            <Boxes className="h-5 w-5" />
            Other resources
          </SheetTitle>
          <SheetDescription>
            Integration products from Shopify, eBay, WooCommerce, and TikTok Shop.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-4 overflow-hidden px-6 py-4">
          <div className="space-y-3 shrink-0">
            <Tabs
              value={resourceTab}
              onValueChange={(value) => setResourceTab(value as ResourceTab)}
            >
              <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
                <TabsTrigger value="all" className="text-xs sm:text-sm">
                  All ({countsBySource.all || 0})
                </TabsTrigger>
                {INTEGRATION_INVENTORY_SOURCES.map((source) => (
                  <TabsTrigger key={source} value={source} className="text-xs sm:text-sm">
                    {integrationInventorySourceLabel(source)} ({countsBySource[source] || 0})
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search product, SKU, store, or identifier..."
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

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="space-y-1.5 sm:w-[200px]">
                <label className="text-xs font-medium text-muted-foreground">Status</label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <Filter className="mr-2 h-4 w-4 shrink-0" />
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="In Stock">In Stock</SelectItem>
                    <SelectItem value="Out of Stock">Out of Stock</SelectItem>
                    <SelectItem value="Pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {hasActiveFilters ? (
                <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : null}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto rounded-md border">
            {filtered.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                No other-resource products match your filters.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="hidden md:table-cell">SKU</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="hidden sm:table-cell">Status</TableHead>
                    <TableHead className="hidden lg:table-cell">Added</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((item) => {
                    const sourceLabel = integrationInventorySourceLabel(item.source);
                    const detail = shopDetail(item);
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="max-w-[220px]">
                          <div className="min-w-0">
                            <p className="truncate font-medium" title={item.productName}>
                              {item.productName || "Untitled"}
                            </p>
                            {item.variantLabel ? (
                              <p className="truncate text-xs text-muted-foreground">
                                {item.variantLabel}
                              </p>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="hidden max-w-[140px] truncate md:table-cell">
                          {item.sku || "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <Badge
                              variant="outline"
                              className={integrationInventorySourceBadgeClass(item.source)}
                            >
                              {sourceLabel}
                            </Badge>
                            {detail ? (
                              <span className="truncate text-[11px] text-muted-foreground">
                                {detail}
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {Number(item.quantity) || 0}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <Badge
                            variant={
                              item.status === "Out of Stock" ? "secondary" : "outline"
                            }
                          >
                            {item.status || "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground lg:table-cell">
                          {formatDisplayDate(item.dateAdded)}
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
  );
}
