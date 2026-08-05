"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import type { AdminShopifyOrder } from "@/lib/shopify-admin-orders";
import type { InventoryItem } from "@/types";
import { db } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Loader2, Package, Truck, ChevronsUpDown, Check, Search } from "lucide-react";
import { cn } from "@/lib/utils";

type LineDraft = {
  shopifyLineItemId: string;
  title: string;
  sku: string | null;
  orderQty: number;
  inventoryId: string;
  quantity: number;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: AdminShopifyOrder | null;
  getAuthToken: () => Promise<string>;
  onCompleted: () => void;
  /** Prefill from PrepCorex Buy Labels → Quick Fulfill handoff. */
  labelHandoff?: {
    inventoryProductId?: string | null;
    trackingNumber?: string | null;
    trackingCompany?: string | null;
    labelPrice?: number | null;
    labelPurchaseId?: string | null;
  } | null;
};

function suggestInventoryId(lineSku: string | null, inventory: InventoryItem[]): string {
  const sku = (lineSku || "").trim().toLowerCase();
  if (!sku) return "";
  const exact = inventory.find(
    (item) => String(item.sku || "").trim().toLowerCase() === sku && item.quantity > 0
  );
  if (exact) return exact.id;
  const any = inventory.find((item) => String(item.sku || "").trim().toLowerCase() === sku);
  return any?.id || "";
}

