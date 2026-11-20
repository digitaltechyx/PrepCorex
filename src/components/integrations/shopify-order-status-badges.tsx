"use client";

import { Badge } from "@/components/ui/badge";
import type { ShopifyNormalizedOrder } from "@/lib/shopify-order-normalize";
import {
  formatShopifyFulfillmentLabel,
  formatShopifyPaymentLabel,
  getShopifyOrderTeamHint,
  isShopifyOrderCancelled,
} from "@/lib/shopify-order-status";
import { cn } from "@/lib/utils";

export function ShopifyOrderStatusBadges({
  order,
  showHint = true,
  className,
}: {
  order: Pick<
    ShopifyNormalizedOrder,
    "cancelledAt" | "cancelReason" | "financialStatus" | "fulfillmentStatus"
  >;
  showHint?: boolean;
  className?: string;
}) {
  const cancelled = isShopifyOrderCancelled(order);
  const pay = String(order.financialStatus || "").toLowerCase();
  const payTone =
    pay === "refunded" || pay === "voided"
      ? "border-red-300 bg-red-50 text-red-800"
      : pay === "partially_refunded"
        ? "border-amber-300 bg-amber-50 text-amber-900"
        : pay === "paid"
          ? "border-emerald-300 bg-emerald-50 text-emerald-800"
          : "";

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex flex-wrap gap-1.5">
        {cancelled ? (
          <Badge className="border-red-600 bg-red-600 text-[10px] text-white hover:bg-red-600">
            Cancelled
          </Badge>
        ) : null}
        <Badge variant="outline" className={cn("capitalize text-[10px]", payTone)}>
          {formatShopifyPaymentLabel(order.financialStatus)}
        </Badge>
        <Badge variant="secondary" className="capitalize text-[10px]">
          {formatShopifyFulfillmentLabel(order.fulfillmentStatus)}
        </Badge>
      </div>
      {showHint ? (
        <p
          className={cn(
            "text-[11px] leading-snug",
            cancelled || pay === "refunded" || pay === "voided"
              ? "font-medium text-red-700"
              : "text-muted-foreground"
          )}
        >
          {getShopifyOrderTeamHint(order)}
          {cancelled && order.cancelReason ? ` Reason: ${order.cancelReason}.` : ""}
        </p>
      ) : null}
    </div>
  );
}
