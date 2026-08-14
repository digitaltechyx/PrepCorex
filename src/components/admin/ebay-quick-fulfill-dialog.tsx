"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
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
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Loader2, Package, Truck, ChevronsUpDown, Check, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { pushEbayInventoryHints } from "@/lib/ebay-inventory-sync";

type EbayOrderLine = {
  lineItemId?: string;
  sku?: string;
  title?: string;
  quantity?: number;
};

export type EbayQuickFulfillOrder = {
  id: string;
  orderId?: string;
  connectionId?: string;
  lineItems?: EbayOrderLine[];
  buyer?: { email?: string; fullName?: string } | null;
};

type LineDraft = {
  ebayLineItemId: string;
  title: string;
  sku: string | null;
  orderQty: number;
  inventoryId: string;
  quantity: number;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: EbayQuickFulfillOrder | null;
  ownerUserId: string;
  getAuthToken: () => Promise<string>;
  onCompleted: () => void;
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

export function EbayQuickFulfillDialog({
  open,
  onOpenChange,
  order,
  ownerUserId,
  getAuthToken,
  onCompleted,
  labelHandoff = null,
}: Props) {
  const { toast } = useToast();
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [trackingNumber, setTrackingNumber] = useState("");
  const [carrierCode, setCarrierCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [productPickerLineIndex, setProductPickerLineIndex] = useState<number | null>(null);
  const [productPickerSearch, setProductPickerSearch] = useState("");
  const [labelPrice, setLabelPrice] = useState("");

  useEffect(() => {
    if (!open || !ownerUserId) return;
    let cancelled = false;
    (async () => {
      setLoadingInventory(true);
      try {
        const snap = await getDocs(collection(db, "users", ownerUserId, "inventory"));
        if (cancelled) return;
        const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<InventoryItem, "id">) }));
        setInventory(items);
      } catch {
        if (!cancelled) setInventory([]);
      } finally {
        if (!cancelled) setLoadingInventory(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, ownerUserId]);

  useEffect(() => {
    if (!open || !order) return;
    const orderLines = Array.isArray(order.lineItems) ? order.lineItems : [];
    setLines(
      orderLines
        .filter((li) => li.lineItemId)
        .map((li) => {
          const sku = li.sku != null ? String(li.sku) : null;
          const qty = Math.max(1, Math.floor(Number(li.quantity) || 1));
          return {
            ebayLineItemId: String(li.lineItemId),
            title: String(li.title || "Item"),
            sku,
            orderQty: qty,
            inventoryId: suggestInventoryId(sku, inventory),
            quantity: qty,
          };
        })
    );
    setTrackingNumber(labelHandoff?.trackingNumber?.trim() || "");
    setCarrierCode(labelHandoff?.trackingCompany?.trim() || "");
    setLabelPrice(
      labelHandoff?.labelPrice != null && Number.isFinite(Number(labelHandoff.labelPrice))
        ? String(labelHandoff.labelPrice)
        : ""
    );
    if (labelHandoff?.inventoryProductId) {
      setLines((prev) =>
        prev.map((line, idx) =>
          idx === 0
            ? { ...line, inventoryId: String(labelHandoff.inventoryProductId) }
            : line
        )
      );
    }
  }, [open, order, inventory, labelHandoff]);

  const filteredInventory = useMemo(() => {
    const q = productPickerSearch.trim().toLowerCase();
    const list = [...inventory].sort((a, b) => {
      const aEbay = a.source === "ebay" ? 0 : 1;
      const bEbay = b.source === "ebay" ? 0 : 1;
      if (aEbay !== bEbay) return aEbay - bEbay;
      return String(a.productName || "").localeCompare(String(b.productName || ""));
    });
    if (!q) return list;
    return list.filter((item) => {
      const hay = `${item.productName || ""} ${item.sku || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [inventory, productPickerSearch]);

  const canSubmit =
    lines.length > 0 &&
    lines.every((l) => l.inventoryId && l.quantity > 0) &&
    Boolean(order?.orderId || order?.id) &&
    Boolean(order?.connectionId);

  async function handleSubmit() {
    if (!order || !canSubmit) return;
    const orderId = String(order.orderId || order.id).trim();
    const connectionId = String(order.connectionId || "").trim();
    setSubmitting(true);
    try {
      const token = await getAuthToken();
      const res = await fetch("/api/integrations/ebay/quick-fulfill", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId: ownerUserId,
          connectionId,
          orderId,
          trackingNumber: trackingNumber.trim() || undefined,
          shippingCarrierCode: carrierCode.trim() || undefined,
          labelPrice: labelPrice.trim() ? Number(labelPrice) : null,
          labelPurchaseId: labelHandoff?.labelPurchaseId || null,
          lines: lines.map((l) => ({
            ebayLineItemId: l.ebayLineItemId,
            inventoryId: l.inventoryId,
            quantity: l.quantity,
            lineTitle: l.title,
            lineSku: l.sku,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Quick fulfill failed");
      }

      if (Array.isArray(data.ebaySyncHints) && data.ebaySyncHints.length > 0) {
        const sync = await pushEbayInventoryHints(token, data.ebaySyncHints);
        if (sync.errors.length > 0) {
          toast({
            variant: "destructive",
            title: "Fulfilled; eBay inventory did not update",
            description: sync.errors[0],
          });
        }
      }

      toast({
        title: data.alreadyProcessed
          ? "Already quick-fulfilled"
          : "Quick fulfill complete",
        description: data.alreadyProcessed
          ? "This eBay order was already quick-fulfilled."
          : `Shipped entry created${data.warehouseShortfall ? ` (warehouse shortfall ${data.warehouseShortfall})` : ""}.`,
      });
      onCompleted();
      onOpenChange(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Quick fulfill failed",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            Quick Fulfill &amp; Dispatch
          </DialogTitle>
          <DialogDescription>
            Deduct warehouse stock, create a shipped entry, and mark the eBay order shipped
            {order ? ` · #${order.orderId || order.id}` : ""}.
          </DialogDescription>
        </DialogHeader>

        {loadingInventory ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading inventory…
          </div>
        ) : (
          <div className="space-y-4">
            {lines.map((line, idx) => {
              const selected = inventory.find((i) => i.id === line.inventoryId);
              return (
                <div key={line.ebayLineItemId} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-sm">{line.title}</p>
                      <p className="text-xs text-muted-foreground">
                        Qty {line.orderQty}
                        {line.sku ? ` · SKU ${line.sku}` : ""}
                      </p>
                    </div>
                    {selected?.source === "ebay" ? (
                      <Badge variant="secondary">eBay</Badge>
                    ) : null}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label>Warehouse product</Label>
                      <Popover
                        open={productPickerLineIndex === idx}
                        onOpenChange={(o) => {
                          setProductPickerLineIndex(o ? idx : null);
                          if (!o) setProductPickerSearch("");
                        }}
                      >
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full justify-between font-normal">
                            <span className="truncate">
                              {selected
                                ? `${selected.productName}${selected.sku ? ` (${selected.sku})` : ""}`
                                : "Select product"}
                            </span>
                            <ChevronsUpDown className="h-4 w-4 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2" align="start">
                          <div className="flex items-center gap-2 px-2 pb-2">
                            <Search className="h-4 w-4 text-muted-foreground" />
                            <Input
                              value={productPickerSearch}
                              onChange={(e) => setProductPickerSearch(e.target.value)}
                              placeholder="Search products…"
                              className="h-8"
                            />
                          </div>
                          <div className="max-h-56 overflow-y-auto space-y-0.5">
                            {filteredInventory.map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                className={cn(
                                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                                  item.id === line.inventoryId && "bg-muted"
                                )}
                                onClick={() => {
                                  setLines((prev) =>
                                    prev.map((l, i) =>
                                      i === idx ? { ...l, inventoryId: item.id } : l
                                    )
                                  );
                                  setProductPickerLineIndex(null);
                                }}
                              >
                                <Check
                                  className={cn(
                                    "h-3.5 w-3.5",
                                    item.id === line.inventoryId ? "opacity-100" : "opacity-0"
                                  )}
                                />
                                <span className="truncate flex-1">
                                  {item.productName}
                                  {item.sku ? ` · ${item.sku}` : ""}
                                </span>
                                <span className="text-xs text-muted-foreground">{item.quantity}</span>
                              </button>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="space-y-1">
                      <Label>Ship qty</Label>
                      <Input
                        type="number"
                        min={1}
                        max={line.orderQty}
                        value={line.quantity}
                        onChange={(e) => {
                          const qty = Math.max(1, Math.floor(Number(e.target.value) || 1));
                          setLines((prev) =>
                            prev.map((l, i) => (i === idx ? { ...l, quantity: qty } : l))
                          );
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Tracking number</Label>
                <Input
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-1">
                <Label>Carrier code</Label>
                <Input
                  value={carrierCode}
                  onChange={(e) => setCarrierCode(e.target.value)}
                  placeholder="USPS, UPS, FEDEX…"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Label price (USD)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={labelPrice}
                onChange={(e) => setLabelPrice(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={!canSubmit || submitting}>
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Package className="h-4 w-4 mr-2" />
            )}
            Quick fulfill
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
