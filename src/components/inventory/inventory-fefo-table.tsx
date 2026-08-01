"use client";

import { useMemo, useState } from "react";
import { addMonths, endOfDay, format, startOfDay } from "date-fns";
import { AlertTriangle, CalendarClock, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
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
import type { ClientFefoStockRow } from "@/lib/client-fefo-stock";

type Props = {
  rows: ClientFefoStockRow[];
  loading: boolean;
  error: string | null;
};

const ALL_PRODUCTS = "__all__";

function formatExpiry(expiry: string): string {
  const date = new Date(`${expiry}T12:00:00`);
  return Number.isNaN(date.getTime()) ? expiry : format(date, "MMM d, yyyy");
}

function productFilterKey(row: Pick<ClientFefoStockRow, "sku" | "productTitle">): string {
  const sku = row.sku.trim();
  if (sku) return `sku:${sku.toLowerCase()}`;
  return `name:${row.productTitle.trim().toLowerCase()}`;
}

export function InventoryFefoTable({ rows, loading, error }: Props) {
  const [fromDate, setFromDate] = useState<Date | undefined>();
  const [toDate, setToDate] = useState<Date | undefined>(() => addMonths(new Date(), 6));
  const [preset, setPreset] = useState<"3" | "6" | "all" | "custom">("6");
  const [productFilter, setProductFilter] = useState<string>(ALL_PRODUCTS);

  const productOptions = useMemo(() => {
    const byKey = new Map<string, { key: string; label: string; sku: string }>();
    for (const row of rows) {
      const key = productFilterKey(row);
      if (byKey.has(key)) continue;
      const sku = row.sku.trim();
      byKey.set(key, {
        key,
        label: row.productTitle.trim() || sku || "Product",
        sku,
      });
    }
    return Array.from(byKey.values()).sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
    );
  }, [rows]);

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        if (productFilter !== ALL_PRODUCTS && productFilterKey(row) !== productFilter) {
          return false;
        }
        const expiry = new Date(`${row.expiry}T12:00:00`);
        if (Number.isNaN(expiry.getTime())) return false;
        if (fromDate && expiry < startOfDay(fromDate)) return false;
        if (toDate && expiry > endOfDay(toDate)) return false;
        return true;
      }),
    [fromDate, productFilter, rows, toDate]
  );

  const selectedProductLabel =
    productFilter === ALL_PRODUCTS
      ? null
      : productOptions.find((p) => p.key === productFilter)?.label ?? null;

  const applyPreset = (months: 3 | 6) => {
    setPreset(String(months) as "3" | "6");
    setFromDate(undefined);
    setToDate(addMonths(new Date(), months));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading expiry batches…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 sm:mx-0">
        <div className="flex items-center gap-2 font-medium">
          <AlertTriangle className="h-4 w-4" />
          Could not load FEFO inventory
        </div>
        <p className="mt-1">{error}</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="mx-6 flex flex-col items-center gap-2 rounded-lg border border-dashed py-14 text-center sm:mx-0">
        <CalendarClock className="h-9 w-9 text-muted-foreground/60" />
        <p className="font-medium">No expiry-managed stock</p>
        <p className="text-sm text-muted-foreground">
          Inventory appears here when Warehouse Ops or an admin records an expiry date.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 px-4 sm:px-0">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={preset === "3" ? "default" : "outline"}
            onClick={() => applyPreset(3)}
          >
            Expired + next 3 months
          </Button>
          <Button
            type="button"
            size="sm"
            variant={preset === "6" ? "default" : "outline"}
            onClick={() => applyPreset(6)}
          >
            Expired + next 6 months
          </Button>
          <Button
            type="button"
            size="sm"
            variant={preset === "all" ? "default" : "outline"}
            onClick={() => {
              setPreset("all");
              setFromDate(undefined);
              setToDate(undefined);
            }}
          >
            All expiry dates
          </Button>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="w-full sm:w-[320px]">
            <Select value={productFilter} onValueChange={setProductFilter}>
              <SelectTrigger aria-label="Filter by product">
                <SelectValue placeholder="All products" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_PRODUCTS}>All products</SelectItem>
                {productOptions.map((product) => (
                  <SelectItem key={product.key} value={product.key}>
                    <span className="truncate">
                      {product.label}
                      {product.sku ? (
                        <span className="text-muted-foreground"> · {product.sku}</span>
                      ) : null}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DateRangePicker
            fromDate={fromDate}
            toDate={toDate}
            setFromDate={(date) => {
              setPreset("custom");
              setFromDate(date);
            }}
            setToDate={(date) => {
              setPreset("custom");
              setToDate(date);
            }}
            className="sm:w-[300px]"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Showing {filteredRows.length} expiry entr{filteredRows.length === 1 ? "y" : "ies"}
          {selectedProductLabel ? ` for “${selectedProductLabel}”` : ""} from earliest to latest.
        </p>
      </div>

      {filteredRows.length === 0 ? (
        <div className="mx-6 flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center sm:mx-0">
          <CalendarClock className="h-8 w-8 text-muted-foreground/60" />
          <p className="font-medium">
            {selectedProductLabel
              ? "No expiry batches for this product in the selected date range"
              : "No inventory expires in this date range"}
          </p>
          {selectedProductLabel ? (
            <p className="text-sm text-muted-foreground">
              Try “All expiry dates”, or clear the product filter.
            </p>
          ) : null}
        </div>
      ) : (
        <>
      <div className="space-y-3 px-4 sm:hidden">
        {filteredRows.map((row, index) => (
          <div key={row.key} className="rounded-lg border bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{row.productTitle}</p>
                <p className="text-xs text-muted-foreground">SKU: {row.sku}</p>
              </div>
              <Badge variant={row.expired ? "destructive" : "outline"}>
                {row.expired ? "Expired" : index === 0 ? "Expires first" : formatExpiry(row.expiry)}
              </Badge>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Expiry</p>
                <p className="font-medium">{formatExpiry(row.expiry)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Quantity</p>
                <p className="font-bold">{row.quantity}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-lg border sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Priority</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Expiry</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.map((row, index) => (
              <TableRow key={row.key}>
                <TableCell>
                  {row.expired ? (
                    <Badge variant="destructive">Expired</Badge>
                  ) : index === 0 ? (
                    <Badge className="bg-amber-500 text-white">Expires first</Badge>
                  ) : (
                    <span className="text-sm text-muted-foreground">{index + 1}</span>
                  )}
                </TableCell>
                <TableCell className="font-medium">{row.productTitle}</TableCell>
                <TableCell className="whitespace-nowrap">{row.sku}</TableCell>
                <TableCell className="whitespace-nowrap">{formatExpiry(row.expiry)}</TableCell>
                <TableCell className="text-right text-base font-bold">{row.quantity}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
        </>
      )}
    </>
  );
}
