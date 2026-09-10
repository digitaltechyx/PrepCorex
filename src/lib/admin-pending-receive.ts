import type { InventoryRequest } from "@/types";
import {
  adminInboundRequestDisplayStatus,
  expectedApprovedInboundQty,
  warehouseGoodReceivedQty,
} from "@/lib/inventory-inbound-display";

export type PendingReceiveItem = {
  userId: string;
  requestId: string;
  productName: string;
  sku?: string;
  remainingQty: number;
  title: string;
  subtitle?: string;
  createdAtMs: number;
};

export function pendingReceiveRemainingQty(req: Pick<
  InventoryRequest,
  "receivedQuantity" | "requestedQuantity" | "quantity" | "warehouseGoodReceivedQty"
>): number {
  const expected = expectedApprovedInboundQty(req as InventoryRequest);
  const received = warehouseGoodReceivedQty(req as InventoryRequest);
  return Math.max(0, expected - received);
}

export function isPendingReceiveInventoryRequest(
  data: Pick<InventoryRequest, "status" | "fulfillmentStatus" | "inventoryType" | "inboundWorkflowVersion">
): boolean {
  return adminInboundRequestDisplayStatus(data) === "pending_receive";
}

export function pendingReceiveItemFromRequest(
  userId: string,
  requestId: string,
  data: InventoryRequest,
  createdAtMs: number
): PendingReceiveItem | null {
  if (!isPendingReceiveInventoryRequest(data)) return null;
  const remainingQty = pendingReceiveRemainingQty(data);
  if (remainingQty <= 0) return null;
  const productName = data.productName || data.newProductName || "Inventory Request";
  return {
    userId,
    requestId,
    productName,
    sku: data.sku ?? undefined,
    remainingQty,
    title: `Inventory Request • ${String(productName).substring(0, 50)}`,
    subtitle: `Qty: ${remainingQty} remaining`,
    createdAtMs,
  };
}
