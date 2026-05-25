import type { User as FirebaseUser } from "firebase/auth";

export type UserRole = "admin" | "user" | "commission_agent" | "sub_admin" | "warehouse_operator";
export type UserStatus = "pending" | "approved" | "deleted";

/** Location that can be assigned to users and to sub admins for scoping. */
export interface Location {
  id: string;
  name: string;
  country?: string;
  stateOrProvince?: string;
  street1?: string;
  street2?: string;
  city?: string;
  zip?: string;
  active: boolean;
  createdAt?: Date;
}

/** Physical warehouse root for barcode / bin hierarchy (see docs/BARCODE_SCANNING/01_LOCATION_STRUCTURE.md). */
export interface WarehouseDoc {
  id: string;
  /** Short code used in bin paths, e.g. NJ02 */
  code: string;
  name: string;
  active: boolean;
  /** Optional link to `locations/{id}` for user assignment and legacy flows. */
  linkedLocationId?: string | null;
  country?: string;
  stateOrProvince?: string;
  street1?: string;
  street2?: string;
  city?: string;
  zip?: string;
  /** Admin-defined purpose labels reused when configuring areas in this warehouse. */
  customPurposes?: string[];
  createdAt?: { seconds: number; nanoseconds: number } | Date;
  updatedAt?: { seconds: number; nanoseconds: number } | Date;
}

/** Operational zone type - see `docs/BARCODE_SCANNING/03_WAREHOUSE_WORKFLOW_V2.md` Part 0. */
export type WarehouseAreaType =
  | "storage"
  | "receiving"
  | "quarantine"
  | "damaged"
  | "returns"
  | "packing"
  | "dispatch";

/** Zone metadata under a warehouse. Shelving (bins) is optional for any area. */
export interface WarehouseAreaDoc {
  id: string;
  /** Single segment used in bin path, e.g. A */
  code: string;
  name?: string;
  /** What happens here (multi-select). Admin can add custom labels. */
  purposes?: string[];
  /** @deprecated Legacy single type — use `purposes`. Kept for older Firestore docs. */
  areaType?: WarehouseAreaType | string;
  active: boolean;
  createdAt?: { seconds: number; nanoseconds: number } | Date;
  updatedAt?: { seconds: number; nanoseconds: number } | Date;
}

/** Leaf storage slot: Warehouse → Area → Row → Bay → Level → binCode */
export interface WarehouseBinDoc {
  id: string;
  area: string;
  row: string;
  bay: string;
  level: string;
  binCode: string;
  /** Full human-readable address, e.g. NJ02-A-1-A-1-A1 */
  path: string;
  /** Encoded on printed labels (defaults to path; may become short id later). */
  barcode: string;
  active: boolean;
  /** Parent area doc id (set when bins are created from the layout wizard). */
  storageAreaId?: string;
  /** Marks bins from a one-off / temporary shelf block (admin can deactivate later). */
  temporary?: boolean;
  /** Groups bins added in one “add shelving” run (for filtered label print). */
  layoutBlockId?: string;
  createdAt?: { seconds: number; nanoseconds: number } | Date;
  updatedAt?: { seconds: number; nanoseconds: number } | Date;
}

/** Carton stock state — see `docs/BARCODE_SCANNING/03_WAREHOUSE_WORKFLOW_V2.md` Part 7. */
export type WarehouseCartonStatus =
  | "receiving"
  | "available"
  | "quarantine"
  | "damaged"
  | "expired"
  | "on_hold"
  | "reserved"
  /** Receive-first model: carton has been received at dock, awaiting putaway/allocation. */
  | "received"
  /** All lines have been put away into bins. */
  | "stowed"
  /** Some lines stowed, some still in receiving staging. */
  | "stowed_partial"
  /** Mixed carton has been split — its lines now live in different bins. The carton record is closed. */
  | "split"
  /** Carton is fully consumed (lines picked) or terminally closed. */
  | "closed";

export type WarehousePalletStatus = "receiving" | "available" | "on_hold" | "dispatched";

/**
 * One SKU line inside a received carton. Single-SKU cartons have exactly one line.
 * Mixed cartons have N lines. Damaged units are recorded as their own line with
 * `condition = "damaged"` so they can be routed to quarantine independently.
 */
