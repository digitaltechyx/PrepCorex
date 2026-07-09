import type { AdminReportSummary } from "@/lib/admin-reports-types";
import { csvEscape } from "@/lib/admin-reports-utils";

export function buildClientStatementCsv(summary: AdminReportSummary): string {
  const clientName = summary.scope.clientName || "Client";
  const lines: string[] = [
    "PrepCorex Account Statement",
    `Client,${csvEscape(clientName)}`,
    `Period,${csvEscape(summary.period.label)}`,
    "",
    "=== YOUR INVESTMENT WITH PREPCOREX ===",
    "Metric,Amount",
    `Total Invoiced,${summary.financial.totalBilled.toFixed(2)}`,
    `Total Paid,${summary.financial.totalPaid.toFixed(2)}`,
    `Outstanding Balance,${summary.financial.totalPending.toFixed(2)}`,
    `Invoice Count,${summary.financial.invoiceCount}`,
    "",
    "=== SERVICES PREPCOREX FULFILLED ===",
    "Metric,Count",
    `Units Shipped,${summary.clientActivity.unitsShipped}`,
    `Units Received & Stored,${summary.clientActivity.unitsReceived}`,
    `Units Disposed,${summary.clientActivity.unitsDisposed}`,
    `Shipment Requests,${summary.clientActivity.shipmentRequests}`,
    `Inventory Requests,${summary.clientActivity.inventoryRequests}`,
    `Product Returns Handled,${summary.clientActivity.returnsHandled}`,
    `Units Returned,${summary.clientActivity.unitsReturned}`,
    `Dispose Requests,${summary.clientActivity.disposeRequests}`,
    "",
    "=== GROWTH (VS PRIOR PERIOD) ===",
    "Metric,Value",
    `Revenue Change,${summary.growth.revenueChangePct !== null ? `${summary.growth.revenueChangePct.toFixed(1)}%` : "N/A"}`,
    `Invoice Count Change,${summary.growth.invoiceCountChangePct !== null ? `${summary.growth.invoiceCountChangePct.toFixed(1)}%` : "N/A"}`,
    "",
    "=== INVOICE DETAIL ===",
    ["Invoice #", "Date", "Status", "Subtotal", "Total"].map(csvEscape).join(","),
    ...summary.rows.invoices.map((r) =>
      [r.invoiceNumber, r.date, r.status, r.subtotal.toFixed(2), r.grandTotal.toFixed(2)]
        .map(csvEscape)
        .join(",")
    ),
    "",
    "=== ACTIVITY DETAIL ===",
    ["Date", "Activity", "Description", "Quantity", "Status"].map(csvEscape).join(","),
    ...summary.rows.activities.map((r) =>
      [r.occurredAt.slice(0, 10), r.type, r.description, r.quantity?.toString() || "", r.status || ""]
        .map(csvEscape)
        .join(",")
    ),
  ];
  return lines.join("\r\n");
}
