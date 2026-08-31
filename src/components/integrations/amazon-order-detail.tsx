"use client";

import { Badge } from "@/components/ui/badge";
import {
  amazonAddressSummary,
  type AmazonNormalizedOrder,
} from "@/lib/amazon-order-normalize";
import { format } from "date-fns";

function formatOrderDate(raw: string | null) {
  if (!raw) return "—";
  try {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? raw : format(d, "PPp");
  } catch {
    return raw;
  }
}

function formatMoney(amount: string | null, currency: string | null) {
  if (!amount) return null;
  return currency ? `${currency} ${amount}` : amount;
}

export function AmazonOrderDetailBody({
  order,
  compact,
  actions,
}: {
  order: AmazonNormalizedOrder;
  compact?: boolean;
  actions?: React.ReactNode;
}) {
  const shipTo = amazonAddressSummary(order.shippingAddress);
  const total = formatMoney(order.orderTotal, order.currency);

  return (
    <div className="space-y-3 text-sm">
      {!compact ? (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold">{order.amazonOrderId}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Placed {formatOrderDate(order.createdAt)}
              {order.storeName ? ` · ${order.storeName}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 shrink-0">
            <Badge variant={order.isFba ? "secondary" : "outline"} className="text-[10px]">
              {order.isFba ? "FBA" : "FBM"}
            </Badge>
            <Badge variant="outline" className="capitalize text-[10px]">
              {order.orderStatus || "unknown"}
            </Badge>
            {order.isPrime ? (
              <Badge variant="outline" className="text-[10px]">
                Prime
              </Badge>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="grid gap-1 text-muted-foreground">
        {order.buyerEmail ? <p>Buyer email: {order.buyerEmail}</p> : null}
        {shipTo ? (
          <p className="break-words" title={shipTo}>
            Ship to: {shipTo}
          </p>
        ) : order.isFba ? (
          <p>Fulfilled by Amazon — no warehouse ship-to required.</p>
        ) : null}
        {order.shipServiceLevel ? <p>Ship service: {order.shipServiceLevel}</p> : null}
        {order.trackingNumbers.length > 0 ? (
          <p>
            Tracking:{" "}
            {order.trackingNumbers.map((tn, i) => {
              const company = order.trackingCarriers[i];
              return company ? `${company} ${tn}` : tn;
            }).join(", ")}
          </p>
        ) : null}
        {total ? <p className="font-medium text-foreground">Total: {total}</p> : null}
        {order.numberOfItemsUnshipped > 0 ? (
          <p className="text-xs">Unshipped items: {order.numberOfItemsUnshipped}</p>
        ) : null}
        {order.latestShipDate ? (
          <p className="text-xs">Ship by: {formatOrderDate(order.latestShipDate)}</p>
        ) : null}
      </div>

      {order.lineItems.length > 0 ? (
        <ul className="space-y-2 border-t pt-2">
          {order.lineItems.map((li) => (
            <li key={li.orderItemId} className="flex gap-3">
              <div className="h-12 w-12 shrink-0 rounded-md border bg-muted flex items-center justify-center text-[10px] text-muted-foreground">
                ×{li.quantityOrdered}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground leading-snug">{li.title}</p>
                <p className="text-xs text-muted-foreground">
                  {[
                    li.sellerSku ? `SKU ${li.sellerSku}` : null,
                    li.asin ? `ASIN ${li.asin}` : null,
                    li.itemPrice ? formatMoney(li.itemPrice, li.currency) : null,
                    li.quantityShipped > 0 ? `Shipped ${li.quantityShipped}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || `Qty ${li.quantityOrdered}`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground border-t pt-2">No line items synced yet.</p>
      )}

      {actions ? <div className="border-t pt-3">{actions}</div> : null}
    </div>
  );
}
