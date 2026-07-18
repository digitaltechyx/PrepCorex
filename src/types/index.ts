import type { User as FirebaseUser } from "firebase/auth";
import type { PlatformDocument } from "@/lib/platform-documents-types";

export type UserRole = "admin" | "user" | "commission_agent" | "sub_admin" | "warehouse_operator";
export type UserStatus = "pending" | "approved" | "deleted" | "locked" | "disabled";

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
  | "closed"
  /** Receive was reversed — not on hand, not putaway-eligible. */
  | "voided";

export type WarehousePalletStatus = "receiving" | "available" | "on_hold" | "dispatched";

/** How stock entered the warehouse (receiving module). */
export type WarehouseReceiveMode = "crossdock" | "unpackaged";

/** Set at putaway: forward, hold closed in an area, or stow into bins. */
export type WarehousePutawayDisposition =
  | "forward"
  | "keep_closed"
  | "open_for_storage"
  /** Unallocated return — stage in pack area, then pack → dispatch. */
  | "return";

/** Cross-dock / return units on the outbound path. */
export type CrossdockDispatchStatus = "awaiting_pack" | "ready" | "dispatched";

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
  /** Floor area code when `binId` is null (line-level; falls back to carton `stagingArea`). */
  stagingArea?: string | null;
  /** Allocation state for this specific line. */
  allocationStatus?: "unallocated" | "allocated" | "picked";
  /** When admin allocates this line to a client/request. */
  clientId?: string | null;
  inventoryRequestId?: string | null;
  /** Linked client product return (RMA) when received as a return. */
  productReturnId?: string | null;
  /** When this damaged line entered quarantine (putaway). */
  quarantineAt?: { seconds: number; nanoseconds: number } | Date | string | null;
  /** Set when quarantine stock was disposed (manual). */
  quarantineDisposedAt?: { seconds: number; nanoseconds: number } | Date | string | null;
  /** Set when operator released quarantine stock back to good storage. */
  quarantineReleasedAt?: { seconds: number; nanoseconds: number } | Date | string | null;
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
  /** Display name when client was typed at receive (no system user). */
  receivedForClient?: string | null;
  /** Current bin doc id under this warehouse */
  binId?: string | null;
  /** Optional pallet grouping */
  palletId?: string | null;
  productTitle?: string | null;
  /** Client user uid when received against an inventory request */
  inventoryRequestId?: string | null;
  /** Client product return doc id when received as RMA */
  productReturnId?: string | null;
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
  /** True when received via open receiving (SKUs entered at dock). */
  isLoose?: boolean;
  /** True when this is a cross-dock polybag/small pack (PKG code, not CTN). */
  isPackage?: boolean;
  /** True when this is a shipping container (CTR code) — contents counted as cartons/pallets/packages. */
  isContainer?: boolean;
  /** Declared carton count inside the container (dock count, before SKU open-receive). */
  containerCartonCount?: number | null;
  /** Declared pallet count inside the container. */
  containerPalletCount?: number | null;
  /** Declared package/polybag count inside the container. */
  containerPackageCount?: number | null;
  /** crossdock = closed carton/pallet; unpackaged = units without master carton. */
  receiveMode?: WarehouseReceiveMode | null;
  /** True when received closed — no SKU manifest until putaway opens it. */
  isClosedCrossdock?: boolean;
  /**
   * True when this unit entered via Returns (walk-in / RMA), not inbound receive.
   * Closed return units reuse the closed-shell open-at-putaway UX but credit as returns.
   */
  isReturnReceive?: boolean;
  /** Chosen at putaway (forward / stage closed / open into bins). */
  putawayDisposition?: WarehousePutawayDisposition | null;
  /** Direct dispatch queue after forward putaway or hold linked to client outbound. */
  crossdockDispatchStatus?: CrossdockDispatchStatus | null;
  crossdockReadyToDispatchAt?: { seconds: number; nanoseconds: number } | Date;
  crossdockDispatchedAt?: { seconds: number; nanoseconds: number } | Date;
  /** Outbound courier label scanned at cross-dock dispatch. */
  crossdockCourierTracking?: string | null;
  /** Path B — client outbound linked to a held cross-dock unit. */
  crossdockLinkedShipmentRequestId?: string | null;
  /** Carrier tracking number on the inbound box (for admin reconciliation later). */
  trackingNumber?: string | null;
  /** UPS / FedEx / USPS / DHL / Other */
  carrier?: string | null;
  /** Free-text notes captured at the dock. */
  notes?: string | null;
  /** Uploaded photo of damage / packaging issue. */
  photoUrl?: string | null;
  /** Multiple dock photos (damage, packaging, etc.). */
  photoUrls?: string[];
  /** UID of operator who clicked Receive. */
  receivedBy?: string | null;
  /** Receiving staging area code (e.g. RCV-STAGE-A). */
  stagingArea?: string | null;
  /** Closed walk-in / cross-dock receive lot printed on the label. */
  receiveLot?: string | null;
  /** When the carton was received (separate from createdAt for clarity). */
  receivedAt?: { seconds: number; nanoseconds: number } | Date;
  /** When a receive was voided (undo / correction). */
  voidedAt?: { seconds: number; nanoseconds: number } | Date;
  voidedBy?: string | null;
  voidReason?: string | null;
  /** Last receive correction (supervisor or pre-putaway edit). */
  correctedAt?: { seconds: number; nanoseconds: number } | Date;
  correctedBy?: string | null;
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
  receiveMode?: WarehouseReceiveMode | null;
  putawayDisposition?: WarehousePutawayDisposition | null;
  crossdockDispatchStatus?: CrossdockDispatchStatus | null;
  crossdockReadyToDispatchAt?: { seconds: number; nanoseconds: number } | Date;
  crossdockDispatchedAt?: { seconds: number; nanoseconds: number } | Date;
  crossdockCourierTracking?: string | null;
  crossdockLinkedShipmentRequestId?: string | null;
  /** Cross-dock pallet received closed — contents unknown until putaway. */
  isClosedCrossdock?: boolean;
  /** True when received via Returns (not inbound). */
  isReturnReceive?: boolean;
  /** Client when known at receive (optional). */
  clientId?: string | null;
  /** Display name when client typed manually (no system user). */
  receivedForClient?: string | null;
  /** Auto lot at cross-dock receive, e.g. LOT-XDOCK20260603042 */
  receiveLot?: string | null;
  receivedAt?: { seconds: number; nanoseconds: number } | Date;
  createdAt?: { seconds: number; nanoseconds: number } | Date;
  updatedAt?: { seconds: number; nanoseconds: number } | Date;
}