export interface WarehouseCartonLine {
  /** Stable id inside the carton (used by Putaway / Allocate). */
  lineId: string;
  sku: string;
  productTitle?: string | null;
  quantity: number;
  lot?: string | null;
  expiry?: string | null;
  /** "good" lines flow to normal SKU bins; "damaged" goes to quarantine. */
  condition: "good" | "damaged";
  /** Set once this line has been put away. null = still in receiving staging. */
  binId?: string | null;
  /** Allocation state for this specific line. */
  allocationStatus?: "unallocated" | "allocated" | "picked";
  /** When admin allocates this line to a client/request. */
  clientId?: string | null;
  inventoryRequestId?: string | null;
}

/** Physical carton (WHAT) — `warehouses/{id}/cartons/{cartonId}`. */
export interface WarehouseCartonDoc {
  id: string;
  /** Human + QR id, e.g. CTN-2026-00042 */
  cartonCode: string;
  /**
   * Single-SKU root field (kept for backward compat + label rendering).
   * For mixed cartons, this is the string "MIXED" and `lines` is the source of truth.
   */
  sku: string;
  lot?: string | null;
  /** ISO date YYYY-MM-DD when expiry-managed */
  expiry?: string | null;
  /** Total good+damaged units across all lines. */
  quantity: number;
  status: WarehouseCartonStatus;
  /** PrepCorex client (3PL) when stock is client-owned */
  clientId?: string | null;
  /** Current bin doc id under this warehouse */
  binId?: string | null;
  /** Optional pallet grouping */
  palletId?: string | null;
  productTitle?: string | null;
  /** Client user uid when received against an inventory request */
  inventoryRequestId?: string | null;
  /** Encoded on printed label QR */
  barcode: string;
  /**
   * Multi-SKU support. Always populated for new cartons (length 1 for single-SKU,
   * length N for mixed). Old single-SKU cartons may be missing this — readers should
   * fall back to root `sku`/`quantity`.
   */
  lines?: WarehouseCartonLine[];
  /** True when `lines.length > 1` (more than one distinct SKU). */
  isMixed?: boolean;
  /** Carrier tracking number on the inbound box (for admin reconciliation later). */
  trackingNumber?: string | null;
  /** UPS / FedEx / USPS / DHL / Other */
  carrier?: string | null;
  /** Free-text notes captured at the dock. */
  notes?: string | null;
  /** Uploaded photo of damage / packaging issue. */
  photoUrl?: string | null;
  /** UID of operator who clicked Receive. */
  receivedBy?: string | null;
  /** Receiving staging area code (e.g. RCV-STAGE-A). */
  stagingArea?: string | null;
  /** When the carton was received (separate from createdAt for clarity). */
  receivedAt?: { seconds: number; nanoseconds: number } | Date;
  createdAt?: { seconds: number; nanoseconds: number } | Date;
  updatedAt?: { seconds: number; nanoseconds: number } | Date;
}

/** Physical pallet (mixed-SKU grouping) — `warehouses/{id}/pallets/{palletId}`. */
export interface WarehousePalletDoc {
  id: string;
  palletCode: string;
  status: WarehousePalletStatus;
  binId?: string | null;
  barcode: string;
  /** Carrier tracking number captured at receiving. */
  trackingNumber?: string | null;
  carrier?: string | null;
  notes?: string | null;
  photoUrl?: string | null;
  receivedBy?: string | null;
  stagingArea?: string | null;
  receivedAt?: { seconds: number; nanoseconds: number } | Date;
  createdAt?: { seconds: number; nanoseconds: number } | Date;
  updatedAt?: { seconds: number; nanoseconds: number } | Date;
}

export type UserFeature =
  | "view_dashboard"
  | "view_inventory"
  | "shipped_orders"
  | "create_shipment"
  | "buy_labels"
  | "upload_labels"
  | "track_shipment"
  | "view_invoices"
  | "restock_summary"
  | "delete_logs"
  | "modification_logs"
  | "disposed_inventory"
  | "my_pricing"
  | "client_documents"
  | "integrations"
  | "view_shopify_orders"
  | "request_product_returns"
  | "affiliate_dashboard"
  | "admin_dashboard"
  | "manage_users"
  | "manage_invoices"
  | "manage_labels"
  | "manage_quotes"
  | "manage_pricing"
  | "manage_documents"
  | "manage_product_returns"
  | "manage_dispose_requests"
  | "manage_shopify_orders"
  | "manage_ebay_orders"
  | "manage_inventory_admin"
  | "manage_notifications"
  | "ops_dashboard"
  | "ops_receive"
  | "ops_putaway"
  | "ops_move"
  | "ops_pick"
  | "ops_pack"
  | "ops_count"
  | "ops_supervisor"
  | "ops_view_expected_inbound";

