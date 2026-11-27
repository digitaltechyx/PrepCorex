/**
 * Shared PrepCorex order deep-link used on CRM invoices.
 * Works for clients and admins: `/orders/open` picks the right page after auth.
 */

export function getPrepcorexAppBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://prepcorex.com").replace(
    /\/$/,
    ""
  );
}

/** Public URL stored on CRM invoice lines (works for user + admin). */
export function buildPrepcorexOrderOpenUrl(
  clientUserId: string,
  orderNumber: string
): string {
  const client = String(clientUserId || "").trim();
  const order = String(orderNumber || "").trim();
  if (!client || !order) return "";
  const params = new URLSearchParams({
    order,
    client,
  });
  return `${getPrepcorexAppBaseUrl()}/orders/open?${params.toString()}`;
}

/** Client Shipped Orders with this order pre-searched (Shipped tab — invoice links). */
export function buildClientShippedOrdersPath(orderNumber: string): string {
  const order = String(orderNumber || "").trim();
  const params = new URLSearchParams({
    status: "shipped",
  });
  if (order) params.set("search", order);
  return `/dashboard/shipped-orders?${params.toString()}`;
}

/** Admin inventory → that client's Shipped Orders with search. */
export function buildAdminShippedOrdersPath(
  clientUserId: string,
  orderNumber: string
): string {
  const client = String(clientUserId || "").trim();
  const order = String(orderNumber || "").trim();
  const params = new URLSearchParams({
    section: "shipped-orders",
    status: "shipped",
  });
  if (client) params.set("userId", client);
  if (order) params.set("search", order);
  return `/admin/dashboard/inventory?${params.toString()}`;
}