/** Cycle count style — see `docs/BARCODE_SCANNING/03_WAREHOUSE_WORKFLOW_V2.md` Part 8. */
export type WarehouseCycleCountType = "spot" | "abc" | "full" | "quick";

export type WarehouseCycleCountTaskStatus =
  | "open"
  | "in_progress"
  | "completed"
  | "cancelled";

export type WarehouseCycleCountVarianceReason =
  | "miscount" // legacy
  | "damaged_not_recorded"
  | "found_stock"
  | "missing_stock"
  | "found_missing_stock"
  | "found_additional_stock"
  | "mislabeled"
  | "other";

export type WarehouseCycleCountResolveStatus =
  | "applied"
  | "acknowledged"
  | "miscount" // legacy
  | "found_missing_stock"
  | "found_additional_stock";

export type WarehouseCycleCountResolveAction =
  | "apply_stock"
  | "acknowledge"
  | "miscount" // legacy
  | "found_missing_stock"
  | "found_additional_stock";

export interface WarehouseCycleCountExpectedLine {
  key: string;
  sku: string;
  lot: string | null;
  expiry: string | null;
  condition: "good" | "damaged";
  productTitle: string | null;
  expectedQty: number;
  cartonIds: string[];
  cartonCodes: string[];
}

export interface WarehouseCycleCountCountedLine {
  key: string;
  sku: string;
  lot: string | null;
  condition: "good" | "damaged";
  expectedQty: number;
  countedQty: number;
  variance: number;
  varianceReason?: WarehouseCycleCountVarianceReason | null;
  varianceNotes?: string | null;
  /** Admin resolution from cycle count report. */
  resolveStatus?: WarehouseCycleCountResolveStatus | null;
  resolveAction?: WarehouseCycleCountResolveAction | null;
  resolveNotes?: string | null;
  resolvedAt?: { seconds: number; nanoseconds: number } | Date | null;
  resolvedBy?: string | null;
  resolveDetail?: string | null;
}

export interface WarehouseCycleCountBinResult {
  binId: string;
  binPath: string;
  expectedLines: WarehouseCycleCountExpectedLine[];
  scannedCartonIds: string[];
  scannedCartonCodes: string[];
  countedLines: WarehouseCycleCountCountedLine[];
  hasVariance: boolean;
  submittedAt?: { seconds: number; nanoseconds: number } | Date;
  submittedBy?: string | null;
  notes?: string | null;
}

