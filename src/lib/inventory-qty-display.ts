/** Inbound request / inventory row quantity display (received vs requested). */

export type InboundQtyFields = {
  quantity?: number;
  requestedQuantity?: number;
  receivedQuantity?: number;
  isRequest?: boolean;
  status?: string;
};

export function getRequestedQuantity(fields: InboundQtyFields): number {
  const n = fields.requestedQuantity ?? fields.quantity ?? 0;
  return Number.isFinite(n) ? n : 0;
}

export function getReceivedQuantity(fields: InboundQtyFields): number | null {
  const n = fields.receivedQuantity;
  if (n == null || !Number.isFinite(n)) return null;
  return n;
}

/** Pending: single number. After approve: `received/requested` (e.g. 9/10). */
export function formatInboundQuantityDisplay(fields: InboundQtyFields): string {
  const requested = getRequestedQuantity(fields);
  const status = (fields.status || "").toLowerCase();

  if (fields.isRequest || status === "pending") {
    return String(requested);
  }

  if (status === "rejected") {
    return String(requested);
  }

  const received = getReceivedQuantity(fields);
  if (received != null && status === "approved") {
    return `${received}/${requested}`;
  }

  if (received != null) {
    return `${received}/${requested}`;
  }

  return String(fields.quantity ?? requested);
}
