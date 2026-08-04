/**
 * User Requests page sorting: actionable rows (pending / approved-awaiting process)
 * stay at the top; once complete they fall back into requested-date order.
 */

export function firestoreDateMs(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value === "string") {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof value === "object") {
    const asAny = value as { seconds?: number; toMillis?: () => number };
    if (typeof asAny.toMillis === "function") {
      try {
        return asAny.toMillis();
      } catch {
        /* ignore */
      }
    }
    if (typeof asAny.seconds === "number") return asAny.seconds * 1000;
  }
  return 0;
}

export type QueueSortKey = {
  /** 0 = needs attention (top), 1 = settled (date order). */
  actionPriority: 0 | 1;
  dateMs: number;
};

/** Lower actionPriority first; within a tier, newest date first. */
export function compareQueueSortKeys(a: QueueSortKey, b: QueueSortKey): number {
  if (a.actionPriority !== b.actionPriority) {
    return a.actionPriority - b.actionPriority;
  }
  return b.dateMs - a.dateMs;
}

export function queueSortKey(input: {
  actionable: boolean;
  /** Prefer approvedAt so newly approved rows float to the very top. */
  actionDate?: unknown;
  requestDate?: unknown;
}): QueueSortKey {
  const requestMs = firestoreDateMs(input.requestDate);
  if (input.actionable) {
    const actionMs = firestoreDateMs(input.actionDate);
    return {
      actionPriority: 0,
      dateMs: actionMs || requestMs,
    };
  }
  return { actionPriority: 1, dateMs: requestMs };
}

export function isInventoryRequestActionable(req: {
  status?: string | null;
  fulfillmentStatus?: string | null;
}): boolean {
  const status = String(req.status ?? "").trim().toLowerCase();
  if (status === "pending") return true;
  if (status !== "approved") return false;
  // Warehouse Ops open inbound still needs receive/putaway.
  return String(req.fulfillmentStatus ?? "").trim().toLowerCase() === "open";
}

export function isInboundBatchActionable(batch: { status?: string | null }): boolean {
  const status = String(batch.status ?? "").trim().toLowerCase();
  return status === "pending" || status === "partial";
}

export function isShipmentRequestActionable(req: { status?: string | null }): boolean {
  const status = String(req.status ?? "").trim().toLowerCase();
  return status === "pending" || status === "awaiting_label_upload";
}

export function isDisposeRequestActionable(req: { status?: string | null }): boolean {
  return String(req.status ?? "").trim().toLowerCase() === "pending";
}

export function isDisposeBatchActionable(batch: { status?: string | null }): boolean {
  const status = String(batch.status ?? "").trim().toLowerCase();
  return status === "pending" || status === "partial";
}

export function isDeleteRequestActionable(req: { status?: string | null }): boolean {
  return String(req.status ?? "").trim().toLowerCase() === "pending";
}

export function isQuarantineRequestActionable(req: { status?: string | null }): boolean {
  const status = String(req.status ?? "").trim().toLowerCase();
  return status === "pending" || status === "approved";
}

export function isProductReturnActionable(req: { status?: string | null }): boolean {
  const status = String(req.status ?? "").trim().toLowerCase();
  return status === "pending" || status === "approved" || status === "in_progress";
}
