import { format } from "date-fns";
import type {
  DeleteLog,
  EditLog,
  InventoryItem,
  InventoryRequest,
  InventoryTransfer,
  RecycledInventoryItem,
  RestockHistory,
  ShippedItem,
} from "@/types";

export type InventoryHistoryEventType =
  | "created"
  | "inbound_request"
  | "received"
  | "restock"
  | "shipped"
  | "edited"
  | "deleted"
  | "disposed"
  | "transfer";

export interface InventoryHistoryRow {
  seq: number;
  timestamp: number;
  dateLabel: string;
  timeLabel: string;
  event: string;
  eventType: InventoryHistoryEventType;
  qtyBefore: number | null;
  qtyChange: number | null;
  qtyAfter: number | null;
  details: string;
  user: string;
}

export type InventoryHistorySources = {
  editLogs: EditLog[];
  deleteLogs: DeleteLog[];
  restockHistory: RestockHistory[];
  shipped: ShippedItem[];
  inventoryRequests: InventoryRequest[];
  inventoryTransfers: InventoryTransfer[];
  recycledInventory: RecycledInventoryItem[];
};

type RawEvent = {
  timestamp: number;
  event: string;
  eventType: InventoryHistoryEventType;
  qtyBefore?: number | null;
  qtyChange?: number | null;
  qtyAfter?: number | null;
  details: string;
  user: string;
};

