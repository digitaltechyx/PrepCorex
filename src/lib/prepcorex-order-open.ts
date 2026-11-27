/**
 * Shared PrepCorex order deep-link used on CRM invoices.
 * Works for clients and admins: `/orders/open` picks the right page after auth.
 *
 * Always prefer production PrepCorex for customer-facing invoice links — never
 * emit CRM, IMS, or StockFlow-dev hosts (those 404 on /orders/open).
 */

const PREPCOREX_PRODUCTION_BASE = "https://prepcorex.com";

const NON_PREPCOREX_HOST_MARKERS = [
  "dev.prepservicesfba.com",
  "dev.psfstockflow.com",
  "ims.prepservicesfba.com",
  "crm.prepservicesfba.com",
  "crm-prep-corex.vercel.app",
  "localhost",
  "127.0.0.1",
];

function isUsablePrepcorexBase(url: string): boolean {
  const raw = String(url || "").trim().replace(/\/$/, "");
  if (!raw.startsWith("http://") && !raw.startsWith("https://")) return false;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    if (!host) return false;
    if (NON_PREPCOREX_HOST_MARKERS.some((m) => host === m || host.endsWith(`.${m}`))) {
      return false;
    }
    // Accept prepcorex.com / www / vercel prepcorex app hosts.
    if (host === "prepcorex.com" || host.endsWith(".prepcorex.com")) return true;
    if (host.includes("prepcorex") && host.endsWith(".vercel.app")) return true;
    return false;
  } catch {
    return false;
  }
}

export function getPrepcorexAppBaseUrl(): string {
  const dedicated = String(process.env.NEXT_PUBLIC_PREPCOREX_APP_URL || "")
    .trim()
    .replace(/\/$/, "");
  if (dedicated && isUsablePrepcorexBase(dedicated)) return dedicated;

  const appUrl = String(process.env.NEXT_PUBLIC_APP_URL || "")
    .trim()
    .replace(/\/$/, "");
  if (appUrl && isUsablePrepcorexBase(appUrl)) return appUrl;

  return PREPCOREX_PRODUCTION_BASE;
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
