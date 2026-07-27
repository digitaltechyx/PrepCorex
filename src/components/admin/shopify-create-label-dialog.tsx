"use client";

import { useState } from "react";
import { Download, Loader2, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import type { ShopifyNormalizedOrder } from "@/lib/shopify-order-normalize";

type PurchasedLabel = {
  labelId: string;
  trackingNumber?: string;
  trackingCompany?: string;
  documentUrl?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: ShopifyNormalizedOrder | null;
  userId: string;
  getAuthToken: () => Promise<string>;
  onPurchased?: () => void;
};

export function ShopifyCreateLabelDialog({
  open,
  onOpenChange,
  order,
  userId,
  getAuthToken,
  onPurchased,
}: Props) {
  const { toast } = useToast();
  const [lengthIn, setLengthIn] = useState("12");
  const [widthIn, setWidthIn] = useState("9");
  const [heightIn, setHeightIn] = useState("6");
  const [totalWeightLb, setTotalWeightLb] = useState("1");
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [purchasedLabel, setPurchasedLabel] = useState<PurchasedLabel | null>(null);

  const resetForm = () => {
    setLengthIn("12");
    setWidthIn("9");
    setHeightIn("6");
    setTotalWeightLb("1");
    setNotifyCustomer(true);
    setPurchasedLabel(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) resetForm();
    onOpenChange(next);
  };

  const submitPurchase = async () => {
    if (!order) return;
    setPurchasing(true);
    setPurchasedLabel(null);
    try {
      const token = await getAuthToken();
      const res = await fetch("/api/shopify/label/purchase", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId,
          shop: order.shop,
          orderId: order.id,
          lengthIn: Number(lengthIn),
          widthIn: Number(widthIn),
          heightIn: Number(heightIn),
          totalWeightLb: Number(totalWeightLb),
          notifyCustomer,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "Label purchase failed",
          description: typeof data.error === "string" ? data.error : "Unknown error",
        });
        return;
      }
      const label = (data.label ?? null) as PurchasedLabel | null;
      setPurchasedLabel(label);
      toast({
        title: "Shipping label purchased",
        description: "The label was charged to the client's Shopify account.",
      });
      onPurchased?.();
    } finally {
      setPurchasing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-emerald-600" />
            Create Shopify label
          </DialogTitle>
          <DialogDescription>
            {order
              ? `Purchase a label for ${order.name || `#${order.orderNumber}`}. Shopify bills the client's store — not PrepCorex.`
              : "Purchase a shipping label through the connected Shopify store."}
          </DialogDescription>
        </DialogHeader>

        {purchasedLabel ? (
          <div className="space-y-4 py-2">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 space-y-2">
              <p className="font-medium">Label ready</p>
              {purchasedLabel.trackingNumber ? (
                <p>
                  Tracking: {purchasedLabel.trackingCompany ? `${purchasedLabel.trackingCompany} ` : ""}
                  {purchasedLabel.trackingNumber}
                </p>
              ) : null}
              {purchasedLabel.documentUrl ? (
                <Button asChild size="sm" className="mt-2">
                  <a href={purchasedLabel.documentUrl} target="_blank" rel="noopener noreferrer">
                    <Download className="h-4 w-4 mr-2" />
                    Download label PDF
                  </a>
                </Button>
              ) : (
                <p className="text-emerald-800">
                  Label purchased. Open the order in Shopify admin if the PDF link is not shown here.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="shopify-label-length">Length (in)</Label>
                <Input
                  id="shopify-label-length"
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={lengthIn}
                  onChange={(e) => setLengthIn(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shopify-label-width">Width (in)</Label>
                <Input
                  id="shopify-label-width"
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={widthIn}
                  onChange={(e) => setWidthIn(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shopify-label-height">Height (in)</Label>
                <Input
                  id="shopify-label-height"
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={heightIn}
                  onChange={(e) => setHeightIn(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="shopify-label-weight">Total weight (lb)</Label>
              <Input
                id="shopify-label-weight"
                type="number"
                min={0.1}
                step={0.1}
                value={totalWeightLb}
                onChange={(e) => setTotalWeightLb(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Package + contents. Shopify picks the best available Shopify Shipping rate.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="shopify-label-notify"
                checked={notifyCustomer}
                onCheckedChange={(v) => setNotifyCustomer(v === true)}
              />
              <Label htmlFor="shopify-label-notify">Notify customer by email</Label>
            </div>
            <p className="text-xs text-muted-foreground rounded-md border bg-muted/40 p-3">
              Requires Shopify Shipping on the client store, accepted shipping terms, and a valid payment
              method in Shopify. The store must reconnect Shopify if this is the first label purchase after
              this update.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={purchasing}>
            {purchasedLabel ? "Close" : "Cancel"}
          </Button>
          {!purchasedLabel ? (
            <Button onClick={submitPurchase} disabled={purchasing || !order}>
              {purchasing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Purchase label
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