/** `warehouses/{id}/cycleCountTasks/{taskId}` */
export interface WarehouseCycleCountTaskDoc {
  id: string;
  warehouseId: string;
  type: WarehouseCycleCountType;
  status: WarehouseCycleCountTaskStatus;
  title: string;
  binIds: string[];
  binPaths: string[];
  completedBinIds: string[];
  binResults: WarehouseCycleCountBinResult[];
  createdBy?: string | null;
  createdAt?: { seconds: number; nanoseconds: number } | Date;
  startedAt?: { seconds: number; nanoseconds: number } | Date;
  completedAt?: { seconds: number; nanoseconds: number } | Date;
  cancelledAt?: { seconds: number; nanoseconds: number } | Date;
  notes?: string | null;
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
  | "csv_import_inbound"
  | "csv_import_outbound"
  | "csv_import_buy_labels"
  | "csv_import_dispose"
  | "csv_import_product_returns"
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
  | "ops_returns"
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
  /** Last successful login for client inactivity tracking (ISO / Firestore timestamp). */
  lastLoginAt?: { seconds: number; nanoseconds: number } | string | Date | null;
  lockedAt?: { seconds: number; nanoseconds: number } | string | Date | null;
  disabledAt?: { seconds: number; nanoseconds: number } | string | Date | null;
  /** Why the account was locked/disabled (`inactivity` or `manual`). */
  accountStatusReason?: "inactivity" | "manual" | null;
  /** When true, user must verify email via Firebase before login (new registrations only). */
  emailVerificationRequired?: boolean;
  /**
   * Admin override: allow this user to use the app without verifying email yet.
   * They can still verify later via the normal email link.
   */
  emailVerificationDeferredByAdmin?: boolean;
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
  /** Frozen MSA legal template content accepted at activation (for signed PDF export). */
  msaDocumentSnapshot?: PlatformDocument | null;
  /** Client onboarding: business type selected at activation. */
  businessType?: string | null;
  /** Client onboarding: services the client needs. */
  servicesNeeded?: string[] | null;
  /** Client onboarding: estimated monthly sales volume band. */
  salesVolume?: string | null;
  /** Normalized keys for uniqueness enforcement. */
  companyNameKey?: string | null;
  einKey?: string | null;
  phoneKey?: string | null;
  /** Set when business + services profile steps are completed (before MSA). */
  onboardingProfileCompletedAt?: { seconds: number; nanoseconds: number } | Date | null;
  /** MSA acceptance record at account activation. */
  msaAcceptance?: {
    version: number;
    effectiveAt?: string | null;
    acceptedAt?: { seconds: number; nanoseconds: number } | Date | string | null;
    acceptMsa: boolean;
    acceptSchedules: boolean;
    authorityConfirmed: boolean;
    legalName?: string | null;
  } | null;
  /** Assigned pricing profile id (`standard`, `wholesale`, … or `custom_{uid}`). */
  pricingProfileId?: string | null;
  /** Product-base vs pallet-base storage billing (PrepCorex). */
  storageType?: "product_base" | "pallet_base" | null;
}

/** User account audit trail event types (`users/{uid}/auditTrail`). */
export type UserAuditEventType =
  | "account_created"
  | "sign_in"
  | "sign_out"
  | "account_approved"
  | "profile_completed"
  | "account_activated"
  | "user_action";

export interface UserAuditEvent {
  id: string;
  userId: string;
  type: UserAuditEventType;
  /** Human-readable label for `user_action` and optional detail for lifecycle events. */
  action?: string | null;
  description?: string | null;
  occurredAt: string;
  ipAddress?: string | null;
  region?: string | null;
  userAgent?: string | null;
  sessionId?: string | null;
  sessionStartedAt?: string | null;
  /** Elapsed ms from session start at time of event. */
  sessionDurationMs?: number | null;
  /** Admin uid when an admin performed an action on behalf of / for this user. */
  performedByUid?: string | null;
  metadata?: Record<string, unknown> | null;
  /** True when reconstructed from profile timestamps (no live log existed). */
  synthetic?: boolean;
}

