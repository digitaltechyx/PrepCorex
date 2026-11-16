import { format } from "date-fns";
import { adminDb } from "@/lib/firebase-admin";
import {
  csvEscape,
  inboundReceivedQuantity,
  isInReportRange,
  pickReportDateMs,
  reportEndOfDay,
  reportStartOfDay,
} from "@/lib/admin-reports-utils";

export type LexiModuleReportRow = {
  type: string;
  description: string;
  sku: string;
  quantity: number | null;
  status: string;
  occurredAt: string;
  dateAdded: string | null;
  receivingDate: string | null;
};

function isoDay(ms: number): string | null {
  if (!ms) return null;
  return format(new Date(ms), "yyyy-MM-dd");
}

/**
 * Single-client inbound report from direct user paths (not collectionGroup).
 * Matches Inventory table Date Added / Receiving Date for the selected period.
 */
export async function buildLexiClientInboundReport(input: {
  clientUserId: string;
  clientUserName: string;
  from: Date;
  to: Date;
  allTime?: boolean;
}): Promise<{
  rows: LexiModuleReportRow[];
  unitsReceived: number;
  inventoryRequestCount: number;
  inventoryItemCount: number;
  currentStockOnHand: number;
  csv: string;
  periodLabel: string;
}> {
  const allTime = input.allTime ?? false;
  const from = reportStartOfDay(input.from);
  const to = reportEndOfDay(input.to);
  const periodLabel = allTime
    ? "All time"
    : `${format(from, "MMM d yyyy")} - ${format(to, "MMM d yyyy")}`;

  const userRef = adminDb().collection("users").doc(input.clientUserId);
  const [inventorySnap, requestSnap] = await Promise.all([
    userRef.collection("inventory").get(),
    userRef.collection("inventoryRequests").get(),
  ]);

  let currentStockOnHand = 0;
  const rows: LexiModuleReportRow[] = [];

  for (const doc of inventorySnap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const qty = Math.max(0, Math.floor(Number(data.quantity) || 0));
    currentStockOnHand += qty;

    const dateAddedMs = pickReportDateMs(data, ["dateAdded", "createdAt"]);
    const receivingMs = pickReportDateMs(data, ["receivingDate", "dateAdded", "createdAt"]);
    // Include if either Date Added or Receiving Date falls in range (Inventory table columns).
    const inRange =
      allTime ||
      (dateAddedMs > 0 && isInReportRange(new Date(dateAddedMs), from, to, false)) ||
      (receivingMs > 0 && isInReportRange(new Date(receivingMs), from, to, false));
    if (!inRange) continue;

    const occurredMs = dateAddedMs || receivingMs;
    rows.push({
      type: "Inventory item",
      description: String(data.productName || "Product"),
      sku: data.sku != null ? String(data.sku) : "",
      quantity: qty,
      status: String(data.status || ""),
      occurredAt: isoDay(occurredMs) || "",
      dateAdded: isoDay(dateAddedMs),
      receivingDate: isoDay(receivingMs),
    });
  }

  let unitsReceived = 0;
  let inventoryRequestCount = 0;
  for (const doc of requestSnap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const status = String(data.status || "").toLowerCase();
    const occurredMs = pickReportDateMs(data, [
      "requestedAt",
      "addDate",
      "approvedAt",
      "receivingDate",
      "createdAt",
    ]);
    if (!occurredMs || !isInReportRange(new Date(occurredMs), from, to, allTime)) continue;

    inventoryRequestCount += 1;
    const qty =
      status === "approved"
        ? inboundReceivedQuantity(data)
        : Math.max(0, Number(data.requestedQuantity) || Number(data.quantity) || 0);
    if (status === "approved") unitsReceived += qty;

    rows.push({
      type: "Inventory request",
      description: String(data.productName || "Inbound request"),
      sku: data.sku != null ? String(data.sku) : "",
      quantity: qty > 0 ? qty : null,
      status: String(data.status || ""),
      occurredAt: isoDay(occurredMs) || "",
      dateAdded: isoDay(pickReportDateMs(data, ["addDate", "requestedAt"])),
      receivingDate: isoDay(pickReportDateMs(data, ["receivingDate"])),
    });
  }

  rows.sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));

  const csv = [
    ["Report Type", "Inbound"].map(csvEscape).join(","),
    ["Period", periodLabel].map(csvEscape).join(","),
    ["Scope", input.clientUserName].map(csvEscape).join(","),
    "",
    ["Metric", "Count"].map(csvEscape).join(","),
    ["Units received (approved requests)", String(unitsReceived)].map(csvEscape).join(","),
    ["Inventory items in period", String(rows.filter((r) => r.type === "Inventory item").length)]
      .map(csvEscape)
      .join(","),
    ["Inventory requests in period", String(inventoryRequestCount)].map(csvEscape).join(","),
    ["Current stock on hand", String(currentStockOnHand)].map(csvEscape).join(","),
    "",
    ["Type", "Product", "SKU", "Quantity", "Status", "Date", "Date Added", "Receiving Date"]
      .map(csvEscape)
      .join(","),
    ...rows.map((r) =>
      [
        r.type,
        r.description,
        r.sku,
        r.quantity != null ? String(r.quantity) : "",
        r.status,
        r.occurredAt,
        r.dateAdded || "",
        r.receivingDate || "",
      ]
        .map(csvEscape)
        .join(",")
    ),
  ].join("\r\n");

  return {
    rows,
    unitsReceived,
    inventoryRequestCount,
    inventoryItemCount: rows.filter((r) => r.type === "Inventory item").length,
    currentStockOnHand,
    csv,
    periodLabel,
  };
}

