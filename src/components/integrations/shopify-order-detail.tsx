"use client";

import { Badge } from "@/components/ui/badge";
import {
  shopifyAddressSummary,
  type ShopifyNormalizedOrder,
} from "@/lib/shopify-order-normalize";
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

export function ShopifyOrderDetailBody({
  order,
  compact,
  actions,
}: {
  order: ShopifyNormalizedOrder;
  compact?: boolean;
  actions?: React.ReactNode;
}) {
  const shipTo = shopifyAddressSummary(order.shippingAddress);
  const total = formatMoney(order.totalPrice, order.currency);

  return (
    <div className="space-y-3 text-sm">
      {!compact ? (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold">{order.name || `#${order.orderNumber}`}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Placed {formatOrderDate(order.createdAt)}
              {order.shopName ? ` · ${order.shopName}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 shrink-0">
            {order.financialStatus ? (
              <Badge variant="outline" className="capitalize text-[10px]">
                {order.financialStatus}
              </Badge>
            ) : null}
            <Badge variant="secondary" className="capitalize text-[10px]">
              {order.fulfillmentStatus || "unfulfilled"}
            </Badge>
          </div>
        </div>
      ) : null}

      <div className="grid gap-1 text-muted-foreground">
        {order.email ? <p>Email: {order.email}</p> : null}
        {order.customerName ? <p>Customer: {order.customerName}</p> : null}
        {order.shippingAddress?.phone ? <p>Phone: {order.shippingAddress.phone}</p> : null}
        {shipTo ? (
          <p className="break-words" title={shipTo}>
            Ship to: {shipTo}
          </p>
        ) : null}
        {order.shippingLines.length > 0 ? (
          <p>
            Shipping method:{" "}
            {order.shippingLines.map((sl) => sl.title).filter(Boolean).join(", ")}
          </p>
        ) : null}
        {order.trackingNumbers.length > 0 ? (
          <p>
            Tracking:{" "}
            {order.trackingNumbers.map((tn, i) => {
              const company = order.trackingCompanies[i];
              return company ? `${company} ${tn}` : tn;
            }).join(", ")}
          </p>
        ) : null}
        {total ? <p className="font-medium text-foreground">Total: {total}</p> : null}
        {order.subtotalPrice ? (
          <p className="text-xs">
            Subtotal {formatMoney(order.subtotalPrice, order.currency)}
            {order.totalTax ? ` · Tax ${formatMoney(order.totalTax, order.currency)}` : ""}
            {order.totalShipping ? ` · Shipping ${formatMoney(order.totalShipping, order.currency)}` : ""}
          </p>
        ) : null}
        {order.note ? <p className="italic text-xs">Note: {order.note}</p> : null}
        {order.tags ? <p className="text-xs">Tags: {order.tags}</p> : null}
      </div>

      {order.lineItems.length > 0 ? (
        <ul className="space-y-2 border-t pt-2">
          {order.lineItems.map((li) => (
            <li key={li.id} className="flex gap-3">
              <div className="h-12 w-12 shrink-0 rounded-md border bg-muted flex items-center justify-center text-[10px] text-muted-foreground">
                ×{li.quantity}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground leading-snug">{li.title}</p>
                <p className="text-xs text-muted-foreground">
                  {[
                    li.variantTitle,
                    li.sku ? `SKU ${li.sku}` : null,
                    li.price ? formatMoney(li.price, order.currency) : null,
                    li.fulfillmentStatus ? `Fulfillment: ${li.fulfillmentStatus}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || `Qty ${li.quantity}`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground border-t pt-2">No line items returned for this order.</p>
      )}

      {actions ? <div className="border-t pt-3 flex flex-wrap gap-2 justify-end">{actions}</div> : null}
    </div>
  );
}