export interface UserProfile {
  uid: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  password?: string | null;
  companyName?: string | null;
  ein?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  zipCode?: string | null;
  profilePictureUrl?: string | null;
  role: UserRole; // Legacy single role (for backward compatibility)
  roles?: UserRole[]; // New array format for multiple roles
  features?: UserFeature[]; // Granted features
  status?: UserStatus; // Optional for backward compatibility
  createdAt?: Date;
  approvedAt?: Date;
  deletedAt?: Date;
  /** Unique 5-digit display ID for clients (e.g. 10001). Shown with name in admin. */
  clientId?: string | null;
  referredByAgentId?: string; // ID of the commission agent who referred this user
  referralCode?: string; // Unique referral code for commission agents
  socialProfile?: string; // Social media profile URL
  salesExperience?: string[]; // Array of sales experience types
  referralSource?: string; // How they heard about the program
  /** Location IDs assigned to this user (used for Assign Location and sub admin scope). */
  locations?: string[];
  /** Sub admin only: location IDs this sub admin manages. */
  managedLocationIds?: string[];
  /** Sub admin only: user UIDs explicitly assigned to this sub admin (they can manage these users). */
  assignedUserIds?: string[];
  /** Warehouse ops: Firestore `warehouses/{id}` doc ids this user may work in (admin-assigned). */
  assignedWarehouseIds?: string[];
  /** Client (user role): set when user accepts MSA; unlocks default features. */
  accountActivatedAt?: { seconds: number; nanoseconds: number } | Date | null;
  /** Snapshot of client details at MSA acceptance (for agreement document). */
  msaClientDetails?: {
    legalName: string;
    companyName: string;
    address: string;
    email: string;
    phone: string;
  } | null;
  /** MSA effective date (ISO string). */
  msaEffectiveDate?: string | null;
}

export interface InventoryItem {
  id: string;
  productName: string;
  quantity: number;
  dateAdded: {
    seconds: number;
    nanoseconds: number;
  } | string;
  status: 'In Stock' | 'Out of Stock';
  /** Set when item is synced from an external integration (read-only in inventory list). */
  source?: 'shopify' | 'ebay';
  shopifyVariantId?: string;
  shopifyProductId?: string;
  /** Shopify inventory_item_id (for inventory_levels API and webhooks). */
  shopifyInventoryItemId?: string;
  shop?: string;
  sku?: string;
  retailIdentifier?: string;
  expiryDate?: { seconds: number; nanoseconds: number } | string | Date;
  imageUrl?: string;
  imageUrls?: string[];
  /** Internal warehouse location (admin-facing operations). */
  locationId?: string;
  /** Internal per-location quantity allocation (admin-facing, hidden from user UI). */
  locationQuantities?: Record<string, number>;
}

/** Admin-only internal transfer between warehouse locations. */
export interface InventoryTransfer {
  id: string;
  inventoryId: string;
  productName: string;
  sku?: string;
  quantity: number;
  fromLocationId: string;
  toLocationId: string;
  fromLocationName?: string;
  toLocationName?: string;
  reason?: string;
  movedBy?: string;
  movedAt?: { seconds: number; nanoseconds: number } | string | Date;
}

