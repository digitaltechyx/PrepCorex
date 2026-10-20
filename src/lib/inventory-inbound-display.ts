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

/** Hide request row once linked inventory exists (partial or full) so the table
 *  keeps one product line. Container handling rows stay visible until closed. */
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

  const linked = inventory.some(
    (item) =>
      String((item as InventoryItem & { sourceRequestId?: string }).sourceRequestId ?? "") ===
      req.id
  );

  // Once putaway created/linked stock, show only the inventory row (with 40/100 progress).
  if (linked) return false;

  return true;
}

/** Compact one-line qty for inventory table: `40/100` (received/requested). */
export function formatInboundRequestRowQuantity(req: InventoryRequest): string {
  const expected = expectedApprovedInboundQty(req);
  const good = warehouseGoodReceivedQty(req);
  return `${good}/${expected}`;
}

/**
 * Admin Inbound Requests table / detail: putaway counter vs requested.
 * Do not use approved `receivedQuantity` (that is the expected approve amount, often = requested).
 */
export function formatAdminInboundRequestQuantity(req: InventoryRequest): string {
  const expected = expectedApprovedInboundQty(req);
  const status = String(req.status ?? "")
    .trim()
    .toLowerCase();
  if (status === "pending" || status === "pending_approval" || status === "rejected") {
    return String(expected);
  }

  const usesWarehouseReceive =
    Number(req.inboundWorkflowVersion ?? 0) >= 2 ||
    req.fulfillmentStatus === "open" ||
    req.fulfillmentStatus === "closed" ||
    typeof req.warehouseGoodReceivedQty === "number";

  if (usesWarehouseReceive && status === "approved") {
    return `${warehouseGoodReceivedQty(req)}/${expected}`;
  }

  // Legacy admin-fulfilled approve path.
  const approvedReceived =
    typeof req.receivedQuantity === "number" && req.receivedQuantity > 0
      ? req.receivedQuantity
      : null;
  if (approvedReceived != null) return `${approvedReceived}/${expected}`;
  return String(expected);
}

/** Received progress + sellable on-hand for an open inbound linked to inventory. */
export function openInboundQuantityParts(
  req: InventoryRequest,
  inventoryQuantity: number
): { received: number; expected: number; available: number } {
  const expected = expectedApprovedInboundQty(req);
  const recorded = warehouseGoodReceivedQty(req);
  const available = Math.max(0, Math.floor(Number(inventoryQuantity) || 0));
  // Prefer putaway counter; fall back to on-hand when counter not set yet.
  // Cap legacy dock+putaway double-count when recorded is clearly above on-hand
  // (≈2×) — do not clamp to expected so over-receive (e.g. 120/100) still shows.
  let received = recorded > 0 ? recorded : available;
  if (recorded > available && available > 0 && recorded >= available * 2) {
    received = available;
  }
  return { received: Math.max(0, received), expected, available };
}

/**
 * Compact progress string `40/100` (received/requested) for open inbound inventory rows.
 */
export function formatOpenInboundInventoryQuantity(
  req: InventoryRequest,
  inventoryQuantity: number
): string {
  const { received, expected } = openInboundQuantityParts(req, inventoryQuantity);
  return `${received}/${expected}`;
}
