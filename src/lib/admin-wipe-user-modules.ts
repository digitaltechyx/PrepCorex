/**
 * Shared wipe-module catalog (safe for client + server).
 * Wipe execution lives in `admin-wipe-user-data.ts` (Admin SDK only).
 */

export const WIPE_USER_MODULES = [
  {
    id: "inventory",
    label: "Inventory",
    description: "Products, stock, transfers, restock, recycled records, pallet storage, edit/delete logs",
  },
  {
    id: "inbound",
    label: "Inbound",
    description: "Receive requests, batches, import jobs, receive logs, inbound tracking index",
  },
  {
    id: "outbound",
    label: "Outbound",
    description: "Shipment requests, shipped history, dispatch logs",
  },
  {
    id: "returns",
    label: "Product returns",
    description: "Return requests and arrival / receive history",
  },
  {
    id: "dispose",
    label: "Dispose",
    description: "Dispose requests and batches",
  },
  {
    id: "invoices",
    label: "Invoices & discounts",
    description: "Client invoices and discount trail",
  },
  {
    id: "buy_labels",
    label: "Buy Labels activity",
    description: "Label purchases, refunds, wallet top-ups, ledger, API fee requests (not wallet settings)",
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "In-app client notifications",
  },
  {
    id: "audit_documents",
    label: "Audit & documents",
    description: "Audit trail and document requests",
  },
  {
    id: "integrations",
    label: "Integrations",
    description: "Shopify, eBay, Amazon, TikTok, Woo, ShipStation connections and synced orders",
  },
  {
    id: "quarantine_moves",
    label: "Quarantine & internal moves",
    description: "Quarantine requests and that client's internal move records",
  },
  {
    id: "warehouse_camera",
    label: "Warehouse camera",
    description: "Camera / recording sessions for this client",
  },
  {
    id: "custom_pricing",
    label: "Custom pricing tables",
    description: "Only custom_{uid} rate tables (profile assignment on user is kept)",
  },
  {
    id: "uploaded_pdfs",
    label: "Uploaded PDFs / labels",
    description: "Shipping label PDFs uploaded by this user",
  },
] as const;

export type WipeUserModuleId = (typeof WIPE_USER_MODULES)[number]["id"];

export const ALL_WIPE_MODULE_IDS: WipeUserModuleId[] = WIPE_USER_MODULES.map((m) => m.id);

export function isWipeModuleId(v: string): v is WipeUserModuleId {
  return (ALL_WIPE_MODULE_IDS as string[]).includes(v);
}

export function normalizeWipeModules(raw: unknown): WipeUserModuleId[] {
  if (!Array.isArray(raw)) return [];
  const out: WipeUserModuleId[] = [];
  for (const item of raw) {
    const id = String(item || "").trim();
    if (isWipeModuleId(id) && !out.includes(id)) out.push(id);
  }
  return out;
}
