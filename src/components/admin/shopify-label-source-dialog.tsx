"use client";

import { Building2, ShoppingBag, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AdminShopifyOrder } from "@/lib/shopify-admin-orders";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: AdminShopifyOrder | null;
  onChooseShopify: () => void;
  onChoosePrepCorex: () => void;
};

export function ShopifyLabelSourceDialog({
  open,
  onOpenChange,
  order,
  onChooseShopify,
  onChoosePrepCorex,
}: Props) {
  const orderLabel = order?.name || (order ? `#${order.orderNumber}` : "this order");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-emerald-600" />
            Create shipping label
          </DialogTitle>
          <DialogDescription>
            {order
              ? `Choose where to purchase the label for ${orderLabel} (${order.ownerName}).`
              : "Choose where to purchase the shipping label."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <button
            type="button"
            onClick={onChoosePrepCorex}
            className="flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors hover:border-cyan-500 hover:bg-cyan-50/50"
          >
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-100 text-cyan-700">
              <Building2 className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <p className="font-semibold">PrepCorex (our system)</p>
              <p className="text-sm text-muted-foreground">
                Open Buy Labels with the ship-to address pre-filled. Add package dimensions, pick a
                rate, and pay through PrepCorex.
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={onChooseShopify}
            className="flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors hover:border-emerald-500 hover:bg-emerald-50/50"
          >
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <ShoppingBag className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <p className="font-semibold">Shopify (client store)</p>
              <p className="text-sm text-muted-foreground">
                Purchase through Shopify Shipping. The label is billed to the client&apos;s Shopify
                account — not PrepCorex.
              </p>
            </div>
          </button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
