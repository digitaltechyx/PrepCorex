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

function periodLabelFor(from: Date, to: Date, allTime: boolean): string {
  return allTime ? "All time" : `${format(from, "MMM d yyyy")} - ${format(to, "MMM d yyyy")}`;
}

function formatExpirySummary(data: Record<string, unknown>): string {
  const direct = pickReportDateMs(data, ["expiryDate"]);
  if (direct > 0) return isoDay(direct) || "";

  const lots = Array.isArray(data.fefoLots) ? data.fefoLots : Array.isArray(data.lots) ? data.lots : [];
  const parts: string[] = [];
  for (const lot of lots) {
    if (!lot || typeof lot !== "object") continue;
    const row = lot as Record<string, unknown>;
    const ms = pickReportDateMs(row, ["expiryDate", "expiry"]);
    const qty = Math.max(0, Math.floor(Number(row.quantity) || 0));
    if (!ms) continue;
    parts.push(`${isoDay(ms)}${qty ? ` (${qty})` : ""}`);
  }
  return parts.join("; ");
}

function formatUnitSize(data: Record<string, unknown>): string {
  const l = Number(data.unitLengthIn);
  const w = Number(data.unitWidthIn);
  const h = Number(data.unitHeightIn);
  const wt = Number(data.unitWeightLb);
  const dims = [l, w, h].every((n) => Number.isFinite(n) && n > 0)
    ? `${l}x${w}x${h} in`
    : "";
  const weight = Number.isFinite(wt) && wt > 0 ? `${wt} lb` : "";
  return [dims, weight].filter(Boolean).join(" / ");
}

function inInventoryPeriod(
  data: Record<string, unknown>,
  from: Date,
  to: Date,
  allTime: boolean
): { inRange: boolean; dateAddedMs: number; receivingMs: number } {
  const dateAddedMs = pickReportDateMs(data, ["dateAdded", "createdAt"]);
  const receivingMs = pickReportDateMs(data, ["receivingDate", "dateAdded", "createdAt"]);
  if (allTime) return { inRange: true, dateAddedMs, receivingMs };
  const inRange =
    (dateAddedMs > 0 && isInReportRange(new Date(dateAddedMs), from, to, false)) ||
    (receivingMs > 0 && isInReportRange(new Date(receivingMs), from, to, false));
  return { inRange, dateAddedMs, receivingMs };
}

/**
 * Inventory-only CSV (Inventory table products). Never includes inbound requests.
 */