export interface InventoryItem {
  id: string;
  productName: string;
  /** Sellable good units (updated on warehouse putaway — Option B). */
  quantity: number;
  /** Non-sellable damaged units currently at warehouse (quarantine / hold). */
  damagedQuantity?: number;
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
  /** Warehouse receive / dock photos — shown under Remarks, not the product thumbnail. */
  remarksImageUrls?: string[];
  /** When warehouse putaway first added this stock to the client inventory. */
  receivingDate?: { seconds: number; nanoseconds: number } | string | Date;
  /** Inbound inventory request that created/restocked this item. */
  sourceRequestId?: string;
  remarks?: string;
  /** Copied from approved inbound request; refreshed on same 6-hour schedule. */
  inboundTrackings?: InboundTrackingEntry[];
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
  status: "pending" | "approved" | "rejected" | "cancelled";
  requestedBy?: string;
  approvedBy?: string;
  approvedAt?: { seconds: number; nanoseconds: number } | string;
  rejectedBy?: string;
  rejectedAt?: { seconds: number; nanoseconds: number } | string;
  cancelledBy?: string;
  cancelledAt?: { seconds: number; nanoseconds: number } | string;
  /** Required when the client cancels a pending inbound request. */
  cancellationReason?: string;
  rejectionReason?: string;
  remarks?: string;
  imageUrl?: string;
  imageUrls?: string[];
  /** Dock receive photos linked at warehouse — shown in inventory Remarks. */
  remarksImageUrls?: string[];
  /** Carrier tracking numbers client adds while inbound is pending or in transit to warehouse. */
  inboundTrackings?: InboundTrackingEntry[];
  /** Warehouse inbound v2: open until fully received or manually closed. */
  fulfillmentStatus?: "open" | "closed";
  /** Good units put away to warehouse (client sellable stock source). */
  warehouseGoodReceivedQty?: number;
  /** Damaged units put away to quarantine / hold. */
  warehouseDamagedReceivedQty?: number;
  closedAt?: { seconds: number; nanoseconds: number } | string;
  closedBy?: string;
  closeReason?: string;
  /** When part of a batched inbound submission. */
  batchId?: string;
  batchLineId?: string;
}

/** How inbound freight arrives (optional, batch-level). */
export type InboundShipmentType = "carton" | "pallet" | "container" | "package";

/** What is inside the inbound shipment (optional, batch-level). */
export const INBOUND_LOAD_CONTENTS_OPTIONS = ["carton", "pallet", "both"] as const;
export type InboundLoadContents = (typeof INBOUND_LOAD_CONTENTS_OPTIONS)[number];

export type InboundBatchStatus = "pending" | "partial" | "completed" | "cancelled";

export type InboundImportJobStatus =
  | "uploading"
  | "queued"
  | "processing"
  | "cancelling"
  | "completed"
  | "cancelled"
  | "failed";

/** Parent doc for a multi-line inbound submission (`users/{uid}/inboundBatches`). */
export interface InboundBatch {
  id: string;
  userId: string;
  userName: string;
  shipmentType?: InboundShipmentType;
  loadContents?: InboundLoadContents;
  /** Optional overview of products in this inbound batch (user-provided). */
  productNotes?: string;
  status: InboundBatchStatus;
  totalLines: number;
  pendingLines: number;
  approvedLines: number;
  rejectedLines: number;
  cancelledLines: number;
  addDate?: { seconds: number; nanoseconds: number } | string;
  requestedAt?: { seconds: number; nanoseconds: number } | string;
  requestedBy?: string;
  cancelledBy?: string;
  cancelledAt?: { seconds: number; nanoseconds: number } | string;
  cancellationReason?: string;
}

export interface InboundImportJob {
  id: string;
  userId: string;
  userName: string;
  batchId: string;
  shipmentType?: InboundShipmentType;
  loadContents?: InboundLoadContents;
  productNotes?: string;
  status: InboundImportJobStatus;
  totalRows: number;
  processedRows: number;
  failedRows?: number;
  totalChunks: number;
  processedChunks: number;
  cancelRequested?: boolean;
  errorMessage?: string;
  elapsedMs?: number;
  addDate?: { seconds: number; nanoseconds: number } | string;
  requestedAt?: { seconds: number; nanoseconds: number } | string;
  startedAt?: { seconds: number; nanoseconds: number } | string;
  completedAt?: { seconds: number; nanoseconds: number } | string;
  cancelledAt?: { seconds: number; nanoseconds: number } | string;
  lastProgressAt?: { seconds: number; nanoseconds: number } | string;
  requestedBy?: string;
}

/** Line item under a batch (`users/{uid}/inboundBatches/{batchId}/lines`). */
export interface InboundBatchLine {
  id: string;
  batchId: string;
  lineNumber: number;
  userId?: string;
  userName?: string;
  inventoryType: InventoryRequest["inventoryType"];
  productName: string;
  quantity: number;
  requestedQuantity?: number;
  receivedQuantity?: number;
  sku?: string;
  retailIdentifier?: string;
  expiryDate?: InventoryRequest["expiryDate"];
  productSubType?: InventoryRequest["productSubType"];
  productId?: string;
  productEntryMode?: InventoryRequest["productEntryMode"];
  color?: string;
  size?: string;
  variantLabel?: string;
  parentProductName?: string;
  containerSize?: ContainerSize;
  addDate?: InventoryRequest["addDate"];
  requestedAt?: InventoryRequest["requestedAt"];
  status: InventoryRequest["status"];
  remarks?: string;
  imageUrl?: string;
  imageUrls?: string[];
  trackingNumber?: string;
  carrier?: string;
  approvedBy?: string;
  approvedAt?: InventoryRequest["approvedAt"];
  rejectedBy?: string;
  rejectedAt?: InventoryRequest["rejectedAt"];
  rejectionReason?: string;
  receivingDate?: InventoryRequest["receivingDate"];
  fulfillmentStatus?: InventoryRequest["fulfillmentStatus"];
  warehouseGoodReceivedQty?: number;
  warehouseDamagedReceivedQty?: number;
  /** Populated on approve — links to top-level request for warehouse/history. */
  inventoryRequestId?: string;
}

