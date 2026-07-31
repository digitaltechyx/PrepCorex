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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Package, Truck } from "lucide-react";

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
}: Props) {
  const { toast } = useToast();
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingCompany, setTrackingCompany] = useState("");
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [productSearch, setProductSearch] = useState("");

  useEffect(() => {
    if (!open || !order) return;

    setTrackingNumber(order.trackingNumbers[0] || "");
    setTrackingCompany(order.trackingCompanies[0] || "");
    setNotifyCustomer(true);
    setProductSearch("");

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

        const drafts: LineDraft[] = order.lineItems.map((li) => {
          const suggested = suggestInventoryId(li.sku, items);
          return {
            shopifyLineItemId: li.id,
            title: li.variantTitle ? `${li.title} · ${li.variantTitle}` : li.title,
            sku: li.sku,
            orderQty: li.quantity,
            inventoryId: suggested,
            quantity: li.quantity,
          };
        });
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
  }, [open, order, toast]);

  const selectableInventory = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    return inventory
      .filter((item) => item.status !== "Out of Stock" || item.quantity > 0)
      .filter((item) => {
        if (!q) return true;
        return (
          item.productName.toLowerCase().includes(q) ||
          String(item.sku || "")
            .toLowerCase()
            .includes(q)
        );
      })
      .sort((a, b) => a.productName.localeCompare(b.productName));
  }, [inventory, productSearch]);

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
              <>
                <div className="space-y-2">
                  <Label htmlFor="qf-product-search">Search warehouse products</Label>
                  <Input
                    id="qf-product-search"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Filter by name or SKU…"
                  />
                </div>

                <div className="space-y-3">
                  {lines.map((line, index) => {
                    const selected = inventory.find((item) => item.id === line.inventoryId);
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
                            <Select
                              value={line.inventoryId || undefined}
                              onValueChange={(value) => updateLine(index, { inventoryId: value })}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select product" />
                              </SelectTrigger>
                              <SelectContent>
                                {selectableInventory.length === 0 ? (
                                  <SelectItem value="__none" disabled>
                                    No inventory found
                                  </SelectItem>
                                ) : (
                                  selectableInventory.map((item) => (
                                    <SelectItem key={item.id} value={item.id}>
                                      {item.productName}
                                      {item.sku ? ` (${item.sku})` : ""} · {item.quantity} avail
                                    </SelectItem>
                                  ))
                                )}
                              </SelectContent>
                            </Select>
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
              </>
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
