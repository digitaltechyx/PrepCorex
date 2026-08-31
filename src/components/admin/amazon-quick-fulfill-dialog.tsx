"use client";

import { useEffect, useMemo, useState } from "react";
import type { AdminAmazonOrder } from "@/lib/amazon-admin-orders";
import type { InventoryItem } from "@/types";
import { collection, getDocs } from "firebase/firestore";
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
import { Loader2, Truck } from "lucide-react";
import { amazonAddressSummary } from "@/lib/amazon-order-normalize";

type LineDraft = {
  orderItemId: string;
  title: string;
  sku: string | null;
  orderQty: number;
  inventoryId: string;
  quantity: number;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: AdminAmazonOrder | null;
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

export function AmazonQuickFulfillDialog({
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
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !order) return;
    setLines(
      order.lineItems.map((li) => ({
        orderItemId: li.orderItemId,
        title: li.title,
        sku: li.sellerSku,
        orderQty: Math.max(1, li.quantityOrdered - li.quantityShipped),
        inventoryId: "",
        quantity: Math.max(1, li.quantityOrdered - li.quantityShipped),
      }))
    );
    setTrackingNumber(order.trackingNumbers[0] || "");
    setTrackingCompany(order.trackingCarriers[0] || "");
  }, [open, order]);

  useEffect(() => {
    if (!open || !order?.ownerUserId) return;
    let cancelled = false;
    setLoadingInventory(true);
    void (async () => {
      try {
        const snap = await getDocs(
          collection(db, "users", order.ownerUserId, "inventory")
        );
        if (cancelled) return;
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as InventoryItem);
        setInventory(items.filter((i) => (i.quantity ?? 0) > 0));
        setLines((prev) =>
          prev.map((line) => ({
            ...line,
            inventoryId: line.inventoryId || suggestInventoryId(line.sku, items),
          }))
        );
      } catch {
        if (!cancelled) setInventory([]);
      } finally {
        if (!cancelled) setLoadingInventory(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, order?.ownerUserId]);

  const addressRestricted = order?.shippingAddress?.addressRestricted === true;
  const shipToPreview = useMemo(
    () => amazonAddressSummary(order?.shippingAddress ?? null),
    [order?.shippingAddress]
  );

  const handleSubmit = async () => {
    if (!order) return;
    if (!order.marketplaceId) {
      toast({
        variant: "destructive",
        title: "Missing marketplace",
        description: "Reconnect Amazon and sync orders again.",
      });
      return;
    }
    const validLines = lines.filter((l) => l.inventoryId && l.quantity > 0);
    if (validLines.length === 0) {
      toast({
        variant: "destructive",
        title: "Select products",
        description: "Map at least one order line to warehouse inventory.",
      });
      return;
    }
    if (!trackingNumber.trim()) {
      toast({
        variant: "destructive",
        title: "Tracking required",
        description: "Amazon FBM requires a tracking number to confirm shipment.",
      });
      return;
    }

    setSubmitting(true);
    try {
      const token = await getAuthToken();
      const res = await fetch("/api/amazon/quick-fulfill", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId: order.ownerUserId,
          connectionId: order.connectionId,
          amazonOrderId: order.amazonOrderId,
          marketplaceId: order.marketplaceId,
          storeName: order.storeName,
          shipTo: shipToPreview || undefined,
          tracking_number: trackingNumber.trim(),
          tracking_company: trackingCompany.trim() || undefined,
          lines: validLines.map((line) => ({
            orderItemId: line.orderItemId,
            inventoryId: line.inventoryId,
            quantity: line.quantity,
            lineTitle: line.title,
            lineSku: line.sku,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data.error as string) || "Quick fulfill failed");
      }
      toast({
        title: data.alreadyProcessed ? "Already fulfilled" : "Amazon order fulfilled",
        description: data.alreadyProcessed
          ? "This order was already quick-fulfilled."
          : `Shipped entry created · tracking sent to Amazon.`,
      });
      onOpenChange(false);
      onCompleted();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Fulfill failed",
        description: e instanceof Error ? e.message : "Could not fulfill Amazon order.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (!order) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            Quick Fulfill — {order.amazonOrderId}
          </DialogTitle>
          <DialogDescription>
            Deduct warehouse stock and confirm shipment on Amazon with tracking.
          </DialogDescription>
        </DialogHeader>

        {addressRestricted ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Ship-to address is partial until <strong>Direct to Consumer Shipping</strong> role is
            approved. You can still confirm shipment if you shipped using an address from Seller
            Central.
          </div>
        ) : null}

        {shipToPreview ? (
          <p className="text-xs text-muted-foreground break-words">
            Ship to: {shipToPreview}
          </p>
        ) : null}

        <div className="space-y-3">
          <p className="text-sm font-medium">Order lines → warehouse inventory</p>
          {loadingInventory ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading client inventory…
            </div>
          ) : (
            lines.map((line, idx) => (
              <div key={line.orderItemId} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{line.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {line.sku ? `SKU ${line.sku}` : "No SKU"} · Qty {line.orderQty}
                    </p>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    FBM
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">Warehouse product</Label>
                    <select
                      className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                      value={line.inventoryId}
                      onChange={(e) => {
                        const inventoryId = e.target.value;
                        setLines((prev) =>
                          prev.map((l, i) => (i === idx ? { ...l, inventoryId } : l))
                        );
                      }}
                    >
                      <option value="">Select…</option>
                      {inventory.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.productName} ({item.quantity} avail)
                          {item.sku ? ` · ${item.sku}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs">Ship qty</Label>
                    <Input
                      type="number"
                      min={1}
                      max={line.orderQty}
                      value={line.quantity}
                      onChange={(e) => {
                        const quantity = Math.max(1, Math.floor(Number(e.target.value) || 0));
                        setLines((prev) =>
                          prev.map((l, i) => (i === idx ? { ...l, quantity } : l))
                        );
                      }}
                    />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Carrier</Label>
            <Input
              value={trackingCompany}
              onChange={(e) => setTrackingCompany(e.target.value)}
              placeholder="USPS, UPS, FedEx…"
            />
          </div>
          <div>
            <Label>Tracking number</Label>
            <Input
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              placeholder="Required for Amazon"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={submitting || loadingInventory}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Fulfill &amp; confirm on Amazon
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
