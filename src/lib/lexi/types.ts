export type LexiActionType =
  | "inbound_create"
  | "inbound_approve"
  | "inbound_reject"
  | "inbound_complete"
  | "outbound_create"
  | "outbound_approve"
  | "outbound_reject"
  | "outbound_pick_pack"
  | "outbound_ship_inventory"
  | "outbound_dispatch"
  | "inbound_fulfill_all"
  | "outbound_fulfill_all"
  | "restock"
  | "return_review"
  | "dispose_review"
  | "delete_review"
  | "quarantine_review"
  | "label_review";

export const LEXI_CLIENT_ACTION_TYPES: LexiActionType[] = [
  "inbound_complete",
  "inbound_fulfill_all",
  "outbound_fulfill_all",
  "outbound_create",
  "outbound_reject",
  "outbound_pick_pack",
  "outbound_ship_inventory",
  "outbound_dispatch",
  "restock",
  "return_review",
  "dispose_review",
  "delete_review",
  "quarantine_review",
  "label_review",
];

export type LexiReportAttachment = {
  title: string;
  filename: string;
  csv: string;
};

export type LexiPendingQueueItem = {
  key: string;
  clientUserId: string;
  clientUserName: string;
  requestId: string;
  type: string;
  productName: string;
  quantity: number;
  proposeTool: string;
  supported: boolean;
  skipReason?: string;
  labelKind?: "refund" | "topup" | "api_fee";
  batchId?: string;
  batchLineId?: string;
};

export type LexiPendingProcessingQueue = {
  mode: "approve" | "fulfill";
  total: number;
  supportedCount: number;
  skippedCount: number;
  items: LexiPendingQueueItem[];
  currentIndex: number;
};

export type LexiChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type LexiPendingAction = {
  id: string;
  type: LexiActionType;
  summary: string;
  payload: LexiActionPayload;
};

export type LexiActionPayload =
  | LexiInboundCreatePayload
  | LexiInboundApprovePayload
  | LexiInboundCompletePayload
  | LexiOutboundCreatePayload
  | LexiOutboundApprovePayload
  | LexiOutboundJobPayload
  | LexiRejectPayload
  | LexiOutboundDispatchPayload
  | LexiRestockPayload
  | LexiReviewPayload
  | LexiDisposeReviewPayload
  | LexiLabelReviewPayload;

export type LexiInboundCreatePayload = {
  clientUserId: string;
  clientUserName: string;
  productName: string;
  sku: string;
  quantity: number;
  productSubType: "new" | "restock";
  productId?: string;
  remarks?: string;
};

export type LexiInboundApprovePayload = {
  clientUserId: string;
  clientUserName: string;
  requestId: string;
  productName: string;
  quantity: number;
};

export type LexiInboundCompletePayload = {
  clientUserId: string;
  clientUserName: string;
  requestId: string;
  productName: string;
  sku: string;
  quantity?: number;
  warehouseId?: string;
  binPath?: string;
  useDefaultBin?: boolean;
};

export type LexiOutboundLinePayload = {
  productId: string;
  productName: string;
  sku?: string;
  quantity: number;
  packOf: number;
  unitPrice: number;
  totalPrice: number;
};

export type LexiOutboundCreatePayload = {
  clientUserId: string;
  clientUserName: string;
  service: string;
  shipmentPreference: "box" | "pallet";
  productType?: string;
  shipTo?: string;
  remarks?: string;
  lines: LexiOutboundLinePayload[];
  fbaLabelWorkflow: boolean;
};

export type LexiInboundFulfillAllPayload = {
  clientUserId: string;
  clientUserName: string;
  requestId: string;
  productName: string;
  sku: string;
  quantity: number;
  skipApprove?: boolean;
  useDefaultBin?: boolean;
  binPath?: string;
  warehouseId?: string;
};

export type LexiOutboundFulfillAllPayload = {
  clientUserId: string;
  clientUserName: string;
  requestId: string;
  productName: string;
  quantity: number;
  trackingNumber?: string;
  useShipFromInventory?: boolean;
  skipApprove?: boolean;
};

export type LexiOutboundApprovePayload = {
  clientUserId: string;
  clientUserName: string;
  requestId: string;
  productName: string;
  quantity: number;
};

export type LexiRejectPayload = {
  clientUserId: string;
  clientUserName: string;
  requestId: string;
  productName: string;
  reason: string;
};

export type LexiOutboundJobPayload = {
  clientUserId: string;
  clientUserName: string;
  requestId: string;
  productName: string;
};

export type LexiOutboundDispatchPayload = {
  clientUserId: string;
  clientUserName: string;
  requestId: string;
  productName: string;
  trackingNumber?: string;
};

export type LexiRestockPayload = {
  clientUserId: string;
  clientUserName: string;
  productId: string;
  productName: string;
  quantity: number;
  remarks?: string;
};

export type LexiReviewPayload = {
  clientUserId: string;
  clientUserName: string;
  requestId: string;
  productName: string;
  decision: "approve" | "reject";
  reason?: string;
};

export type LexiDisposeReviewPayload = LexiReviewPayload & {
  batchId?: string;
  batchLineId?: string;
  productId?: string;
  quantity?: number;
};

export type LexiLabelReviewPayload = {
  clientUserId: string;
  clientUserName: string;
  requestId: string;
  kind: "refund" | "topup" | "api_fee";
  decision: "approve" | "reject";
  reason?: string;
};

export type LexiExecuteResult = {
  ok: boolean;
  message: string;
  data?: Record<string, unknown>;
};
