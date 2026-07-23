"use client";

import { Badge } from "@/components/ui/badge";
import type { TikTokNormalizedOrder } from "@/lib/tiktok-order-normalize";

function formatOrderDate(createTime: number | null) {
  if (!createTime) return "—";
  try {
    return new Date(Number(createTime) * 1000).toLocaleString();
  } catch {
    return "—";
  }
}

function formatMoney(amount: string | null, currency: string | null) {
  if (!amount) return null;
  return currency ? `${currency} ${amount}` : amount;
}

export function TikTokOrderDetailBody({
  order,
  compact,
}: {
  order: TikTokNormalizedOrder;
  /** Hide header block when parent already shows id/status */
  compact?: boolean;
}) {
  const recipientLabel =
    order.recipient?.fullAddress ||
    [
      order.recipient?.name,
      order.recipient?.addressLine,
      order.recipient?.city,
      order.recipient?.state,
      order.recipient?.zipcode,
      order.recipient?.country,
    ]
      .filter(Boolean)
      .join(", ") ||
    null;

  const total = formatMoney(order.payment?.totalAmount ?? null, order.payment?.currency ?? null);

  return (
    <div className="space-y-3 text-sm">
      {!compact ? (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-mono text-sm font-semibold">{order.id}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Placed {formatOrderDate(order.createTime)}
              {order.shopName ? ` · ${order.shopName}` : ""}
            </p>
          </div>
          <Badge variant="outline" className="w-fit shrink-0">
            {String(order.status ?? "—")}
          </Badge>
        </div>
      ) : null}

      <div className="grid gap-1 text-muted-foreground">
        {order.buyerEmail ? <p>Buyer email: {order.buyerEmail}</p> : null}
        {order.recipient?.name ? <p>Recipient: {order.recipient.name}</p> : null}
        {order.recipient?.phone ? <p>Phone: {order.recipient.phone}</p> : null}
        {recipientLabel ? (
          <p className="break-words" title={recipientLabel}>
            Ship to: {recipientLabel}
          </p>
        ) : null}
        {order.deliveryOptionName ? <p>Delivery: {order.deliveryOptionName}</p> : null}
        {order.shippingProvider ? <p>Carrier: {order.shippingProvider}</p> : null}
        {order.trackingNumbers.length > 0 ? (
          <p>Tracking: {order.trackingNumbers.join(", ")}</p>
        ) : null}
        {total ? <p className="font-medium text-foreground">Total: {total}</p> : null}
        {order.buyerMessage ? (
          <p className="italic text-xs">Note: {order.buyerMessage}</p>
        ) : null}
      </div>

      {order.lineItems.length > 0 ? (
        <ul className="space-y-2 border-t pt-2">
          {order.lineItems.map((li) => (
            <li key={li.id} className="flex gap-3">
              {li.skuImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={li.skuImage}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded-md border object-cover bg-muted"
                />
              ) : (
                <div className="h-12 w-12 shrink-0 rounded-md border bg-muted" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground leading-snug">{li.productName}</p>
                <p className="text-xs text-muted-foreground">
                  {[li.skuName, li.sellerSku ? `SKU ${li.sellerSku}` : null]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                  {` · Qty ${li.quantity}`}
                  {li.salePrice
                    ? ` · ${formatMoney(li.salePrice, li.currency || order.payment?.currency || null)}`
                    : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground border-t pt-2">No line items returned for this order.</p>
      )}
    </div>
  );
}