/**
 * Single-client outbound report from shipped + shipmentRequests paths.
 */
export async function buildLexiClientOutboundReport(input: {
  clientUserId: string;
  clientUserName: string;
  from: Date;
  to: Date;
  allTime?: boolean;
}): Promise<{
  rows: LexiModuleReportRow[];
  unitsShipped: number;
  shipmentRequestCount: number;
  csv: string;
  periodLabel: string;
}> {
  const allTime = input.allTime ?? false;
  const from = reportStartOfDay(input.from);
  const to = reportEndOfDay(input.to);
  const periodLabel = allTime
    ? "All time"
    : `${format(from, "MMM d yyyy")} - ${format(to, "MMM d yyyy")}`;

  const userRef = adminDb().collection("users").doc(input.clientUserId);
  const [shippedSnap, requestSnap] = await Promise.all([
    userRef.collection("shipped").get(),
    userRef.collection("shipmentRequests").get(),
  ]);

  const rows: LexiModuleReportRow[] = [];
  let unitsShipped = 0;

  for (const doc of shippedSnap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const occurredMs = pickReportDateMs(data, ["date", "createdAt", "dispatchedAt"]);
    if (!occurredMs || !isInReportRange(new Date(occurredMs), from, to, allTime)) continue;
    const qty =
      Number(data.shippedQty) || Number(data.totalUnits) || Number(data.boxesShipped) || 0;
    if (qty > 0) unitsShipped += qty;
    rows.push({
      type: "Shipped",
      description: String(data.productName || data.service || "Outbound shipment"),
      sku: data.sku != null ? String(data.sku) : "",
      quantity: qty > 0 ? qty : null,
      status: "shipped",
      occurredAt: isoDay(occurredMs) || "",
      dateAdded: null,
      receivingDate: null,
    });
  }

  let shipmentRequestCount = 0;
  for (const doc of requestSnap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const occurredMs = pickReportDateMs(data, ["requestedAt", "date", "confirmedAt", "createdAt"]);
    if (!occurredMs || !isInReportRange(new Date(occurredMs), from, to, allTime)) continue;
    shipmentRequestCount += 1;
    const first = Array.isArray(data.shipments) ? (data.shipments[0] as Record<string, unknown>) : null;
    rows.push({
      type: "Shipment request",
      description: String(first?.productName || data.productName || "Outbound request"),
      sku: first?.sku != null ? String(first.sku) : "",
      quantity: null,
      status: String(data.status || ""),
      occurredAt: isoDay(occurredMs) || "",
      dateAdded: null,
      receivingDate: null,
    });
  }

  rows.sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt)));

  const csv = [
    ["Report Type", "Outbound"].map(csvEscape).join(","),
    ["Period", periodLabel].map(csvEscape).join(","),
    ["Scope", input.clientUserName].map(csvEscape).join(","),
    "",
    ["Metric", "Count"].map(csvEscape).join(","),
    ["Units shipped", String(unitsShipped)].map(csvEscape).join(","),
    ["Shipment requests in period", String(shipmentRequestCount)].map(csvEscape).join(","),
    "",
    ["Type", "Product", "SKU", "Quantity", "Status", "Date"].map(csvEscape).join(","),
    ...rows.map((r) =>
      [
        r.type,
        r.description,
        r.sku,
        r.quantity != null ? String(r.quantity) : "",
        r.status,
        r.occurredAt,
      ]
        .map(csvEscape)
        .join(",")
    ),
  ].join("\r\n");

  return {
    rows,
    unitsShipped,
    shipmentRequestCount,
    csv,
    periodLabel,
  };
}