export function ShopifyQuickFulfillDialog({
  open,
  onOpenChange,
  order,
  getAuthToken,
  onCompleted,
  labelHandoff = null,
}: Props) {
  const { toast } = useToast();
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingCompany, setTrackingCompany] = useState("");
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [productPickerLineIndex, setProductPickerLineIndex] = useState<number | null>(null);
  const [productPickerSearch, setProductPickerSearch] = useState("");
  const [labelPrice, setLabelPrice] = useState("");

  useEffect(() => {
    if (!open || !order) return;

    setTrackingNumber(
      (labelHandoff?.trackingNumber || "").trim() || order.trackingNumbers[0] || ""
    );
    setTrackingCompany(
      (labelHandoff?.trackingCompany || "").trim() || order.trackingCompanies[0] || ""
    );
    setNotifyCustomer(true);
    setProductPickerLineIndex(null);
    setProductPickerSearch("");
    setLabelPrice(
      labelHandoff?.labelPrice != null && Number.isFinite(Number(labelHandoff.labelPrice))
        ? String(Number(labelHandoff.labelPrice).toFixed(2))
        : ""
    );

    let cancelled = false;
    const load = async () => {
      setLoadingInventory(true);
      try {
        const snap = await getDocs(collection(db, `users/${order.ownerUserId}/inventory`));
        if (cancelled) return;
        const items = snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<InventoryItem, "id">),
        }));
        setInventory(items);

        const handoffProductId = (labelHandoff?.inventoryProductId || "").trim();
        const drafts: LineDraft[] = order.lineItems.map((li, index) => {
          const suggested = suggestInventoryId(li.sku, items);
          const useHandoff =
            Boolean(handoffProductId) &&
            items.some((item) => item.id === handoffProductId) &&
            index === 0;
          return {
            shopifyLineItemId: li.id,
            title: li.variantTitle ? `${li.title} · ${li.variantTitle}` : li.title,
            sku: li.sku,
            orderQty: li.quantity,
            inventoryId: useHandoff ? handoffProductId : suggested,
            quantity: li.quantity,
          };
        });
        if (drafts.length === 0 && handoffProductId && items.some((i) => i.id === handoffProductId)) {
          const product = items.find((i) => i.id === handoffProductId)!;
          drafts.push({
            shopifyLineItemId: "manual",
            title: product.productName || "Warehouse product",
            sku: product.sku || null,
            orderQty: 1,
            inventoryId: handoffProductId,
            quantity: 1,
          });
        }
        setLines(drafts);
      } catch (error) {
        if (!cancelled) {
          toast({
            variant: "destructive",
            title: "Could not load warehouse inventory",
            description: error instanceof Error ? error.message : "Try again.",
          });
          setInventory([]);
          setLines([]);
        }
      } finally {
        if (!cancelled) setLoadingInventory(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [open, order, toast, labelHandoff]);

  const selectableInventory = useMemo(() => {
    return inventory
      .filter((item) => item.status !== "Out of Stock" || item.quantity > 0)
      .sort((a, b) => a.productName.localeCompare(b.productName));
  }, [inventory]);

  const filteredPickerInventory = useMemo(() => {
    const q = productPickerSearch.trim().toLowerCase();
    if (!q) return selectableInventory;
    return selectableInventory.filter(
      (item) =>
        item.productName.toLowerCase().includes(q) ||
        String(item.sku || "")
          .toLowerCase()
          .includes(q)
    );
  }, [selectableInventory, productPickerSearch]);

  const updateLine = (index: number, patch: Partial<LineDraft>) => {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const submit = async () => {
    if (!order) return;

    for (const line of lines) {
      if (!line.inventoryId) {
        toast({
          variant: "destructive",
          title: "Select warehouse products",
          description: `Choose a warehouse product for "${line.title}".`,
        });
        return;
      }
      if (line.quantity <= 0) {
        toast({
          variant: "destructive",
          title: "Invalid quantity",
          description: `Enter a quantity greater than 0 for "${line.title}".`,
        });
        return;
      }
      if (line.quantity > line.orderQty) {
        toast({
          variant: "destructive",
          title: "Quantity too high",
          description: `"${line.title}" cannot exceed the Shopify order quantity (${line.orderQty}).`,
        });
        return;
      }
      const inv = inventory.find((item) => item.id === line.inventoryId);
      if (!inv) {
        toast({
          variant: "destructive",
          title: "Product missing",
          description: `Warehouse product for "${line.title}" was not found.`,
        });
        return;
      }
    }

    // Aggregate per inventory for stock check against duplicates
    const needed = new Map<string, number>();
    for (const line of lines) {
      needed.set(line.inventoryId, (needed.get(line.inventoryId) || 0) + line.quantity);
    }
    for (const [inventoryId, qty] of needed) {
      const inv = inventory.find((item) => item.id === inventoryId);
      if (!inv || inv.quantity < qty) {
        toast({
          variant: "destructive",
          title: "Insufficient warehouse stock",
          description: `${inv?.productName || inventoryId} has ${inv?.quantity ?? 0} available, but ${qty} requested.`,
        });
        return;
      }
    }

    setSubmitting(true);
    try {
      const token = await getAuthToken();
      const res = await fetch("/api/shopify/quick-fulfill", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId: order.ownerUserId,
          shop: order.shop,
          orderId: order.id,
          orderName: order.name,
          orderNumber: order.orderNumber,
          shipTo: [
            order.shippingAddress?.name,
            order.shippingAddress?.company,
            order.shippingAddress?.address1,
            order.shippingAddress?.address2,
            [order.shippingAddress?.city, order.shippingAddress?.province, order.shippingAddress?.zip]
              .filter(Boolean)
              .join(", "),
            order.shippingAddress?.country,
          ]
            .filter(Boolean)
            .join(", ") || undefined,
          lines: lines.map((line) => ({
            shopifyLineItemId: line.shopifyLineItemId,
            inventoryId: line.inventoryId,
            quantity: line.quantity,
          })),
          tracking_number: trackingNumber || undefined,
          tracking_company: trackingCompany || undefined,
          notify_customer: notifyCustomer,
          label_price: (() => {
            const n = Number.parseFloat(labelPrice);
            return Number.isFinite(n) && n > 0 ? n : undefined;
          })(),
          label_purchase_id: labelHandoff?.labelPurchaseId || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Quick fulfill failed");
      }

      toast({
        title: data.alreadyProcessed ? "Already fulfilled" : "Order fulfilled & dispatched",
        description: data.alreadyProcessed
          ? "This Shopify order was already quick-fulfilled."
          : "Warehouse stock deducted, Shopify marked fulfilled, and a shipped order was created.",
      });
      if (Array.isArray(data.syncErrors) && data.syncErrors.length) {
        toast({
          variant: "destructive",
          title: "PrepCorex updated; Shopify inventory sync had issues",
          description: data.syncErrors.slice(0, 2).join("; "),
        });
      }
      if (Number(data.warehouseShortfall) > 0) {
        toast({
          variant: "destructive",
          title: "Client inventory updated; some bin qty was not found",
          description: `Could not deduct ${data.warehouseShortfall} unit(s) from Warehouse Ops bins (SKU/bin mismatch). Check inventory search and adjust the carton qty.`,
        });
      }
      onOpenChange(false);
      onCompleted();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Quick fulfill failed",
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-emerald-600" />
            Quick Fulfill &amp; Dispatch
          </DialogTitle>
          <DialogDescription>
            Select warehouse products, enter quantities and tracking, then fulfill directly — no
            pick, pack, or dispatch workflow.
          </DialogDescription>
        </DialogHeader>

        {order ? (
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{order.name || `#${order.orderNumber}`}</span>
                <Badge variant="outline" className="text-[10px]">
                  {order.ownerName}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  {order.shopName || order.shop.replace(".myshopify.com", "")}
                </Badge>
              </div>
              <p className="mt-1 text-muted-foreground">
                {order.customerName || order.email || "Customer"}
              </p>
            </div>

            {loadingInventory ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading warehouse inventory…
              </div>
            ) : (
              <div className="space-y-3">
                  {lines.map((line, index) => {
                    const selected = inventory.find((item) => item.id === line.inventoryId);
                    const pickerOpen = productPickerLineIndex === index;
                    return (
                      <div key={line.shopifyLineItemId} className="rounded-lg border p-3 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">{line.title}</p>
                            <p className="text-xs text-muted-foreground">
                              Shopify qty: {line.orderQty}
                              {line.sku ? ` · SKU: ${line.sku}` : ""}
                            </p>
                          </div>
                          <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label>Warehouse product</Label>
                            <Popover
                              open={pickerOpen}
                              modal={false}
                              onOpenChange={(openNext) => {
                                setProductPickerLineIndex(openNext ? index : null);
                                if (!openNext) setProductPickerSearch("");
                              }}
                            >
                              <PopoverTrigger asChild>
                                <Button
                                  type="button"
                                  variant="outline"
                                  role="combobox"
                                  aria-expanded={pickerOpen}
                                  className="w-full justify-between font-normal"
                                >
                                  <span className="truncate">
                                    {selected
                                      ? `${selected.productName}${
                                          selected.sku ? ` (${selected.sku})` : ""
                                        }`
                                      : "Select product…"}
                                  </span>
                                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent
                                className="z-[200] w-[min(100vw-2rem,28rem)] p-0"
                                align="start"
                                sideOffset={4}
                                onOpenAutoFocus={(e) => e.preventDefault()}
                                onCloseAutoFocus={(e) => e.preventDefault()}
                              >
                                <div className="flex items-center gap-2 border-b px-3 py-2">
                                  <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                                  <Input
                                    value={productPickerSearch}
                                    onChange={(e) => setProductPickerSearch(e.target.value)}
                                    placeholder="Search warehouse products…"
                                    className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                                  />
                                </div>
                                <div className="max-h-[280px] overflow-y-auto overscroll-contain p-1">
                                  {filteredPickerInventory.length === 0 ? (
                                    <p className="py-6 text-center text-sm text-muted-foreground">
                                      No inventory found
                                    </p>
                                  ) : (
                                    filteredPickerInventory.map((item) => {
                                      const isSelected = line.inventoryId === item.id;
                                      return (
                                        <button
                                          key={item.id}
                                          type="button"
                                          className={cn(
                                            "flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                                            isSelected && "bg-accent"
                                          )}
                                          onClick={() => {
                                            updateLine(index, { inventoryId: item.id });
                                            setProductPickerLineIndex(null);
                                            setProductPickerSearch("");
                                          }}
                                        >
                                          <Check
                                            className={cn(
                                              "mt-0.5 h-4 w-4 shrink-0",
                                              isSelected ? "opacity-100" : "opacity-0"
                                            )}
                                          />
                                          <div className="min-w-0 flex-1">
                                            <div className="truncate font-medium">
                                              {item.productName}
                                            </div>
                                            <div className="truncate text-xs text-muted-foreground">
                                              {[
                                                item.sku ? `SKU: ${item.sku}` : null,
                                                `${item.quantity} avail`,
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
                            {selected ? (
                              <p className="text-[11px] text-muted-foreground">
                                Available: {selected.quantity}
                                {selected.source === "shopify" ? " · Shopify-linked" : ""}
                              </p>
                            ) : null}
                          </div>

                          <div className="space-y-1.5">
                            <Label>Ship quantity</Label>
                            <Input
                              type="number"
                              min={1}
                              max={line.orderQty}
                              value={line.quantity}
                              onChange={(e) =>
                                updateLine(index, {
                                  quantity: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                                })
                              }
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Tracking number</Label>
                <Input
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  placeholder="1Z999…"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Carrier</Label>
                <Input
                  value={trackingCompany}
                  onChange={(e) => setTrackingCompany(e.target.value)}
                  placeholder="USPS, FedEx, UPS…"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Label price (USD)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={labelPrice}
                onChange={(e) => setLabelPrice(e.target.value)}
                placeholder="0.00"
              />
              <p className="text-xs text-muted-foreground">
                Saved on the shipped order remarks and added to the client invoice. Prep is billed as
                DTC/FBM.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="qf-notify"
                checked={notifyCustomer}
                onCheckedChange={(v) => setNotifyCustomer(v === true)}
              />
              <Label htmlFor="qf-notify">Notify customer by email</Label>
            </div>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={submitting || loadingInventory || !order || lines.length === 0}
            onClick={() => void submit()}
          >
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Fulfill &amp; Dispatch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
