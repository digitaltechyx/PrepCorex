import {
  shopifyAddressSummary,
  type ShopifyNormalizedOrder,
} from "@/lib/shopify-order-normalize";
import {
  formatShopifyFulfillmentLabel,
  formatShopifyPaymentLabel,
  getShopifyOrderTeamHint,
  isShopifyOrderCancelled,
} from "@/lib/shopify-order-status";

export type ShopifyOrderCsvRow = ShopifyNormalizedOrder & {
  ownerName?: string | null;
  ownerEmail?: string | null;
  ownerClientId?: string | null;
};

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function inDateRange(
  createdAt: string | null | undefined,
  from: string,
  to: string
): boolean {
  if (!from && !to) return true;
  if (!createdAt) return false;
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return false;
  if (from) {
    const start = new Date(`${from}T00:00:00`);
    if (!Number.isNaN(start.getTime()) && d < start) return false;
  }
  if (to) {
    const end = new Date(`${to}T23:59:59.999`);
    if (!Number.isNaN(end.getTime()) && d > end) return false;
  }
  return true;
}

export function filterShopifyOrdersForCsv<T extends ShopifyOrderCsvRow>(
  orders: T[],
  options: { mode: "all" | "range"; from?: string; to?: string }
): T[] {
  if (options.mode === "all") return orders;
  return orders.filter((o) => inDateRange(o.createdAt, options.from || "", options.to || ""));
}

export function buildShopifyOrdersCsv(orders: ShopifyOrderCsvRow[]): string {
  const headers = [
    "Order",
    "Order ID",
    "Placed at",
    "Cancelled",
    "Cancelled at",
    "Cancel reason",
    "Payment status",
    "Fulfillment status",
    "Team hint",
    "Store",
    "Shop domain",
    "Client name",
    "Client email",
    "Client ID",
    "Customer",
    "Email",
    "Phone",
    "Ship to",
    "Currency",
    "Total",
    "Subtotal",
    "Tax",
    "Shipping",
    "Tags",
    "Note",
    "Line items",
    "SKUs",
    "Tracking",
  ];

  const lines = [headers.join(",")];
  for (const o of orders) {
    const lineSummary = o.lineItems
      .map((li) => `${li.quantity}x ${li.title}${li.sku ? ` (${li.sku})` : ""}`)
      .join(" | ");
    const skus = o.lineItems.map((li) => li.sku || "").filter(Boolean).join(" | ");
    const tracking = o.trackingNumbers
      .map((tn, i) => (o.trackingCompanies[i] ? `${o.trackingCompanies[i]} ${tn}` : tn))
      .join(" | ");

    lines.push(
      [
        o.name || `#${o.orderNumber}`,
        o.id,
        o.createdAt || "",
        isShopifyOrderCancelled(o) ? "yes" : "no",
        o.cancelledAt || "",
        o.cancelReason || "",
        formatShopifyPaymentLabel(o.financialStatus),
        formatShopifyFulfillmentLabel(o.fulfillmentStatus),
        getShopifyOrderTeamHint(o),
        o.shopName || "",
        o.shop || "",
        o.ownerName || "",
        o.ownerEmail || "",
        o.ownerClientId || "",
        o.customerName || "",
        o.email || "",
        o.shippingAddress?.phone || o.phone || o.customerPhone || "",
        shopifyAddressSummary(o.shippingAddress) || "",
        o.currency || "",
        o.totalPrice || "",
        o.subtotalPrice || "",
        o.totalTax || "",
        o.totalShipping || "",
        o.tags || "",
        o.note || "",
        lineSummary,
        skus,
        tracking,
      ]
        .map(csvEscape)
        .join(",")
    );
  }
  return lines.join("\n");
}

export function downloadShopifyOrdersCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