/** User request to add inventory (pending/approved/rejected). */
export interface InventoryRequest {
  id: string;
  userId?: string;
  userName?: string;
  inventoryType: "product" | "box" | "pallet" | "container";
  productName: string;
  /** Requested units (user submit). Kept after approve; use with receivedQuantity for display. */
  quantity: number;
  requestedQuantity?: number;
  /** Units actually received (set on admin approve). Stock uses this value. */
  receivedQuantity?: number;
  /** Links inventory row to the approved inbound request. */
  sourceRequestId?: string;
  sku?: string;
  /** Single optional field for UPC / EAN / FNSKU / ASIN (whatever the client uses). */
  retailIdentifier?: string;
  /** Calendar expiry when applicable (stored as Firestore Timestamp on write). */
  expiryDate?: { seconds: number; nanoseconds: number } | string | Date;
  productSubType?: "new" | "restock";
  productId?: string;
  productEntryMode?: "single" | "variants";
  color?: string;
  size?: string;
  variantLabel?: string;
  parentProductName?: string;
  addDate?: { seconds: number; nanoseconds: number } | string;
  requestedAt?: { seconds: number; nanoseconds: number } | string;
  receivingDate?: { seconds: number; nanoseconds: number } | string;
  status: "pending" | "approved" | "rejected";
  requestedBy?: string;
  approvedBy?: string;
  approvedAt?: { seconds: number; nanoseconds: number } | string;
  rejectedBy?: string;
  rejectedAt?: { seconds: number; nanoseconds: number } | string;
  rejectionReason?: string;
  remarks?: string;
  imageUrl?: string;
  imageUrls?: string[];
}

export interface ShipmentProductItem {
  productId?: string;
  productName: string;
  boxesShipped: number;
  shippedQty: number;
  packOf: number;
  unitPrice?: number;
  remainingQty?: number;
}

export interface LabelProductDetail {
  name: string;
  productId?: string;
  shippedUnits?: number;
  packOf?: number;
  quantity?: number; // total units (shippedUnits * packOf)
}

export interface ShippedItem {
  id: string;
  productName?: string;
  date: {
    seconds: number;
    nanoseconds: number;
  } | string;
  createdAt?: {
    seconds: number;
    nanoseconds: number;
  } | string;
  shippedQty?: number;
  boxesShipped?: number;
  unitsForPricing?: number;
  remainingQty?: number;
  packOf?: number;
  unitPrice?: number;
  packOfPrice?: number;
  shipTo: string;
  remarks?: string;
  items?: ShipmentProductItem[];
  totalBoxes?: number;
  totalUnits?: number;
  totalSkus?: number;

  // Optional fields stored by newer shipment flows (admin side can show richer detail)
  service?: string;
  shipmentType?: string;
  palletSubType?: string;
  productType?: string;
  customDimensions?: string;
  customProductPricing?: any;
  additionalServices?: {
    bubbleWrapFeet?: number;
    stickerRemovalItems?: number;
    warningLabels?: number;
    pricePerFoot?: number;
    pricePerItem?: number;
    pricePerLabel?: number;
    total?: number;
  };
}

export interface RestockHistory {
  id: string;
  productName: string;
  previousQuantity: number;
  restockedQuantity: number;
  newQuantity: number;
  restockedBy: string; // Admin name who restocked
  restockedAt: {
    seconds: number;
    nanoseconds: number;
  } | string;
  /** Optional admin remarks captured at restock time. Visible to user. */
  remarks?: string;
  /** Optional photos uploaded by admin during restock (e.g. carton/dock photos). Visible to user. */
  imageUrls?: string[];
}

export interface RecycledShippedItem {
  id: string;
  productName?: string;
  date: {
    seconds: number;
    nanoseconds: number;
  } | string;
  shippedQty?: number;
  remainingQty?: number;
  packOf?: number;
  shipTo: string;
  remarks?: string;
  recycledAt: {
    seconds: number;
    nanoseconds: number;
  } | string;
  recycledBy: string; // Admin name who recycled
  items?: ShipmentProductItem[];
  totalBoxes?: number;
  totalUnits?: number;
  totalSkus?: number;
}

/** Shopify order synced via webhook; stored in users/{uid}/shopifyOrders/{orderId}. */
export interface ShopifyOrder {
  id: string; // Shopify order id
  order_number: number;
  name?: string; // e.g. "#1001"
  shop: string;
  email?: string;
  financial_status?: string;
  fulfillment_status?: string | null;
  created_at?: string;
  updated_at?: string;
  line_items?: Array<{
    title?: string;
    quantity?: number;
    sku?: string;
    variant_id?: number;
    id?: number;
  }>;
  shipping_address?: {
    first_name?: string;
    last_name?: string;
    address1?: string;
    city?: string;
    province?: string;
    country?: string;
    zip?: string;
    phone?: string;
  };
  billing_address?: Record<string, unknown>;
  customer?: { email?: string; first_name?: string; last_name?: string };
  note?: string;
}