export interface InboundReceiveLog {
  id: string;
  inventoryId?: string | null;
  inventoryRequestId?: string | null;
  productName: string;
  sku?: string | null;
  eventType: "initial" | "restock";
  goodQty: number;
  damagedQty: number;
  goodQtyBefore?: number | null;
  goodQtyAfter?: number | null;
  damagedQtyBefore?: number | null;
  damagedQtyAfter?: number | null;
  remarks?: string | null;
  photoUrls?: string[];
  warehouseId?: string | null;
  cartonId?: string | null;
  cartonCode?: string | null;
  lineId?: string | null;
  binPath?: string | null;
  stagingArea?: string | null;
  operatorId?: string | null;
  operatorName?: string | null;
  putawayAt?: { seconds: number; nanoseconds: number } | string | Date;
  /** Idempotency key — `${warehouseId}_${cartonId}_${lineId}_${dest}`. */
  syncKey?: string | null;
}

/** Stock decrease audit trail (users/{uid}/inventoryChangeLogs) — outbound dispatch, etc. */
export interface InventoryChangeLog {
  id: string;
  inventoryId: string;
  productName: string;
  sku?: string | null;
  eventType: "outbound_dispatch" | "outbound_shipped" | "admin_ship" | "edit" | "dispose";
  qtyBefore: number;
  qtyAfter: number;
  qtyChange: number;
  shipmentRequestId?: string | null;
  shippedId?: string | null;
  service?: string | null;
  shipTo?: string | null;
  details?: string | null;
  at?: { seconds: number; nanoseconds: number } | string | Date;
}

/** Inbound shipment tracking (client → warehouse). Status refreshed every 6 hours via Shippo. */
export interface InboundTrackingEntry {
  id: string;
  trackingNumber: string;
  carrier?: string | null;
  addedAt?: { seconds: number; nanoseconds: number } | string | Date;
  addedBy?: string | null;
  lastStatus?: string | null;
  lastStatusLabel?: string | null;
  lastStatusDetails?: string | null;
  lastCheckedAt?: { seconds: number; nanoseconds: number } | string | Date;
  lastError?: string | null;
}

