import type { InventoryItem, InventoryRequest } from "@/types";

export type InboundTableDisplayStatus =
  | "Pending"
  | "Awaiting Receiving"
  | "Receiving"
  | "In Stock"
  | "Out of Stock"
  | "Rejected";

/** Admin Inventory Requests table status (recognition after approve vs receive). */
export type AdminInboundRequestDisplayStatus =
  | "pending"
  | "pending_receive"
  | "complete"
  | "rejected"
  | "cancelled";

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

/**
 * Admin-facing lifecycle for inbound requests.
 * - After approve (warehouse v2): pending_receive (status approved + fulfillment open)
 * - After receive complete / legacy fulfill: complete
 */
export function adminInboundRequestDisplayStatus(
  req: Pick<InventoryRequest, "status" | "fulfillmentStatus" | "inventoryType">
): AdminInboundRequestDisplayStatus {
  const status = String(req.status ?? "")
    .trim()
    .toLowerCase();
  if (status === "pending" || status === "pending_approval") return "pending";
  if (status === "rejected") return "rejected";
  if (status === "cancelled") return "cancelled";
  if (status === "approved") {
    const fulfillment = String(req.fulfillmentStatus ?? "")
      .trim()
      .toLowerCase();
    if (fulfillment === "open") return "pending_receive";
    return "complete";
  }
  return "complete";
}

export function adminInboundRequestStatusLabel(
  status: AdminInboundRequestDisplayStatus
): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "pending_receive":
      return "Pending receive";
    case "complete":
      return "Complete";
    case "rejected":
      return "Rejected";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
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
  // Approved records created before Warehouse Inbound v2 were completed
  // immediately by the admin workflow. They must never re-enter the Warehouse
  // Ops receiving queue, even when their old inventory row is now out of stock
  // or cannot be linked back by sourceRequestId.
  if (Number(req.inboundWorkflowVersion ?? 0) < 2) return false;

  if (!isOpenProductInboundRequest(req)) return false;

  if (req.inventoryType === "container") {
    return true;
  }

  const expected = expectedApprovedInboundQty(req);
  const good = warehouseGoodReceivedQty(req);
  const linked = inventory.some(
    (item) => String((item as InventoryItem & { sourceRequestId?: string }).sourceRequestId ?? "") === req.id
  );

  // Legacy admin approvals created inventory immediately and predate the
  // Warehouse Ops fulfillmentStatus field. Keep the real linked inventory row
  // (In Stock / Out of Stock) and hide the synthetic Awaiting Receiving row.
  if (req.fulfillmentStatus !== "open" && linked) return false;

  if (good >= expected && expected > 0 && linked) return false;
  return true;
}

export function formatInboundRequestRowQuantity(req: InventoryRequest): string {
  const expected = expectedApprovedInboundQty(req);
  const good = warehouseGoodReceivedQty(req);
  if (good <= 0) return `0/${expected}`;
  return `${good}/${expected}`;
}