export async function buildLexiClientInventoryReport(input: {
  clientUserId: string;
  clientUserName: string;
  from: Date;
  to: Date;
  allTime?: boolean;
}): Promise<{
  rows: Array<{
    productName: string;
    sku: string;
    retailIdentifier: string;
    expiry: string;
    unitSize: string;
    quantity: number;
    status: string;
    dateAdded: string | null;
    receivingDate: string | null;
    remarks: string;
  }>;
  rowCount: number;
  unitsOnHandInPeriod: number;
  currentStockOnHand: number;
  csv: string;
  periodLabel: string;
}> {
  const allTime = input.allTime ?? false;
  const from = reportStartOfDay(input.from);
  const to = reportEndOfDay(input.to);
  const periodLabel = periodLabelFor(from, to, allTime);

  const snap = await adminDb().collection(`users/${input.clientUserId}/inventory`).get();
  let currentStockOnHand = 0;
  const rows: Array<{
    productName: string;
    sku: string;
    retailIdentifier: string;
    expiry: string;
    unitSize: string;
    quantity: number;
    status: string;
    dateAdded: string | null;
    receivingDate: string | null;
    remarks: string;
  }> = [];

  for (const doc of snap.docs) {
    const data = doc.data() as Record<string, unknown>;
    const qty = Math.max(0, Math.floor(Number(data.quantity) || 0));
    currentStockOnHand += qty;

    const { inRange, dateAddedMs, receivingMs } = inInventoryPeriod(data, from, to, allTime);
    if (!inRange) continue;

    rows.push({
      productName: String(data.productName || "Product"),
      sku: data.sku != null ? String(data.sku) : "",
      retailIdentifier: data.retailIdentifier != null ? String(data.retailIdentifier) : "",
      expiry: formatExpirySummary(data),
      unitSize: formatUnitSize(data),
      quantity: qty,
      status: String(data.status || ""),
      dateAdded: isoDay(dateAddedMs),
      receivingDate: isoDay(receivingMs),
      remarks: data.remarks != null ? String(data.remarks) : "",
    });
  }

  rows.sort((a, b) => String(b.dateAdded || "").localeCompare(String(a.dateAdded || "")));
  const unitsOnHandInPeriod = rows.reduce((sum, row) => sum + row.quantity, 0);

  const csv = [
    ["Report Type", "Inventory"].map(csvEscape).join(","),
    ["Period", periodLabel].map(csvEscape).join(","),
    ["Scope", input.clientUserName].map(csvEscape).join(","),
    ["Includes", "Inventory products only (no inbound requests)"].map(csvEscape).join(","),
    "",
    ["Metric", "Count"].map(csvEscape).join(","),
    ["Inventory products in period", String(rows.length)].map(csvEscape).join(","),
    ["Units on hand (those products)", String(unitsOnHandInPeriod)].map(csvEscape).join(","),
    ["Current stock on hand (all)", String(currentStockOnHand)].map(csvEscape).join(","),
    "",
    [
      "Product",
      "SKU",
      "Retail ID",
      "Expiry",
      "Unit size",
      "Quantity",
      "Status",
      "Date Added",
      "Receiving Date",
      "Remarks",
    ]
      .map(csvEscape)
      .join(","),
    ...rows.map((r) =>
      [
        r.productName,
        r.sku,
        r.retailIdentifier,
        r.expiry,
        r.unitSize,
        String(r.quantity),
        r.status,
        r.dateAdded || "",
        r.receivingDate || "",
        r.remarks,
      ]
        .map(csvEscape)
        .join(",")
    ),
  ].join("\r\n");

  return {
    rows,
    rowCount: rows.length,
    unitsOnHandInPeriod,
    currentStockOnHand,
    csv,
    periodLabel,
  };
}

/**
 * Inbound requests only (inventoryRequests). Does not include Inventory table products.
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
  const periodLabel = periodLabelFor(from, to, allTime);

  const userRef = adminDb().collection("users").doc(input.clientUserId);
  const [inventorySnap, requestSnap] = await Promise.all([
    userRef.collection("inventory").get(),
    userRef.collection("inventoryRequests").get(),
  ]);

  let currentStockOnHand = 0;
  for (const doc of inventorySnap.docs) {
    currentStockOnHand += Math.max(0, Math.floor(Number(doc.data().quantity) || 0));
  }

  const rows: LexiModuleReportRow[] = [];
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
      type: "Inbound request",
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
    ["Report Type", "Inbound requests"].map(csvEscape).join(","),
    ["Period", periodLabel].map(csvEscape).join(","),
    ["Scope", input.clientUserName].map(csvEscape).join(","),
    ["Includes", "Inbound requests only (no Inventory table products)"].map(csvEscape).join(","),
    "",
    ["Metric", "Count"].map(csvEscape).join(","),
    ["Inbound requests in period", String(inventoryRequestCount)].map(csvEscape).join(","),
    ["Units received (approved)", String(unitsReceived)].map(csvEscape).join(","),
    ["Current stock on hand", String(currentStockOnHand)].map(csvEscape).join(","),
    "",
    ["Type", "Product", "SKU", "Quantity", "Status", "Request date", "Date Added", "Receiving Date"]
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
    inventoryItemCount: 0,
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
  const periodLabel = periodLabelFor(from, to, allTime);

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
    const first = Array.isArray(data.shipments)
      ? (data.shipments[0] as Record<string, unknown>)
      : null;
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
    ["Includes", "Shipped rows and outbound shipment requests only"].map(csvEscape).join(","),
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
