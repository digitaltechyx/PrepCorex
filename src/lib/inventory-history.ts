import { format } from "date-fns";
import type {
  DeleteLog,
  EditLog,
  InboundReceiveLog,
  InventoryChangeLog,
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
  /** Present for outbound reserve/restore/dispatch change-log rows. */
  shipmentRequestId?: string | null;
}

export type InventoryHistorySources = {
  editLogs: EditLog[];
  deleteLogs: DeleteLog[];
  restockHistory: RestockHistory[];
  shipped: ShippedItem[];
  inventoryRequests: InventoryRequest[];
  inventoryTransfers: InventoryTransfer[];
  recycledInventory: RecycledInventoryItem[];
  inventoryChangeLogs?: InventoryChangeLog[];
  /** Used to resolve pack/boxes for awaiting-ship logs that predate pack fields. */
  shipmentRequests?: Array<{
    id: string;
    shipments?: Array<{
      productId?: string;
      productName?: string;
      quantity?: number;
      packOf?: number;
    }>;
  }>;
};

export type StockOutSummary = {
  timestamp: number;
  event: string;
  qtyBefore: number | null;
  qtyChange: number | null;
  qtyAfter: number | null;
  details: string;
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
  /** Links reserve / restore / dispatch rows for the same outbound request. */
  shipmentRequestId?: string | null;
  /**
   * reserve = awaiting-ship (defines Line #);
   * restore / dispatch share that Line # when request ids match.
   */
  outboundLinkKind?: "reserve" | "restore" | "dispatch" | null;
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

/** Firebase Auth UIDs are opaque IDs — never show them in the By column. */
function isLikelyAuthUid(value: string): boolean {
  return /^[A-Za-z0-9]{20,36}$/.test(value.trim());
}

function formatHistoryBy(user: string, event: string): string {
  const v = (user ?? "").trim();
  if (!v || v === "—") return v || "—";
  if (!isLikelyAuthUid(v)) return v;
  if (event === "Inbound requested") return "Client";
  return "PSF Operations";
}

function isPackDetailsChangeLog(log: InventoryChangeLog): boolean {
  if (log.eventType === "outbound_line_pack_updated") return true;
  const change = Number(log.qtyChange);
  const before = Number(log.qtyBefore);
  const after = Number(log.qtyAfter);
  if (!Number.isFinite(change) || change !== 0) return false;
  if (!Number.isFinite(before) || !Number.isFinite(after) || before !== after) return false;
  const d = String(log.details ?? "").toLowerCase();
  return (
    d.includes("repacked") ||
    d.includes("pack details") ||
    (d.includes("was ") && d.includes(" now ")) ||
    (d.includes("pack of") && Boolean(String(log.shipmentRequestId ?? "").trim()))
  );
}

/** Outbound Details column: "qty 4 pack of 12" plus request id when present. */
function formatOutboundShipmentDetails(input: {
  units?: number | null;
  packOf?: number | null;
  boxesShipped?: number | null;
  fallbackText?: string | null;
  shipmentRequestId?: string | null;
  /** Optional cancel reason for restore rows. */
  cancelReason?: string | null;
}): string {
  const packOfRaw = Number(input.packOf);
  const boxesRaw = Number(input.boxesShipped);
  const unitsRaw = Math.abs(Number(input.units) || 0);

  const packOf =
    Number.isFinite(packOfRaw) && packOfRaw > 0 ? Math.floor(packOfRaw) : null;
  const boxesShipped =
    Number.isFinite(boxesRaw) && boxesRaw > 0 ? Math.floor(boxesRaw) : null;

  let base = "";
  if (packOf != null && boxesShipped != null) {
    base = `qty ${boxesShipped} pack of ${packOf}`;
  } else if (packOf != null && unitsRaw > 0) {
    const packCount = Math.max(1, Math.round(unitsRaw / packOf));
    base = `qty ${packCount} pack of ${packOf}`;
  } else if (boxesShipped != null) {
    base = `qty ${boxesShipped} pack of 1`;
  } else if (unitsRaw > 0) {
    base = `qty ${unitsRaw} pack of 1`;
  } else {
    base = String(input.fallbackText ?? "").trim();
  }

  const parts: string[] = [];
  if (base) parts.push(base);

  const requestId = String(input.shipmentRequestId ?? "").trim();
  if (requestId) {
    // Same id on awaiting-ship and cancel-restore so identical qtys can be matched.
    parts.push(`Request ${requestId}`);
  }

  const reason = String(input.cancelReason ?? "").trim();
  if (reason) {
    parts.push(reason.toLowerCase().startsWith("reason:") ? reason : `Reason: ${reason}`);
  }

  return parts.length > 0 ? parts.join(" · ") : "—";
}

function cancelReasonFromChangeLogDetails(details: string | null | undefined): string | null {
  const text = String(details ?? "");
  const match = text.match(/(?:^|·)\s*Reason:\s*([^·]+)/i);
  const reason = match?.[1]?.trim();
  return reason || null;
}

function parsePackOfFromText(text: string | null | undefined): number | null {
  const m = String(text ?? "").match(/pack\s*of\s*(\d+)/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function findPackFromShipmentRequest(
  sources: InventoryHistorySources,
  log: InventoryChangeLog,
  item: InventoryItem
): { packOf?: number; boxesShipped?: number } | null {
  const requestId = String(log.shipmentRequestId ?? "").trim();
  if (!requestId) return null;
  const req = (sources.shipmentRequests ?? []).find((r) => r.id === requestId);
  if (!req?.shipments?.length) return null;

  for (const shipment of req.shipments) {
    const productId = String(shipment.productId ?? "").trim();
    if (productId && productId === item.id) {
      const packOf = Math.max(1, Math.floor(Number(shipment.packOf) || 1));
      const boxesShipped = Math.max(0, Math.floor(Number(shipment.quantity) || 0));
      return { packOf, boxesShipped: boxesShipped || undefined };
    }
  }
  for (const shipment of req.shipments) {
    if (!namesMatch(item, shipment.productName)) continue;
    const packOf = Math.max(1, Math.floor(Number(shipment.packOf) || 1));
    const boxesShipped = Math.max(0, Math.floor(Number(shipment.quantity) || 0));
    return { packOf, boxesShipped: boxesShipped || undefined };
  }
  return null;
}

function findShippedLineForChangeLog(
  shipped: ShippedItem[],
  log: InventoryChangeLog,
  item: InventoryItem
): { units: number; packOf?: number; boxesShipped?: number } | null {
  const shippedId = log.shippedId != null ? String(log.shippedId).trim() : "";
  if (!shippedId) return null;
  const record = shipped.find((s) => s.id === shippedId);
  if (!record) return null;

  if (record.items?.length) {
    const line =
      record.items.find((l) => namesMatch(item, l.productName)) ||
      record.items.find((l) => namesMatch({ productName: log.productName } as InventoryItem, l.productName));
    if (!line) return null;
    return {
      units: line.shippedQty ?? Math.abs(log.qtyChange) ?? 0,
      packOf: line.packOf,
      boxesShipped: line.boxesShipped,
    };
  }

  if (namesMatch(item, record.productName) || namesMatch(item, log.productName)) {
    return {
      units: record.shippedQty ?? record.totalUnits ?? Math.abs(log.qtyChange) ?? 0,
      packOf: record.packOf,
      boxesShipped: record.boxesShipped ?? record.totalBoxes,
    };
  }
  return null;
}

function appendHistoryLineNumber(details: string, line: number): string {
  const text = String(details ?? "").trim();
  const label = `Line #${line}`;
  if (!text || text === "—") return label;
  if (text.includes(label)) return text;
  // Put Line # right after qty so it is easy to scan next to the history # column.
  const qtyMatch = text.match(/^(qty\s+\d+\s+pack\s+of\s+\d+)/i);
  if (qtyMatch) {
    const rest = text.slice(qtyMatch[1].length).replace(/^\s*·\s*/, "");
    return rest ? `${qtyMatch[1]} · ${label} · ${rest}` : `${qtyMatch[1]} · ${label}`;
  }
  return `${label} · ${text}`;
}

function applyRunningBalances(events: RawEvent[]): InventoryHistoryRow[] {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  let running: number | null = null;
  const rows: Array<InventoryHistoryRow & { outboundLinkKind?: RawEvent["outboundLinkKind"] }> =
    [];

  for (const e of sorted) {
    let qtyBefore = e.qtyBefore ?? null;
    let qtyAfter = e.qtyAfter ?? null;
    let qtyChange = e.qtyChange ?? null;

    if (qtyBefore != null && qtyAfter != null && qtyChange == null) {
      qtyChange = qtyAfter - qtyBefore;
    } else if (qtyBefore != null && qtyChange != null && qtyAfter == null) {
      qtyAfter = qtyBefore + qtyChange;
    } else if (qtyAfter != null && qtyChange != null && qtyBefore == null) {
      // Prefer continuous running stock when the event only has a delta-shaped after
      // (legacy inbound set qtyAfter = received units, not on-hand total).
      if (running != null && qtyChange !== 0 && qtyAfter === qtyChange) {
        qtyBefore = running;
        qtyAfter = running + qtyChange;
      } else {
        qtyBefore = qtyAfter - qtyChange;
      }
    } else if (qtyChange != null && qtyBefore == null && qtyAfter == null) {
      qtyBefore = running != null ? running : 0;
      qtyAfter = qtyBefore + qtyChange;
    } else if (qtyAfter != null && qtyBefore == null && qtyChange == null) {
      qtyChange = running != null ? qtyAfter - running : qtyAfter;
      qtyBefore = running != null ? running : 0;
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
      user: formatHistoryBy(e.user, e.event),
      shipmentRequestId: e.shipmentRequestId ?? null,
      outboundLinkKind: e.outboundLinkKind ?? null,
    });
  }

  const withSeq = rows.map((r, i) => ({ ...r, seq: i + 1 }));

  // Line # = history sequence of the first awaiting-ship row for that request id.
  const lineByRequest = new Map<string, number>();
  for (const r of withSeq) {
    const id = String(r.shipmentRequestId ?? "").trim();
    if (!id || r.outboundLinkKind !== "reserve") continue;
    if (!lineByRequest.has(id)) lineByRequest.set(id, r.seq);
  }

  return withSeq.map(({ outboundLinkKind, ...r }) => {
    const id = String(r.shipmentRequestId ?? "").trim();
    if (!id || !outboundLinkKind) return r;
    const line = lineByRequest.get(id) ?? (outboundLinkKind === "reserve" ? r.seq : null);
    if (line == null) return r;
    return {
      ...r,
      details: appendHistoryLineNumber(r.details, line),
    };
  });
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
    const byProductId = Boolean(req.productId && req.productId === item.id);
    const byName = namesMatch(item, req.productName) || skusMatch(item, req.sku);
    if (!linked && !byName && !byProductId) continue;

    const ts = toTimestamp(req.approvedAt ?? req.rejectedAt ?? req.requestedAt ?? req.addDate);
    const qty = req.receivedQuantity ?? req.quantity ?? 0;

    if (req.status === "approved") {
      const isRestock = req.productSubType === "restock";
      raw.push({
        timestamp: ts,
        // receivedQuantity is units added this receive — not the on-hand total.
        // Leave qtyAfter unset so applyRunningBalances keeps a continuous stock line.
        event: isRestock ? "Restock" : "Inbound approved",
        eventType: isRestock ? "restock" : "received",
        qtyChange: qty > 0 ? qty : null,
        details: [
          req.inventoryType ? `Type: ${req.inventoryType}` : "",
          isRestock ? "Inbound restock" : "",
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

  for (const log of sources.inventoryChangeLogs ?? []) {
    if (log.inventoryId !== item.id && !skusMatch(item, log.sku) && !namesMatch(item, log.productName)) {
      continue;
    }
    const packDetailsChange = isPackDetailsChangeLog(log);

    const eventLabel = packDetailsChange
      ? "Pack details change"
      : log.eventType === "outbound_awaiting_ship"
        ? "Outbound awaiting ship"
        : log.eventType === "outbound_restored"
          ? "Outbound cancelled — restored"
          : log.eventType === "outbound_line_restored"
            ? "Outbound line edited — restored"
            : log.eventType === "outbound_line_reserved"
              ? "Outbound line edited — additional reserve"
              : log.eventType === "outbound_dispatch"
                ? "Outbound dispatched"
                : log.eventType === "outbound_shipped"
                  ? "Outbound shipped"
                  : log.eventType === "dispose"
                    ? "Disposed"
                    : log.eventType === "shopify_quick_fulfill" ||
                        log.eventType === "shopify_qf_product_correct_credit" ||
                        log.eventType === "shopify_qf_product_correct_debit"
                      ? "Shopify quick fulfill"
                      : log.eventType === "ebay_quick_fulfill"
                        ? "eBay quick fulfill"
                        : Number(log.qtyChange) === 0 &&
                            Number.isFinite(Number(log.qtyBefore)) &&
                            Number(log.qtyBefore) === Number(log.qtyAfter)
                          ? "Pack details change"
                          : "Stock removed";

    const shippedLine = findShippedLineForChangeLog(sources.shipped, log, item);
    const requestPack = findPackFromShipmentRequest(sources, log, item);
    const packOf =
      (log.packOf != null && Number(log.packOf) > 0 ? Math.floor(Number(log.packOf)) : null) ??
      shippedLine?.packOf ??
      requestPack?.packOf ??
      parsePackOfFromText(log.details) ??
      parsePackOfFromText(log.shipTo);
    const boxesShipped =
      (log.boxesShipped != null && Number(log.boxesShipped) > 0
        ? Math.floor(Number(log.boxesShipped))
        : null) ??
      shippedLine?.boxesShipped ??
      requestPack?.boxesShipped ??
      null;
    const details = (() => {
      if (packDetailsChange) {
        const stored = String(log.details ?? "").trim();
        if (stored) return stored;
      }
      const isShopifyQf =
        log.eventType === "shopify_quick_fulfill" ||
        log.eventType === "shopify_qf_product_correct_credit" ||
        log.eventType === "shopify_qf_product_correct_debit";
      if (isShopifyQf) {
        const stored = String(log.details ?? "").trim();
        const orderName = String(
          (log as InventoryChangeLog & { shopifyOrderName?: string | null }).shopifyOrderName ?? ""
        ).trim();
        if (stored) return stored;
        if (orderName) return `Shopify quick fulfill · ${orderName}`;
      }
      return formatOutboundShipmentDetails({
        units: shippedLine?.units ?? Math.abs(log.qtyChange),
        packOf,
        boxesShipped,
        fallbackText: log.details,
        shipmentRequestId: log.shipmentRequestId,
        cancelReason:
          log.eventType === "outbound_restored" ||
          log.eventType === "outbound_line_restored" ||
          log.eventType === "outbound_line_reserved"
            ? cancelReasonFromChangeLogDetails(log.details)
            : null,
      });
    })();

    const isPackLayoutOnly = packDetailsChange;

    // Restored stock shows as inbound-style increase; awaiting/dispatch stay on outbound tab.
    const historyEventType =
      log.eventType === "outbound_restored" ||
      log.eventType === "outbound_line_restored" ||
      log.eventType === "shopify_qf_product_correct_credit"
        ? ("restock" as const)
        : ("shipped" as const);

    raw.push({
      timestamp: toTimestamp(log.at),
      event: eventLabel,
      eventType: historyEventType,
      qtyBefore: isPackLayoutOnly ? null : log.qtyBefore,
      qtyAfter: isPackLayoutOnly ? null : log.qtyAfter,
      qtyChange: isPackLayoutOnly ? null : log.qtyChange,
      details,
      user: "Fulfillment",
      shipmentRequestId: log.shipmentRequestId ?? null,
      outboundLinkKind:
        log.eventType === "outbound_awaiting_ship" || log.eventType === "outbound_line_reserved"
          ? "reserve"
          : log.eventType === "outbound_restored" || log.eventType === "outbound_line_restored"
            ? "restore"
            : log.eventType === "outbound_dispatch" || log.eventType === "outbound_shipped"
              ? "dispatch"
              : null,
    });
  }

  const shippedIdsFromChangeLogs = new Set(
    (sources.inventoryChangeLogs ?? [])
      .map((log) => (log.shippedId != null ? String(log.shippedId).trim() : ""))
      .filter(Boolean)
  );

  for (const s of sources.shipped) {
    // Avoid double-counting when inventoryChangeLogs already recorded this shipment.
    if (s.id && shippedIdsFromChangeLogs.has(s.id)) continue;
    if ((s as ShippedItem & { quickFulfill?: boolean }).quickFulfill === true) continue;
    const lines: Array<{ name: string; qty: number; packOf?: number; boxesShipped?: number }> = [];
    if (s.items?.length) {
      for (const line of s.items) {
        if (!namesMatch(item, line.productName)) continue;
        const qty = line.shippedQty ?? line.boxesShipped ?? 0;
        if (qty > 0) {
          lines.push({
            name: line.productName,
            qty,
            packOf: line.packOf,
            boxesShipped: line.boxesShipped,
          });
        }
      }
    } else if (namesMatch(item, s.productName)) {
      const qty = s.shippedQty ?? s.boxesShipped ?? s.totalUnits ?? 0;
      if (qty > 0) {
        lines.push({
          name: s.productName!,
          qty,
          packOf: s.packOf,
          boxesShipped: s.boxesShipped ?? s.totalBoxes,
        });
      }
    }

    for (const line of lines) {
      const ts = toTimestamp(s.date ?? s.createdAt);
      raw.push({
        timestamp: ts,
        event: "Shipped",
        eventType: "shipped",
        qtyChange: -line.qty,
        details: formatOutboundShipmentDetails({
          units: line.qty,
          packOf: line.packOf,
          boxesShipped: line.boxesShipped,
        }),
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
    "Action (+/-)",
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

/** Inbound putaway logs linked to this inventory row (SKU, request, or id). */
export function inboundReceiveLogsForItem(
  item: InventoryItem,
  logs: InboundReceiveLog[]
): InboundReceiveLog[] {
  const sourceRequestId = (item as InventoryItem & { sourceRequestId?: string }).sourceRequestId;
  return logs
    .filter((log) => {
      if (log.inventoryId === item.id) return true;
      if (sourceRequestId && log.inventoryRequestId === sourceRequestId) return true;
      if (skusMatch(item, log.sku)) return true;
      return namesMatch(item, log.productName);
    })
    .sort((a, b) => toTimestamp(b.putawayAt) - toTimestamp(a.putawayAt));
}

/** One display row per receive session (good + damaged putaway merged). */
export type MergedInboundReceiveRow = {
  id: string;
  eventType: "initial" | "restock";
  putawayAtMs: number;
  totalReceived: number;
  goodQty: number;
  damagedQty: number;
  goodBinPath: string | null;
  damagedLocation: string | null;
  remarks: string | null;
  photoUrls: string[];
  sourceLogIds: string[];
};

function inboundMergeKey(log: InboundReceiveLog): string {
  // 2-minute window so good + damaged putaways from one receive land together
  const window = Math.floor(toTimestamp(log.putawayAt) / 120_000);
  const eventType = log.eventType === "restock" ? "restock" : "initial";
  const req = (log.inventoryRequestId ?? "").trim();
  if (req) return `req:${req}|${eventType}|${window}`;
  const carton = (log.cartonId ?? "").trim();
  if (carton) return `carton:${carton}|${eventType}|${window}`;
  // Logs are already filtered to one product — same window = one operation
  const sku = (log.sku ?? "").trim().toLowerCase();
  const name = (log.productName ?? "").trim().toLowerCase();
  const inv = (log.inventoryId ?? "").trim();
  return `item:${inv || sku || name}|${eventType}|${window}`;
}

function areComplementaryInboundLogs(a: InboundReceiveLog, b: InboundReceiveLog): boolean {
  const aGood = Math.max(0, Number(a.goodQty) || 0);
  const aDamaged = Math.max(0, Number(a.damagedQty) || 0);
  const bGood = Math.max(0, Number(b.goodQty) || 0);
  const bDamaged = Math.max(0, Number(b.damagedQty) || 0);
  const aOnlyDamaged = aDamaged > 0 && aGood === 0;
  const aOnlyGood = aGood > 0 && aDamaged === 0;
  const bOnlyDamaged = bDamaged > 0 && bGood === 0;
  const bOnlyGood = bGood > 0 && bDamaged === 0;
  return (aOnlyGood && bOnlyDamaged) || (aOnlyDamaged && bOnlyGood);
}

/** Merge separate good/damaged putaway docs from the same receive into one row. */
export function mergeInboundReceiveLogs(logs: InboundReceiveLog[]): MergedInboundReceiveRow[] {
  const groups = new Map<string, InboundReceiveLog[]>();
  for (const log of logs) {
    const key = inboundMergeKey(log);
    const list = groups.get(key) ?? [];
    list.push(log);
    groups.set(key, list);
  }

  // Second pass: if request/carton keys still split a good-only + damaged-only pair
  // at the same time, fold them together (common when lineIds differ).
  let groupList = [...groups.values()];
  const used = new Set<number>();
  const folded: InboundReceiveLog[][] = [];
  for (let i = 0; i < groupList.length; i++) {
    if (used.has(i)) continue;
    let combined = [...groupList[i]];
    const eventType = combined[0]?.eventType === "restock" ? "restock" : "initial";
    const ts = Math.max(...combined.map((l) => toTimestamp(l.putawayAt)));
    for (let j = i + 1; j < groupList.length; j++) {
      if (used.has(j)) continue;
      const other = groupList[j];
      const otherType = other[0]?.eventType === "restock" ? "restock" : "initial";
      if (otherType !== eventType) continue;
      const otherTs = Math.max(...other.map((l) => toTimestamp(l.putawayAt)));
      if (Math.abs(ts - otherTs) > 120_000) continue;
      const canFold = combined.some((a) => other.some((b) => areComplementaryInboundLogs(a, b)));
      if (!canFold) continue;
      combined = [...combined, ...other];
      used.add(j);
    }
    used.add(i);
    folded.push(combined);
  }
  groupList = folded;

  const merged: MergedInboundReceiveRow[] = [];
  for (const group of groupList) {
    const sorted = [...group].sort((a, b) => toTimestamp(b.putawayAt) - toTimestamp(a.putawayAt));
    let goodQty = 0;
    let damagedQty = 0;
    let goodBinPath: string | null = null;
    let damagedLocation: string | null = null;
    const remarks: string[] = [];
    const photoUrls: string[] = [];
    const sourceLogIds: string[] = [];
    let putawayAtMs = 0;
    let eventType: "initial" | "restock" = sorted[0]?.eventType === "restock" ? "restock" : "initial";

    for (const log of sorted) {
      sourceLogIds.push(log.id);
      const g = Math.max(0, Number(log.goodQty) || 0);
      const d = Math.max(0, Number(log.damagedQty) || 0);
      goodQty += g;
      damagedQty += d;
      const logTs = toTimestamp(log.putawayAt);
      if (logTs > putawayAtMs) putawayAtMs = logTs;
      if (log.eventType === "restock") eventType = "restock";

      if (g > 0 && log.binPath?.trim() && !goodBinPath) {
        goodBinPath = log.binPath.trim();
      }
      if (d > 0 && !damagedLocation) {
        const loc = log.binPath?.trim() || log.stagingArea?.trim() || null;
        if (loc) damagedLocation = loc;
      }
      if (log.remarks?.trim()) remarks.push(log.remarks.trim());
      if (log.photoUrls?.length) photoUrls.push(...log.photoUrls);
    }

    merged.push({
      id: sourceLogIds.slice().sort().join("_") || `merged-${putawayAtMs}`,
      eventType,
      putawayAtMs,
      totalReceived: goodQty + damagedQty,
      goodQty,
      damagedQty,
      goodBinPath,
      damagedLocation,
      remarks: remarks.length ? [...new Set(remarks)].join(" · ") : null,
      photoUrls: [...new Set(photoUrls)],
      sourceLogIds,
    });
  }

  return merged.sort((a, b) => b.putawayAtMs - a.putawayAtMs);
}

export function formatInboundLogDate(log: InboundReceiveLog | Pick<MergedInboundReceiveRow, "putawayAtMs">): string {
  const ts =
    "putawayAtMs" in log && typeof log.putawayAtMs === "number"
      ? log.putawayAtMs
      : toTimestamp((log as InboundReceiveLog).putawayAt);
  if (!ts) return "—";
  return format(new Date(ts), "MMM d, yyyy · h:mm a");
}

/** Most recent event that drove sellable quantity to zero. */
export function findLastStockOutCause(
  item: InventoryItem,
  sources: InventoryHistorySources
): StockOutSummary | null {
  const rows = buildInventoryHistory(item, sources, { includeInternalEvents: false });
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row.qtyAfter !== 0) continue;
    if (row.qtyChange != null && row.qtyChange >= 0) continue;
    return {
      timestamp: row.timestamp,
      event: row.event,
      qtyBefore: row.qtyBefore,
      qtyChange: row.qtyChange,
      qtyAfter: row.qtyAfter,
      details: row.details,
    };
  }

  const lastDecrease = [...rows]
    .reverse()
    .find((row) => row.qtyChange != null && row.qtyChange < 0);
  if (!lastDecrease) return null;

  return {
    timestamp: lastDecrease.timestamp,
    event: lastDecrease.event,
    qtyBefore: lastDecrease.qtyBefore,
    qtyChange: lastDecrease.qtyChange,
    qtyAfter: lastDecrease.qtyAfter,
    details: lastDecrease.details,
  };
}

export function formatStockOutSummary(summary: StockOutSummary): string {
  const dateLabel = summary.timestamp
    ? format(new Date(summary.timestamp), "MMM d, yyyy")
    : "Unknown date";
  const change =
    summary.qtyChange != null
      ? `${summary.qtyChange > 0 ? "+" : ""}${summary.qtyChange} units`
      : "quantity reduced";
  const parts = [summary.event, change, dateLabel];
  if (summary.details?.trim()) parts.push(summary.details.trim());
  return parts.filter(Boolean).join(" · ");
}
