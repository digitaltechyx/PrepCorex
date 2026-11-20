"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  buildShopifyOrdersCsv,
  downloadShopifyOrdersCsv,
  filterShopifyOrdersForCsv,
  type ShopifyOrderCsvRow,
} from "@/lib/shopify-orders-csv";

type Props = {
  orders: ShopifyOrderCsvRow[];
  /** Used in download filename, e.g. shopify-orders-admin */
  filePrefix?: string;
  disabled?: boolean;
};

export function ShopifyOrdersCsvDownload({
  orders,
  filePrefix = "shopify-orders",
  disabled,
}: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"all" | "range">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const previewCount = useMemo(() => {
    return filterShopifyOrdersForCsv(orders, { mode, from, to }).length;
  }, [orders, mode, from, to]);

  const handleDownload = () => {
    if (mode === "range" && !from && !to) {
      toast({
        variant: "destructive",
        title: "Choose dates",
        description: "Pick a From and/or To date for a custom range export.",
      });
      return;
    }
    const rows = filterShopifyOrdersForCsv(orders, { mode, from, to });
    if (rows.length === 0) {
      toast({
        variant: "destructive",
        title: "No orders to export",
        description:
          mode === "all"
            ? "There are no orders loaded to download."
            : "No orders in that date range.",
      });
      return;
    }
    const stamp = format(new Date(), "yyyy-MM-dd");
    const rangePart =
      mode === "all"
        ? "all-time"
        : `from-${from || "start"}_to-${to || "end"}`;
    const csv = buildShopifyOrdersCsv(rows);
    downloadShopifyOrdersCsv(csv, `${filePrefix}-${rangePart}-${stamp}.csv`);
    toast({
      title: "CSV downloaded",
      description: `${rows.length} order(s) exported.`,
    });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled || orders.length === 0}>
          <Download className="mr-2 h-4 w-4" />
          Download CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Download Shopify orders CSV</DialogTitle>
          <DialogDescription>
            Export order details for your team. Choose all loaded orders or a custom date range
            (by order placed date).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Range</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant={mode === "all" ? "default" : "outline"}
                className="flex-1"
                onClick={() => setMode("all")}
              >
                All time (loaded)
              </Button>
              <Button
                type="button"
                variant={mode === "range" ? "default" : "outline"}
                className="flex-1"
                onClick={() => setMode("range")}
              >
                Custom dates
              </Button>
            </div>
          </div>

          {mode === "range" ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="shopify-csv-from">From</Label>
                <Input
                  id="shopify-csv-from"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shopify-csv-to">To</Label>
                <Input
                  id="shopify-csv-to"
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
            </div>
          ) : null}

          <p className="text-sm text-muted-foreground">
            {previewCount} order(s) will be included in this download.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleDownload}>
            <Download className="mr-2 h-4 w-4" />
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
