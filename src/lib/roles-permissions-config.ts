import type { UserRole, UserFeature } from "@/types";

export const ROLE_DEFINITIONS: {
  value: UserRole;
  label: string;
  description: string;
  dashboardAccess: string;
}[] = [
  {
    value: "admin",
    label: "Super Admin",
    description: "Full system access. Manages roles, permissions, and all modules.",
    dashboardAccess: "Full access to all admin and client modules.",
  },
  {
    value: "user",
    label: "Client / User",
    description: "Standard client with access to their own dashboard and data.",
    dashboardAccess: "Client dashboard: inventory, shipments, invoices, and granted features.",
  },
  {
    value: "commission_agent",
    label: "Commission Agent",
    description: "Affiliate with referral code, clients, and commissions.",
    dashboardAccess: "Affiliate dashboard with referral code, clients, and commissions.",
  },
  {
    value: "sub_admin",
    label: "Sub Admin",
    description: "Limited admin with only explicitly granted admin features.",
    dashboardAccess: "Admin dashboard with only the features granted below.",
  },
  {
    value: "warehouse_operator",
    label: "Warehouse Operator",
    description: "Floor staff — receiving, putaway, and scans via Warehouse Ops app.",
    dashboardAccess: "/warehouse-ops (features and assigned warehouses set by admin).",
  },
];

export { OPS_FEATURES_CONFIG, OPS_FEATURE_PRESETS } from "@/lib/warehouse-ops-permissions";

export const CLIENT_FEATURES_CONFIG: { value: UserFeature; label: string; description: string }[] = [
  { value: "view_dashboard", label: "Dashboard", description: "Access to client dashboard overview" },
  { value: "view_inventory", label: "Inventory", description: "View and manage inventory" },
  { value: "shipped_orders", label: "Shipped Orders", description: "View shipped orders" },
  { value: "create_shipment", label: "Outbound Shipment", description: "Create outbound shipments with labels" },
  { value: "buy_labels", label: "Buy Labels", description: "Access to purchase labels" },
  { value: "upload_labels", label: "Upload Labels", description: "Upload shipping labels" },
  { value: "request_product_returns", label: "Product Returns", description: "Request and view product returns" },
  { value: "track_shipment", label: "Track Shipment", description: "Track shipment status" },
  { value: "view_invoices", label: "View Invoices", description: "View and manage invoices" },
  { value: "my_pricing", label: "My Pricing", description: "View my pricing" },
  { value: "restock_summary", label: "Restock Summary", description: "View restock history" },
  { value: "modification_logs", label: "Modification Logs", description: "View edit history" },
  { value: "delete_logs", label: "Delete Logs", description: "View deletion history" },
  { value: "disposed_inventory", label: "Disposed Inventory", description: "View disposed items and recycle bin" },
  { value: "client_documents", label: "Documents", description: "Access to document requests" },
  { value: "integrations", label: "Integrations", description: "Access to Shopify and eBay integrations" },
  { value: "affiliate_dashboard", label: "Affiliate Dashboard", description: "Access affiliate/commission dashboard" },
];

export const ADMIN_FEATURES_CONFIG: { value: UserFeature; label: string; description: string }[] = [
  { value: "admin_dashboard", label: "Admin Dashboard", description: "Access to admin dashboard overview" },
  { value: "manage_users", label: "Manage Users", description: "Create, edit, and manage users" },
  { value: "manage_invoices", label: "Manage Invoices", description: "View and manage invoices and invoice management" },
  { value: "manage_labels", label: "Manage Labels", description: "View and manage uploaded labels" },
  { value: "manage_quotes", label: "Quote Management", description: "Access to quote management" },
  { value: "manage_pricing", label: "Pricing", description: "Access to pricing management" },
  { value: "manage_documents", label: "Documents", description: "Access to document requests" },
  { value: "manage_product_returns", label: "Product Returns", description: "Access to product returns" },
  { value: "manage_dispose_requests", label: "Dispose Requests", description: "Access to dispose requests" },
  { value: "manage_shopify_orders", label: "Shopify Orders", description: "Access to Shopify orders" },
  { value: "manage_ebay_orders", label: "eBay Orders", description: "Access to eBay orders" },
  { value: "manage_inventory_admin", label: "Inventory Management", description: "Access to admin inventory management" },
  { value: "manage_notifications", label: "Notifications", description: "Access to notifications and pending requests" },
];
