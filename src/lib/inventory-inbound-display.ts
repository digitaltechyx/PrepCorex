import type { InventoryItem, InventoryRequest } from "@/types";

export type InboundTableDisplayStatus =
  | "Pending"
  | "Awaiting Receiving"
  | "Receiving"
  | "In Stock"
  | "Out of Stock"
  | "Rejected";

export function expectedApprovedInboundQty(req: InventoryRequest): number {
  if (typeof req.receivedQuantity === "number" && req.receivedQuantity > 0) {
    return req.receivedQuantity;
  }
  if (typeof req.requestedQuantity === "number" && req.requestedQuantity > 0) {
    return req.requestedQuantity;
  }
  return Math.max(0, req.quantity ?? 0);
}

export function warehouseGoodReceivedQty(req: InventoryRequest): number {
  return Math.max(0, Number(req.warehouseGoodReceivedQty ?? 0));
}

/** Product or container inbound still visible until warehouse fully receives / closes it. */
export function isOpenProductInboundRequest(req: InventoryRequest): boolean {
  if (req.status !== "approved") return false;
  if (req.inventoryType !== "product" && req.inventoryType !== "container") return false;
  if (req.fulfillmentStatus === "closed") return false;
  return true;
}

export function inboundRequestDisplayStatus(req: InventoryRequest): InboundTableDisplayStatus {
  const good = warehouseGoodReceivedQty(req);
  const expected = expectedApprovedInboundQty(req);
  if (good > 0 && good < expected) return "Receiving";
  return "Awaiting Receiving";
}

/** Hide request row once warehouse good qty meets approved expectation and inventory exists.
 *  Container handling rows hide once closed (products from inside show as normal inventory). */
export function shouldShowApprovedInboundRequestRow(
  req: InventoryRequest,
  inventory: InventoryItem[]
): boolean {
  if (!isOpenProductInboundRequest(req)) return false;

  if (req.inventoryType === "container") {
    return true;
  }

  const expected = expectedApprovedInboundQty(req);
  const good = warehouseGoodReceivedQty(req);
  const linked = inventory.some(
    (item) => String((item as InventoryItem & { sourceRequestId?: string }).sourceRequestId ?? "") === req.id
  );

  if (good >= expected && expected > 0 && linked) return false;
  return true;
}

export function formatInboundRequestRowQuantity(req: InventoryRequest): string {
  const expected = expectedApprovedInboundQty(req);
  const good = warehouseGoodReceivedQty(req);
  if (good <= 0) return `0/${expected}`;
  return `${good}/${expected}`;
}