export interface RecycledRestockHistory {
  id: string;
  productName: string;
  previousQuantity: number;
  restockedQuantity: number;
  newQuantity: number;
  restockedBy: string;
  restockedAt: {
    seconds: number;
    nanoseconds: number;
  } | string;
  recycledAt: {
    seconds: number;
    nanoseconds: number;
  } | string;
  recycledBy: string; // Admin name who recycled
}

export interface RecycledInventoryItem {
  id: string;
  productName: string;
  quantity: number;
  dateAdded: {
    seconds: number;
    nanoseconds: number;
  } | string;
  status: 'In Stock' | 'Out of Stock';
  recycledAt: {
    seconds: number;
    nanoseconds: number;
  } | string;
  recycledBy: string; // Admin name who recycled
  remarks?: string; // Reason for recycling
}

/** Product return request (stored under users/{uid}/productReturns). */
export interface ProductReturn {
  id?: string;
  userId?: string;
  type: "existing" | "new";
  returnType?: string;
  productId?: string;
  productName?: string;
  sku?: string;
  newProductName?: string;
  newProductSku?: string;
  requestedQuantity: number;
  receivedQuantity: number;
  status: "pending" | "approved" | "in_progress" | "closed" | "cancelled";
  createdAt?: { seconds: number; nanoseconds: number } | string;
  updatedAt?: { seconds: number; nanoseconds: number } | string;
  userRemarks?: string;
  adminRemarks?: string;
  rejectReason?: string;
  additionalServices?: Record<string, unknown>;
  returnFee?: number;
  packingFee?: number;
  boxQuantity?: number;
  boxPricePerUnit?: number;
  palletFee?: number;
  palletQuantity?: number;
  palletPricePerUnit?: number;
  shippingFee?: number;
  approvedBy?: string;
  approvedAt?: { seconds: number; nanoseconds: number } | string;
  closedAt?: { seconds: number; nanoseconds: number } | string;
  shipments?: Array<Record<string, unknown>>;
  quantityUpdates?: Array<Record<string, unknown>>;
}

/** User-initiated dispose request (user selects product, quantity, reason; admin approves or rejects). */
export interface DisposeRequest {
  id?: string;
  productId: string;
  productName: string;
  quantity: number;
  reason: string;
  status: "pending" | "approved" | "rejected";
  requestedAt?: { seconds: number; nanoseconds: number } | string;
  approvedBy?: string;
  approvedAt?: { seconds: number; nanoseconds: number } | string;
  rejectedBy?: string;
  rejectedAt?: { seconds: number; nanoseconds: number } | string;
  adminFeedback?: string;
}

/** One selected variant – PrepCorex will only fulfill orders containing these. */
export interface ShopifySelectedVariant {
  variantId: string;
  productId: string;
  title: string;
  sku?: string;
}

/** One connected Shopify store for a user (multiple allowed per user). */
export interface ShopifyConnection {
  id?: string;
  shop: string; // e.g. mystore.myshopify.com
  shopName?: string; // Display name
  accessToken: string;
  connectedAt: { seconds: number; nanoseconds: number } | string;
  /** Variants the user selected for PrepCorex to fulfill (orders with these only). */
  selectedVariants?: ShopifySelectedVariant[];
}

export interface DeleteLog {
  id: string;
  productName: string;
  quantity: number;
  dateAdded: {
    seconds: number;
    nanoseconds: number;
  } | string;
  status: 'In Stock' | 'Out of Stock';
  deletedAt: {
    seconds: number;
    nanoseconds: number;
  } | string;
  deletedBy: string; // Admin name who deleted
  reason: string; // Reason for deletion
}

export interface EditLog {
  id: string;
  productName: string;
  previousProductName?: string; // In case product name was changed
  previousQuantity: number;
  newQuantity: number;
  previousStatus: 'In Stock' | 'Out of Stock';
  newStatus: 'In Stock' | 'Out of Stock';
  dateAdded: {
    seconds: number;
    nanoseconds: number;
  } | string;
  editedAt: {
    seconds: number;
    nanoseconds: number;
  } | string;
  editedBy: string; // Admin name who edited
  reason: string; // Reason for editing
}