/** User outbound shipment request (stored under users/{uid}/shipmentRequests). */
export interface ShipmentRequest {
  id: string;
  date?: { seconds: number; nanoseconds: number } | string;
  requestedAt?: { seconds: number; nanoseconds: number } | string;
  status?: "pending" | "awaiting_label_upload" | "confirmed" | "rejected" | "cancelled";
  shipTo?: string;
  service?: string;
  productType?: string;
  remarks?: string;
  /** Client preference for outbound pack unit: box (carton) or pallet. */
  shipmentPreference?: "box" | "pallet";
  rejectionReason?: string;
  shipments: Array<Record<string, unknown>>;
  confirmedAt?: { seconds: number; nanoseconds: number } | string;
  rejectedAt?: { seconds: number; nanoseconds: number } | string;
  cancelledAt?: { seconds: number; nanoseconds: number } | string;
  cancelledBy?: string;
  /** Required when the client cancels a pending outbound request. */
  cancellationReason?: string;
  /** Warehouse floor pick after admin confirms outbound. */
  warehousePickStatus?: "ready" | "picking" | "picked" | "skipped";
  warehousePickedAt?: { seconds: number; nanoseconds: number } | string;
  warehousePickedBy?: string | null;
  warehousePickSkippedAt?: { seconds: number; nanoseconds: number } | string;
  warehousePickSkippedBy?: string | null;
  warehousePickSkipReason?: string | null;
  warehouseId?: string | null;
  /** Warehouse floor pack after pick. */
  warehousePackStatus?: "pending" | "packing" | "ready_to_dispatch";
  warehousePackVerifiedKeys?: string[];
  warehouseReadyToDispatchAt?: { seconds: number; nanoseconds: number } | string;
  warehousePackedBy?: string | null;
  /** Courier label tracking scanned at pack bench before ready to dispatch. */
  warehouseCourierTracking?: string | null;
  warehousePackCourierVerifiedAt?: { seconds: number; nanoseconds: number } | string;
  /** Dispatch handoff after carrier pickup scan. */
  warehouseDispatchStatus?: "ready" | "dispatched";
  warehouseDispatchedAt?: { seconds: number; nanoseconds: number } | string;
  warehouseDispatchedBy?: string | null;
  /** When client sellable inventory was decremented (dispatch for warehouse orders). */
  clientInventoryDeductionTiming?: "confirm" | "dispatch";
  clientInventoryDeductedAt?: { seconds: number; nanoseconds: number } | string;
  adminCustomProductPricing?: Record<number, { unitPrice: number; packOf: number; packOfPrice: number }>;
  /** Dispatch QC — package / carton / pallet condition before handoff. */
  warehouseQcUnitType?: "package" | "carton" | "pallet" | null;
  warehouseQcCondition?: "good" | "not_good" | null;
  warehouseQcRemarks?: string | null;
  warehouseQcPassedAt?: { seconds: number; nanoseconds: number } | string;
  warehouseQcPassedBy?: string | null;
  warehouseQcFailedAt?: { seconds: number; nanoseconds: number } | string;
  warehouseQcFailedBy?: string | null;
  /** Lines removed at ready-to-dispatch — restored if dispatch QC fails. */
  warehousePackStockSnapshot?: Array<{
    cartonId: string;
    cartonCode: string;
    removedLines: Array<Record<string, unknown>>;
  }>;
  /** Fulfilled from a held cross-dock unit — no client inventory deduction. */
  crossdockFulfillment?: boolean;
  crossdockLinkedUnitId?: string | null;
  crossdockLinkedUnitKind?: "carton" | "pallet" | null;
  crossdockLinkedUnitCode?: string | null;
  labelUrl?: string;
  labelUploadedAt?: { seconds: number; nanoseconds: number } | string;
  /** New FBA/WFS/TFS requests — label after warehouse posts master case details. */
  fbaLabelWorkflow?: boolean;
  fbaPackPhase?: FbaPackPhase | null;
  fbaMasterCases?: FbaMasterCase[];
  fbaMasterCaseCompletedAt?: { seconds: number; nanoseconds: number } | string;
  fbaMasterCaseCompletedBy?: string | null;
  fbaLabelReadyAt?: { seconds: number; nanoseconds: number } | string;
  fbaLabelUploadedBy?: "client" | "warehouse";
  fbaClientLabelUploadedAt?: { seconds: number; nanoseconds: number } | string;
  fbaWarehouseLabelUploadedAt?: { seconds: number; nanoseconds: number } | string;
  fbaWarehouseLabelUploadedBy?: string | null;
  /** Ops will purchase/apply courier label — pack may finish without client upload. */
  fbaWarehouseBuysLabel?: boolean;
  fbaWarehouseBuysLabelAt?: { seconds: number; nanoseconds: number } | string;
  fbaWarehouseBuysLabelBy?: string | null;
}

export type FbaWeightUnit = "lb" | "kg";
export type FbaDimensionUnit = "in" | "cm";
export type FbaPackPhase = "awaiting_label" | "awaiting_courier";

export interface FbaMasterCase {
  id: string;
  caseNumber: number;
  weight: number;
  weightUnit: FbaWeightUnit;
  length: number;
  width: number;
  height: number;
  dimensionUnit: FbaDimensionUnit;
  notes?: string;
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
  /** Client preference for outbound pack unit: box (carton) or pallet. */
  shipmentPreference?: "box" | "pallet";
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
  /** Units already shipped back out from this return. */
  shippedQuantity?: number;
  /** Units already credited to client inventory (putaway / QC restock). */
  inventoryCreditedQuantity?: number;
  status: "pending" | "approved" | "in_progress" | "closed" | "cancelled";
  /** open | closed | ready_to_close — warehouse ops fulfillment. */
  fulfillmentStatus?: string;
  /** e.g. warehouse_ops_walk_in */
  source?: string;
  createdAt?: { seconds: number; nanoseconds: number } | string;
  updatedAt?: { seconds: number; nanoseconds: number } | string;
  userRemarks?: string;
  adminRemarks?: string;
  /** Optional product photo submitted with the return request. */
  imageUrl?: string;
  imageUrls?: string[];
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
  pricing?: Record<string, unknown>;
  invoiceId?: string;
  invoiceNumber?: string;
  approvedBy?: string;
  approvedAt?: { seconds: number; nanoseconds: number } | string;
  closedAt?: { seconds: number; nanoseconds: number } | string;
  closedBy?: string;
  receivingLog?: Array<Record<string, unknown>>;
  shippingLog?: Array<Record<string, unknown>>;
  shipments?: Array<Record<string, unknown>>;
  quantityUpdates?: Array<Record<string, unknown>>;
  /** Carrier tracking while return shipment is in transit to warehouse. */
  returnTrackings?: InboundTrackingEntry[];
  /** Calendar expiry YYYY-MM-DD when submitted with the return. */
  expiryDate?: string | null;
  /** All dock photos from partial receives — also copied to inventory remarks on putaway. */
  receivePhotoUrls?: string[];
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
  /** When created from a CSV bulk dispose batch. */
  batchId?: string;
  batchLineId?: string;
}