function norm(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

function namesMatch(item: InventoryItem, name: string | undefined | null): boolean {
  if (!name?.trim()) return false;
  return norm(name) === norm(item.productName);
}

function skusMatch(item: InventoryItem, sku: string | undefined | null): boolean {
  if (!sku?.trim() || !item.sku?.trim()) return false;
  return norm(sku) === norm(item.sku);
}

export function toTimestamp(value: unknown): number {
  if (!value) return 0;
  if (typeof value === "string") {
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof value === "object" && value !== null && "seconds" in value) {
    const sec = Number((value as { seconds: number }).seconds);
    return Number.isFinite(sec) ? sec * 1000 : 0;
  }
  if (value instanceof Date) return value.getTime();
  return 0;
}

function formatLabels(ts: number): { dateLabel: string; timeLabel: string } {
  if (!ts) return { dateLabel: "—", timeLabel: "—" };
  const d = new Date(ts);
  return {
    dateLabel: format(d, "MMM d, yyyy"),
    timeLabel: format(d, "h:mm a"),
  };
}

function applyRunningBalances(events: RawEvent[]): InventoryHistoryRow[] {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  let running: number | null = null;
  const rows: InventoryHistoryRow[] = [];

  for (const e of sorted) {
    let qtyBefore = e.qtyBefore ?? null;
    let qtyAfter = e.qtyAfter ?? null;
    let qtyChange = e.qtyChange ?? null;

    if (qtyBefore != null && qtyAfter != null && qtyChange == null) {
      qtyChange = qtyAfter - qtyBefore;
    } else if (qtyBefore != null && qtyChange != null && qtyAfter == null) {
      qtyAfter = qtyBefore + qtyChange;
    } else if (qtyAfter != null && qtyChange != null && qtyBefore == null) {
      qtyBefore = qtyAfter - qtyChange;
    } else if (qtyChange != null && qtyBefore == null && qtyAfter == null && running != null) {
      qtyBefore = running;
      qtyAfter = running + qtyChange;
    } else if (qtyAfter != null && qtyBefore == null && qtyChange == null) {
      qtyChange = running != null ? qtyAfter - running : qtyAfter;
      qtyBefore = running;
    }

    if (qtyAfter != null) running = qtyAfter;
    else if (qtyBefore != null && qtyChange != null) running = qtyBefore + qtyChange;

    const { dateLabel, timeLabel } = formatLabels(e.timestamp);
    rows.push({
      seq: 0,
      timestamp: e.timestamp,
      dateLabel,
      timeLabel,
      event: e.event,
      eventType: e.eventType,
      qtyBefore,
      qtyChange,
      qtyAfter,
      details: e.details,
      user: e.user,
    });
  }

  return rows.map((r, i) => ({ ...r, seq: i + 1 }));
}

export function buildInventoryHistory(
  item: InventoryItem,
  sources: InventoryHistorySources,
  options?: { includeInternalEvents?: boolean }
): InventoryHistoryRow[] {
  const includeInternal = options?.includeInternalEvents === true;
  const raw: RawEvent[] = [];
  const sourceRequestId = (item as InventoryItem & { sourceRequestId?: string }).sourceRequestId;

  for (const req of sources.inventoryRequests) {
    const linked = sourceRequestId && req.id === sourceRequestId;
    const byName = namesMatch(item, req.productName) || skusMatch(item, req.sku);
    if (!linked && !byName) continue;

    const ts = toTimestamp(req.approvedAt ?? req.rejectedAt ?? req.requestedAt ?? req.addDate);
    const qty = req.receivedQuantity ?? req.quantity ?? 0;

    if (req.status === "approved") {
      raw.push({
        timestamp: ts,
        event: "Inbound approved",
        eventType: "received",
        qtyChange: qty > 0 ? qty : null,
        qtyAfter: req.receivedQuantity ?? null,
        details: [
          req.inventoryType ? `Type: ${req.inventoryType}` : "",
          req.remarks?.trim() ? `Remarks: ${req.remarks.trim()}` : "",
        ]
          .filter(Boolean)
          .join(" · "),
        user: req.approvedBy ?? "Admin",
      });
    } else if (req.status === "pending") {
      raw.push({
        timestamp: toTimestamp(req.requestedAt ?? req.addDate),
        event: "Inbound requested",
        eventType: "inbound_request",
        details: `Requested ${req.requestedQuantity ?? req.quantity} units · ${req.inventoryType ?? "product"}`,
        user: req.requestedBy ?? "Client",
      });
    } else if (req.status === "rejected") {
      raw.push({
        timestamp: ts,
        event: "Inbound rejected",
        eventType: "inbound_request",
        details: req.rejectionReason?.trim() || "Request rejected",
        user: req.rejectedBy ?? "Admin",
      });
    }
  }

  const addedTs = toTimestamp(item.dateAdded);
  const hasReceived = raw.some((e) => e.eventType === "received");
  if (!hasReceived && addedTs > 0) {
    raw.push({
      timestamp: addedTs,
      event: "Added to inventory",
      eventType: "created",
      qtyAfter: item.quantity,
      qtyChange: item.quantity,
      details: item.source ? `Source: ${item.source}` : "Initial stock record",
      user: "System",
    });
  }

  for (const r of sources.restockHistory) {
    if (!namesMatch(item, r.productName)) continue;
    raw.push({
      timestamp: toTimestamp(r.restockedAt),
      event: "Restock",
      eventType: "restock",
      qtyBefore: r.previousQuantity,
      qtyAfter: r.newQuantity,
      qtyChange: r.restockedQuantity,
      details: r.remarks?.trim() || `+${r.restockedQuantity} units`,
      user: r.restockedBy,
    });
  }

  for (const e of sources.editLogs) {
    if (!namesMatch(item, e.productName) && !namesMatch(item, e.previousProductName)) continue;
    raw.push({
      timestamp: toTimestamp(e.editedAt),
      event: "Quantity / status edit",
      eventType: "edited",
      qtyBefore: e.previousQuantity,
      qtyAfter: e.newQuantity,
      details: [
        e.reason?.trim() ? e.reason.trim() : "",
        e.previousStatus !== e.newStatus
          ? `Status: ${e.previousStatus} → ${e.newStatus}`
          : "",
        e.previousProductName && e.previousProductName !== e.productName
          ? `Renamed from "${e.previousProductName}"`
          : "",
      ]
        .filter(Boolean)
        .join(" · "),
      user: e.editedBy,
    });
  }

  for (const s of sources.shipped) {
    const lines: Array<{ name: string; qty: number; packOf?: number }> = [];
    if (s.items?.length) {
      for (const line of s.items) {
        if (!namesMatch(item, line.productName)) continue;
        const qty = line.shippedQty ?? line.boxesShipped ?? 0;
        if (qty > 0) lines.push({ name: line.productName, qty, packOf: line.packOf });
      }
    } else if (namesMatch(item, s.productName)) {
      const qty = s.shippedQty ?? s.boxesShipped ?? s.totalUnits ?? 0;
      if (qty > 0) lines.push({ name: s.productName!, qty });
    }

    for (const line of lines) {
      const ts = toTimestamp(s.date ?? s.createdAt);
      raw.push({
        timestamp: ts,
        event: "Shipped",
        eventType: "shipped",
        qtyChange: -line.qty,
        details: [
          s.shipTo ? `Ship to: ${s.shipTo}` : "",
          s.service ? `Service: ${s.service}` : "",
          line.packOf ? `Pack of ${line.packOf}` : "",
          s.remarks?.trim() ? s.remarks.trim() : "",
        ]
          .filter(Boolean)
          .join(" · "),
        user: "Fulfillment",
      });
    }
  }

  if (includeInternal) {
    for (const t of sources.inventoryTransfers) {
      if (t.inventoryId !== item.id && !namesMatch(item, t.productName)) continue;
      raw.push({
        timestamp: toTimestamp(t.movedAt),
        event: "Internal transfer",
        eventType: "transfer",
        qtyChange: -t.quantity,
        details: [
          t.fromLocationName || t.fromLocationId
            ? `From: ${t.fromLocationName ?? t.fromLocationId}`
            : "",
          t.toLocationName || t.toLocationId
            ? `To: ${t.toLocationName ?? t.toLocationId}`
            : "",
          t.reason?.trim() ? t.reason.trim() : "",
        ]
          .filter(Boolean)
          .join(" · "),
        user: t.movedBy ?? "Admin",
      });
    }
  }

  for (const d of sources.deleteLogs) {
    if (!namesMatch(item, d.productName)) continue;
    raw.push({
      timestamp: toTimestamp(d.deletedAt),
      event: "Deleted",
      eventType: "deleted",
      qtyBefore: d.quantity,
      qtyAfter: 0,
      qtyChange: -d.quantity,
      details: d.reason?.trim() || `Was ${d.status}`,
      user: d.deletedBy,
    });
  }

  for (const r of sources.recycledInventory) {
    if (!namesMatch(item, r.productName)) continue;
    raw.push({
      timestamp: toTimestamp(r.recycledAt),
      event: "Disposed / recycled",
      eventType: "disposed",
      qtyBefore: r.quantity,
      qtyAfter: 0,
      qtyChange: -r.quantity,
      details: r.remarks?.trim() || "Removed from active inventory",
      user: r.recycledBy,
    });
  }

  if (raw.length === 0 && item.quantity != null) {
    raw.push({
      timestamp: addedTs || Date.now(),
      event: "Current stock",
      eventType: "created",
      qtyAfter: item.quantity,
      details: "No historical events found — showing current quantity only.",
      user: "—",
    });
  }

  return applyRunningBalances(raw);
}

export function formatQtyCell(n: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  return String(n);
}

export function formatChangeCell(n: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (n > 0) return `+${n}`;
  return String(n);
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function inventoryHistoryToCsv(
  item: InventoryItem,
  rows: InventoryHistoryRow[],
  ownerLabel?: string
): string {
  const header = [
    "Sequence",
    "Date",
    "Time",
    "Event",
    "Qty Before",
    "Change",
    "Qty After",
    "Details",
    "User",
    "Product",
    "SKU",
    "Account",
  ];
  const lines = [
    header.join(","),
    ...rows.map((r) =>
      [
        r.seq,
        r.dateLabel,
        r.timeLabel,
        r.event,
        formatQtyCell(r.qtyBefore),
        formatChangeCell(r.qtyChange),
        formatQtyCell(r.qtyAfter),
        r.details,
        r.user,
        item.productName,
        item.sku ?? "",
        ownerLabel ?? "",
      ]
        .map((c) => csvEscape(String(c ?? "")))
        .join(",")
    ),
  ];
  if (item.quantity != null) {
    lines.push(
      [
        rows.length + 1,
        format(new Date(), "MMM d, yyyy"),
        format(new Date(), "h:mm a"),
        "Current on hand",
        "",
        "",
        item.quantity,
        "As of export",
        "",
        item.productName,
        item.sku ?? "",
        ownerLabel ?? "",
      ]
        .map((c) => csvEscape(String(c)))
        .join(",")
    );
  }
  return lines.join("\r\n");
}

export function downloadInventoryHistoryCsv(
  item: InventoryItem,
  rows: InventoryHistoryRow[],
  ownerLabel?: string
): void {
  const csv = inventoryHistoryToCsv(item, rows, ownerLabel);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const slug = (item.sku || item.productName)
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const a = document.createElement("a");
  a.href = url;
  a.download = `inventory-history-${slug || "product"}-${format(new Date(), "yyyy-MM-dd")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