export interface InvoiceAdditionalCharge {
  id: string;
  name: string;
  amount: number;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  date: string;
  orderNumber: string;
  soldTo: {
    name: string;
    email: string;
    phone?: string;
    address?: string;
  };
  fbm: string;
  items: Array<{
    quantity: number;
    productName: string;
    shipDate?: string;
    packaging: string;
    shipTo: string;
    unitPrice: number;
    amount: number;
    shipmentId?: string; // Track which shipment this item came from
  }>;
  subtotal: number;
  grandTotal: number;
  status: 'pending' | 'paid';
  createdAt: {
    seconds: number;
    nanoseconds: number;
  } | string;
  userId: string;
  autoGenerated?: boolean;
  autoGeneratedForDate?: string;
  autoGeneratedAt?: {
    seconds: number;
    nanoseconds: number;
  } | string;
  range?: {
    from: {
      seconds: number;
      nanoseconds: number;
    } | string;
    to: {
      seconds: number;
      nanoseconds: number;
    } | string;
  };
  /** Admin-added custom charges on pending invoices (service name + flat amount). */
  adminAdditionalCharges?: InvoiceAdditionalCharge[];
  // Optional newer fields (auto-generated invoices, discounts, additional services, container handling, etc.)
  additionalServices?: {
    bubbleWrapFeet?: number;
    stickerRemovalItems?: number;
    warningLabels?: number;
    pricePerFoot?: number;
    pricePerItem?: number;
    pricePerLabel?: number;
    total?: number;
  };
  grossTotal?: number;
  discountType?: "amount" | "percent";
  discountValue?: number;
  discountAmount?: number;
  lateFeeAmount?: number;
  lateFeeReason?: string;
  type?: string;
  isContainerHandling?: boolean;
}

export interface UploadedPDF {
  id: string;
  fileName: string;
  storagePath: string; // Full path in Firebase Storage
  downloadURL: string; // Download URL from Firebase Storage
  size: number; // File size in bytes
  uploadedAt: {
    seconds: number;
    nanoseconds: number;
  } | string;
  uploadedBy: string; // User ID
  uploadedByName: string; // User name (client name)
  year: string; // e.g., "2024"
  month: string; // e.g., "January" or "01"
  date: string; // e.g., "2024-01-15"
  labelProducts?: LabelProductDetail[];
  status?: "pending" | "complete"; // Label processing status
}

export interface Commission {
  id: string;
  agentId: string; // Commission agent's user ID
  agentName: string;
  invoiceId: string;
  invoiceNumber: string;
  clientId: string; // Client's user ID
  clientName: string;
  invoiceAmount: number;
  commissionAmount: number; // 10% of invoice amount
  status: "pending" | "paid";
  createdAt: Date | {
    seconds: number;
    nanoseconds: number;
  } | string;
  paidAt?: Date | {
    seconds: number;
    nanoseconds: number;
  } | string;
  paidBy?: string; // Admin user ID who marked as paid
}

export interface AuthContextType {
  user: FirebaseUser | null;
  userProfile: UserProfile | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

// Stripe & Shippo Integration Types
export interface ShippingAddress {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string;
  email?: string;
}

export interface ParcelDetails {
  length: number;
  width: number;
  height: number;
  weight: number;
  weightUnit: 'lb' | 'oz' | 'kg' | 'g';
  distanceUnit: 'in' | 'ft' | 'cm' | 'm';
}

export interface ShippingRate {
  object_id: string;
  amount: string;
  currency: string;
  provider: string;
  servicelevel: {
    name: string;
    token: string;
  };
  estimated_days?: number;
  shipment?: string; // Shipment ID from Shippo
}

export interface LabelPurchase {
  id: string;
  userId: string;
  purchasedBy: string;
  fromAddress: ShippingAddress;
  toAddress: ShippingAddress;
  parcel: ParcelDetails;
  selectedRate: {
    objectId: string;
    amount: string;
    currency: string;
    provider: string;
    serviceLevel: string;
    shipmentId?: string;
  };
  stripePaymentIntentId: string;
  stripeChargeId?: string;
  paymentStatus: 'pending' | 'succeeded' | 'failed' | 'canceled';
  paymentAmount: number;
  paymentCurrency: string;
  status: 'payment_pending' | 'payment_succeeded' | 'label_purchased' | 'label_failed' | 'completed';
  shippoTransactionId?: string;
  trackingNumber?: string;
  labelUrl?: string;
  errorMessage?: string;
  createdAt: any;
  paymentCompletedAt?: Date;
  labelPurchasedAt?: Date;
  shippedItemId?: string;
}
