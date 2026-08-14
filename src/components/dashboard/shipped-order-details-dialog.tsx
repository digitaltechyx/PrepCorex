"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatServiceLabel, type InventoryItem } from "@/types";
import type { ShippedOrderDetails } from "@/lib/shipment-utils";
import { useToast } from "@/hooks/use-toast";
import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";

function money(n: number): string {
  return `$${Number(n || 0).toFixed(2)}`;
}

export type ShippedOrderCorrectionContext = {
  userId: string;
  shippedId: string;
  inventory: InventoryItem[];
  getAuthToken: () => Promise<string>;
  onCorrected?: () => void;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  details: ShippedOrderDetails | null;
  /** When set, admin can correct warehouse product on Quick Fulfill lines. */
  correction?: ShippedOrderCorrectionContext | null;
  allowCorrectWarehouseProduct?: boolean;
};

export function ShippedOrderDetailsDialog({
  open,
  onOpenChange,
  details,
  correction = null,
  allowCorrectWarehouseProduct = false,
}: Props) {
  const { toast } = useToast();
  const [correctingLineIndex, setCorrectingLineIndex] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const [selectedInventoryId, setSelectedInventoryId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setCorrectingLineIndex(null);
      setPickerOpen(false);
      setPickerSearch("");
      setSelectedInventoryId("");
      setSubmitting(false);
    }
  }, [open]);

  const selectableInventory = useMemo(() => {
    const list = correction?.inventory || [];
    return list
      .filter((item) => item.status !== "Out of Stock" || item.quantity > 0)
      .sort((a, b) => {
        const aShopify = a.source === "shopify" ? 1 : 0;
        const bShopify = b.source === "shopify" ? 1 : 0;
        if (aShopify !== bShopify) return aShopify - bShopify;
        return a.productName.localeCompare(b.productName);
      });
  }, [correction?.inventory]);

  const filteredInventory = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return selectableInventory;
    return selectableInventory.filter(
      (item) =>
        item.productName.toLowerCase().includes(q) ||
        String(item.sku || "")
          .toLowerCase()
          .includes(q)
    );
  }, [selectableInventory, pickerSearch]);

  const canCorrect = Boolean(allowCorrectWarehouseProduct && correction?.userId && correction.shippedId);

  const submitCorrection = async () => {
    if (!correction || correctingLineIndex == null || !selectedInventoryId) return;
    setSubmitting(true);
    try {
      const token = await correction.getAuthToken();
      const res = await fetch("/api/shopify/correct-quick-fulfill-product", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId: correction.userId,
          shippedId: correction.shippedId,
          lineIndex: correctingLineIndex,
          newInventoryId: selectedInventoryId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Correction failed");
      }
      toast({
        title: "Warehouse product corrected",
        description:
          "Stock moved to the correct product. Shopify order fulfillment was left unchanged.",
      });
      if (Array.isArray(data.syncErrors) && data.syncErrors.length) {
        toast({
          variant: "destructive",
          title: "Corrected in PrepCorex; Shopify sync had issues",
          description: data.syncErrors.slice(0, 2).join("; "),
        });
      }
      if (Number(data.warehouseShortfall) > 0) {
        toast({
          variant: "destructive",
          title: "Client inventory corrected; some bin qty was not found",
          description: `Could not fully adjust Warehouse Ops bins (${data.warehouseShortfall} unit shortfall).`,
        });
      }
      setCorrectingLineIndex(null);
      setSelectedInventoryId("");
      onOpenChange(false);
      correction.onCorrected?.();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not correct product",
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(n) => !submitting && onOpenChange(n)}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Shipment details</DialogTitle>
          <DialogDescription>
            {details?.title || "Products shipped and shipment total"}
          </DialogDescription>
        </DialogHeader>

        {!details ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No shipment selected.</p>
        ) : (
          <div className="space-y-4 overflow-y-auto pr-1">
            <div className="flex flex-wrap gap-2 text-xs">
              {details.status ? (
                <Badge variant="secondary" className="font-normal">
                  {details.status}
                </Badge>
              ) : null}
              {details.dateLabel ? (
                <span className="text-muted-foreground self-center">{details.dateLabel}</span>
              ) : null}
              {details.service ? (
                <span className="text-muted-foreground self-center">
                  {formatServiceLabel(details.service)}
                </span>
              ) : null}
              {details.productType ? (
                <span className="text-muted-foreground self-center">{details.productType}</span>
              ) : null}
            </div>

            {details.shipTo ? (
              <div className="rounded-md border bg-muted/30 p-3 text-xs">
                <div className="font-medium text-sm mb-1">Ship to</div>
                <p className="whitespace-pre-wrap text-muted-foreground">{details.shipTo}</p>
              </div>
            ) : null}

            <div className="space-y-2">
              <div className="text-sm font-medium">
                What was shipped ({details.totalSkus} SKU
                {details.totalSkus === 1 ? "" : "s"})
              </div>
              {details.lines.map((line, index) => {
                const selected = selectableInventory.find((i) => i.id === selectedInventoryId);
                const isEditing = correctingLineIndex === index;
                return (
                  <div
                    key={`${line.productName}-${index}`}
                    className="rounded-md border p-3 text-xs space-y-1.5"
                  >
                    <div className="font-medium text-sm">{line.productName}</div>
                    {(line.sku ||
                      line.retailIdentifier ||
                      line.shopifyLineTitle ||
                      line.shopifyLineSku ||
                      canCorrect) && (
                      <div className="rounded-md border bg-muted/40 px-2.5 py-2 space-y-1 text-muted-foreground">
                        <div className="font-medium text-foreground text-[11px] uppercase tracking-wide">
                          Warehouse product
                        </div>
                        {line.sku ? (
                          <div>
                            SKU:{" "}
                            <span className="text-foreground font-medium font-mono">{line.sku}</span>
                          </div>
                        ) : null}
                        {line.retailIdentifier ? (
                          <div>
                            Retail ID:{" "}
                            <span className="text-foreground font-medium font-mono">
                              {line.retailIdentifier}
                            </span>
                          </div>
                        ) : null}
                        {line.shopifyLineTitle || line.shopifyLineSku ? (
                          <div className="pt-1 border-t border-border/60">
                            <div className="font-medium text-foreground text-[11px] uppercase tracking-wide mb-0.5">
                              Shopify order line
                            </div>
                            {line.shopifyLineTitle ? <div>{line.shopifyLineTitle}</div> : null}
                            {line.shopifyLineSku ? (
                              <div>
                                SKU:{" "}
                                <span className="text-foreground font-medium font-mono">
                                  {line.shopifyLineSku}
                                </span>
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {canCorrect && line.productId ? (
                          <div className="pt-2 border-t border-border/60 space-y-2">
                            {!isEditing ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8"
                                disabled={submitting}
                                onClick={() => {
                                  setCorrectingLineIndex(index);
                                  setSelectedInventoryId("");
                                  setPickerSearch("");
                                }}
                              >
                                Correct warehouse product
                              </Button>
                            ) : (
                              <div className="space-y-2">
                                <Label className="text-foreground">Select correct product</Label>
                                <Popover
                                  open={pickerOpen}
                                  modal={false}
                                  onOpenChange={setPickerOpen}
                                >
                                  <PopoverTrigger asChild>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      role="combobox"
                                      className="w-full justify-between font-normal"
                                      disabled={submitting}
                                    >
                                      <span className="flex min-w-0 flex-1 items-center gap-2 truncate text-left">
                                        <span className="truncate">
                                          {selected
                                            ? `${selected.productName}${
                                                selected.sku ? ` (${selected.sku})` : ""
                                              }`
                                            : "Select warehouse product…"}
                                        </span>
                                        {selected?.source === "shopify" ? (
                                          <Badge
                                            variant="secondary"
                                            className="shrink-0 border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0 text-[10px] font-medium text-emerald-800 dark:text-emerald-200"
                                          >
                                            Shopify
                                          </Badge>
                                        ) : null}
                                      </span>
                                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent
                                    className="z-[200] w-[min(100vw-2rem,28rem)] overflow-hidden p-0"
                                    align="start"
                                    sideOffset={4}
                                    onOpenAutoFocus={(e) => e.preventDefault()}
                                    onWheel={(e) => e.stopPropagation()}
                                  >
                                    <div className="flex items-center gap-2 border-b px-3 py-2">
                                      <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                                      <Input
                                        value={pickerSearch}
                                        onChange={(e) => setPickerSearch(e.target.value)}
                                        placeholder="Search warehouse products…"
                                        className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                                      />
                                    </div>
                                    <div
                                      className="max-h-[240px] overflow-y-scroll overscroll-contain p-1 touch-pan-y"
                                      onWheel={(e) => e.stopPropagation()}
                                    >
                                      {filteredInventory.length === 0 ? (
                                        <p className="py-6 text-center text-sm text-muted-foreground">
                                          No inventory found
                                        </p>
                                      ) : (
                                        filteredInventory.map((item) => {
                                          const isSelected = selectedInventoryId === item.id;
                                          const isShopifyLinked = item.source === "shopify";
                                          const isCurrent = item.id === line.productId;
                                          return (
                                            <button
                                              key={item.id}
                                              type="button"
                                              disabled={isCurrent}
                                              className={cn(
                                                "flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-50",
                                                isSelected && "bg-accent"
                                              )}
                                              onClick={() => {
                                                setSelectedInventoryId(item.id);
                                                setPickerOpen(false);
                                              }}
                                            >
                                              <Check
                                                className={cn(
                                                  "mt-0.5 h-4 w-4 shrink-0",
                                                  isSelected ? "opacity-100" : "opacity-0"
                                                )}
                                              />
                                              <div className="min-w-0 flex-1">
                                                <div className="flex items-start gap-2">
                                                  <span className="min-w-0 flex-1 truncate font-medium">
                                                    {item.productName}
                                                  </span>
                                                  {isShopifyLinked ? (
                                                    <Badge
                                                      variant="secondary"
                                                      className="shrink-0 border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0 text-[10px] font-medium text-emerald-800 dark:text-emerald-200"
                                                    >
                                                      Shopify
                                                    </Badge>
                                                  ) : null}
                                                  {isCurrent ? (
                                                    <Badge variant="outline" className="shrink-0 text-[10px]">
                                                      Current
                                                    </Badge>
                                                  ) : null}
                                                </div>
                                                <div className="truncate text-xs text-muted-foreground">
                                                  {[
                                                    item.sku ? `SKU: ${item.sku}` : null,
                                                    `${item.quantity} avail`,
                                                    isShopifyLinked
                                                      ? "Linked catalog"
                                                      : "Warehouse stock",
                                                  ]
                                                    .filter(Boolean)
                                                    .join(" · ")}
                                                </div>
                                              </div>
                                            </button>
                                          );
                                        })
                                      )}
                                    </div>
                                  </PopoverContent>
                                </Popover>
                                <p className="text-[11px] text-muted-foreground">
                                  Shopify order stays fulfilled. Only PrepCorex stock and this shipped
                                  entry are updated.
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    disabled={submitting || !selectedInventoryId}
                                    onClick={() => void submitCorrection()}
                                  >
                                    {submitting ? (
                                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : null}
                                    Apply correction
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    disabled={submitting}
                                    onClick={() => {
                                      setCorrectingLineIndex(null);
                                      setSelectedInventoryId("");
                                    }}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
                      <span>
                        Qty:{" "}
                        <span className="text-foreground font-medium">{line.boxesShipped}</span>
                      </span>
                      <span>
                        Pack of:{" "}
                        <span className="text-foreground font-medium">{line.packOf}</span>
                      </span>
                      <span>
                        Total units:{" "}
                        <span className="text-foreground font-medium">{line.shippedQty}</span>
                      </span>
                      <span>
                        Unit price:{" "}
                        <span className="text-foreground font-medium">{money(line.unitPrice)}</span>
                      </span>
                    </div>
                    <div className="text-right font-semibold tabular-nums">
                      Line total: {money(line.lineTotal)}
                    </div>
                  </div>
                );
              })}
            </div>

            {details.additionalServiceLines.length > 0 ? (
              <div className="rounded-md border p-3 text-xs space-y-1">
                <div className="font-medium text-sm mb-1">Additional services</div>
                {details.additionalServiceLines.map((line) => (
                  <div key={line} className="text-muted-foreground">
                    {line}
                  </div>
                ))}
                <div className="text-right font-medium tabular-nums pt-1">
                  {money(details.additionalServicesTotal)}
                </div>
              </div>
            ) : null}

            {details.remarks?.trim() ? (
              <div className="rounded-md border bg-muted/20 p-3 text-xs">
                <div className="font-medium text-sm mb-1">Remarks</div>
                <p className="whitespace-pre-wrap text-muted-foreground">{details.remarks}</p>
              </div>
            ) : null}

            <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-3 space-y-1.5 text-sm">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Products subtotal</span>
                <span className="tabular-nums">{money(details.productsTotal)}</span>
              </div>
              {details.additionalServicesTotal > 0 ? (
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Additional services</span>
                  <span className="tabular-nums">{money(details.additionalServicesTotal)}</span>
                </div>
              ) : null}
              <div className="flex justify-between font-semibold pt-1 border-t">
                <span>Shipment total</span>
                <span className="tabular-nums text-base">{money(details.shipmentTotal)}</span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                Qty {details.totalBoxes} · Total units {details.totalUnits}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