export type DisposeInventoryStockStatus = "In Stock" | "Low Stock" | "Expired";

export type DisposeBatchStatus = "pending" | "partial" | "completed" | "cancelled";

/** Parent doc for a multi-line dispose CSV submission (`users/{uid}/disposeBatches`). */
export interface DisposeBatch {
  id: string;
  userId: string;
  userName: string;
  reason: string;
  status: DisposeBatchStatus;
  totalLines: number;
  pendingLines: number;
  approvedLines: number;
  rejectedLines: number;
  requestedAt?: { seconds: number; nanoseconds: number } | string;
  requestedBy?: string;
}

/** Line item under a dispose batch (`users/{uid}/disposeBatches/{batchId}/lines`). */
export interface DisposeBatchLine {
  id: string;
  batchId: string;
  lineNumber: number;
  productId: string;
  productName: string;
  sku?: string;
  currentQuantity: number;
  stockStatus: DisposeInventoryStockStatus;
  expiryDate?: InventoryItem["expiryDate"];
  quantity: number;
  reason?: string;
  status: "pending" | "approved" | "rejected";
  approvedBy?: string;
  approvedAt?: { seconds: number; nanoseconds: number } | string;
  rejectedBy?: string;
  rejectedAt?: { seconds: number; nanoseconds: number } | string;
  adminFeedback?: string;
  requestedAt?: { seconds: number; nanoseconds: number } | string;
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
  /** Payment due date (YYYY-MM-DD, America/New_York). */
  dueDate?: string;
  invoiceCreatedEmailSentAt?: { seconds: number; nanoseconds: number } | string;
  reminderPenultimateEmailSentAt?: { seconds: number; nanoseconds: number } | string;
  reminderDueDayEmailSentAt?: { seconds: number; nanoseconds: number } | string;
  lateFeeEmailSentAt?: { seconds: number; nanoseconds: number } | string;
  type?: string;
  isContainerHandling?: boolean;
  updatedAt?: { seconds: number; nanoseconds: number } | string;
}

/** Ledger entry when admin applies a discount to an invoice. */
export interface DiscountTrailEntry {
  id: string;
  userId?: string;
  userName?: string;
  invoiceId: string;
  invoiceNumber: string;
  discountType: "amount" | "percent";
  discountValue: number;
  discountAmount: number;
  grossTotal?: number;
  grandTotalAfter?: number;
  invoiceStatus?: "pending" | "paid" | string;
  appliedAt?: { seconds: number; nanoseconds: number } | string;
  appliedBy?: string | null;
  appliedByName?: string | null;
  /** Present when merged from invoice history without a stored trail doc. */
  source?: "invoice_backfill";
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

export type AffiliateTierName = "Bronze" | "Silver" | "Gold";

export type AffiliateAuditEventType =
  | "commission_created"
  | "commission_paid"
  | "agent_approved"
  | "agent_rejected"
  | "agent_deleted"
  | "agent_restored"
  | "client_referred"
  | "tier_snapshot";

export interface AffiliateAuditEvent {
  id: string;
  agentId: string;
  agentName?: string | null;
  type: AffiliateAuditEventType;
  action?: string | null;
  description?: string | null;
  occurredAt: string;
  performedByUid?: string | null;
  performedByName?: string | null;
  metadata?: Record<string, unknown> | null;
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
  commissionAmount: number;
  commissionRate?: number; // Tier rate % at time of creation (5, 7, or 8)
  tier?: AffiliateTierName; // Agent tier at time of creation
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
  originalAmount?: string;
  labelProvider?: "shippo" | "shipbest";
  logisticsProductId?: number;
  logisticsProductCode?: string;
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
    labelProvider?: "shippo" | "shipbest";
    logisticsProductId?: number;
    logisticsProductCode?: string;
    originalAmount?: string;
  };
  stripePaymentIntentId: string;
  stripeChargeId?: string;
  paymentStatus: 'pending' | 'succeeded' | 'failed' | 'canceled';
  paymentAmount: number;
  paymentCurrency: string;
  status: 'payment_pending' | 'payment_succeeded' | 'label_purchased' | 'label_failed' | 'completed';
  labelProvider?: "shippo" | "shipbest";
  shippoTransactionId?: string;
  shipbestOrderNo?: string;
  shipbestCustomNo?: string;
  trackingNumber?: string;
  labelUrl?: string;
  errorMessage?: string;
  createdAt: any;
  paymentCompletedAt?: Date;
  labelPurchasedAt?: Date;
  shippedItemId?: string;
}

