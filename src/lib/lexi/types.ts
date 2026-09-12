export type LexiActionType = "inbound_create" | "inbound_approve" | "inbound_complete";

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
  | LexiInboundCompletePayload;

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

export type LexiExecuteResult = {
  ok: boolean;
  message: string;
  data?: Record<string, unknown>;
};