// ——— Pricing (prep, storage, forwarding) ———

export type ServiceType = "FBA/WFS/TFS" | "DTC/FBM";
export const DTC_FBM_SERVICE: ServiceType = "DTC/FBM";

/** Legacy stored value before rename to DTC/FBM. */
export type LegacyFbmService = "FBM";

export function isDtcFbmService(service: string | undefined | null): boolean {
  return service === DTC_FBM_SERVICE || service === "FBM";
}

export function servicesMatch(
  a: string | undefined | null,
  b: string | undefined | null
): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return isDtcFbmService(a) && isDtcFbmService(b);
}

export function normalizeStoredServiceType(
  service: string | undefined | null
): ServiceType | null {
  const value = String(service || "").trim();
  if (value === "FBA/WFS/TFS" || value === "FBA" || value === "WFS" || value === "TFS") {
    return "FBA/WFS/TFS";
  }
  if (isDtcFbmService(value)) return DTC_FBM_SERVICE;
  return null;
}

export function formatServiceLabel(service: string | undefined | null): string {
  if (!service) return "N/A";
  if (service === "FBM") return DTC_FBM_SERVICE;
  return service;
}

export type ShipmentPreference = "box" | "pallet";

/** Client preference for outbound pack unit: box (SPD) or pallet (LTL). */
export function formatShipmentPreferenceLabel(
  preference: ShipmentPreference | string | undefined | null
): string {
  if (preference === "box") return "SPD";
  if (preference === "pallet") return "LTL";
  if (!preference) return "Select";
  return String(preference);
}

export type PackageType = string;
export type QuantityRange = string;
/** FBA/DTC-FBM prep pricing uses Standard only; Custom may appear on legacy shipment rows. */
export type ProductType = "Standard" | "Large" | "Custom";
export type StorageType = "product_base" | "pallet_base";
export const CONTAINER_SIZE_OPTIONS = ["20 feet", "40 feet", "53 feet"] as const;
export type ContainerSize = (typeof CONTAINER_SIZE_OPTIONS)[number];

export interface UserPricing {
  id: string;
  userId?: string;
  service: ServiceType;
  package: PackageType;
  quantityRange: QuantityRange;
  productType: ProductType;
  rate: number;
  packOf: number;
  updatedAt?: unknown;
  createdAt?: unknown;
}

export interface UserStoragePricing {
  id: string;
  userId?: string;
  storageType: StorageType;
  /** Legacy flat rate — used as month1 fallback. */
  price: number;
  month1Rate?: number;
  month2to6Rate?: number;
  month6PlusRate?: number;
  palletCount?: number;
  updatedAt?: unknown;
  createdAt?: unknown;
}

/** Billable pallet footprint for a client (separate from physical putaway). */
export interface PalletStoragePosition {
  id: string;
  label: string;
  status: "active" | "closed";
  cycleId?: string;
  hasSpace?: boolean;
  /** Physical cartons currently on this billable pallet (max cartonCapacity). */
  cartonCount?: number;
  /** Capacity in cartons — default 10. */
  cartonCapacity?: number;
  warehouseId?: string | null;
  receiveBatchId?: string | null;
  notes?: string | null;
  consolidatedIntoPositionId?: string | null;
  closeReason?: string | null;
  closedAt?: unknown;
  assignedBy?: string | null;
  lastConsolidatedAt?: unknown;
  lastConsolidatedBy?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PalletStoragePositionContent {
  id: string;
  sku?: string | null;
  productName?: string | null;
  quantity?: number;
  notes?: string | null;
  receiveBatchId?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UserBoxForwardingPricing {
  id: string;
  userId?: string;
  price: number;
  updatedAt?: unknown;
  createdAt?: unknown;
}

export interface UserPalletForwardingPricing {
  id: string;
  userId?: string;
  price: number;
  updatedAt?: unknown;
  createdAt?: unknown;
}

export interface UserPalletExistingInventoryPricing {
  id: string;
  userId?: string;
  price: number;
  updatedAt?: unknown;
  createdAt?: unknown;
}

export interface UserContainerHandlingPricing {
  id: string;
  userId?: string;
  containerSize: ContainerSize;
  price: number;
  updatedAt?: unknown;
  createdAt?: unknown;
}

export interface UserAdditionalServicesPricing {
  id: string;
  userId?: string;
  bubbleWrapPrice?: number;
  stickerRemovalPrice?: number;
  warningLabelPrice?: number;
  extraServices?: unknown;
  updatedAt?: unknown;
  createdAt?: unknown;
}

export interface PricingProfileMeta {
  id: string;
  kind: "global" | "custom";
  label: string;
  userId?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
}
