import { jsPDF } from "jspdf";
import type { AdminReportSummary } from "@/lib/admin-reports-types";
import { formatReportMoney } from "@/lib/admin-reports-utils";

const CHART_LABEL_SPACE = 10;

function drawBarChart(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  height: number,
  data: { label: string; value: number }[],
  title: string,
  color: [number, number, number]
): number {
  doc.setFontSize(11);
  doc.setTextColor(30, 41, 59);
  doc.text(title, x, y);
  y += 8;
  const max = Math.max(...data.map((d) => d.value), 1);
  const barW = Math.max(4, (width - 10) / Math.max(data.length, 1) - 2);
  const chartBottom = y + height;
  doc.setDrawColor(226, 232, 240);
  doc.line(x, chartBottom, x + width, chartBottom);
  data.forEach((point, i) => {
    const barH = (point.value / max) * (height - 8);
    const bx = x + 4 + i * (barW + 2);
    doc.setFillColor(...color);
    doc.rect(bx, chartBottom - barH, barW, barH, "F");
    if (data.length <= 14) {
      doc.setFontSize(6);
      doc.setTextColor(100, 116, 139);
      doc.text(point.label.slice(0, 5), bx, chartBottom + 5);
    }
  });
  return chartBottom + CHART_LABEL_SPACE;
}

function drawBox(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
  accent: [number, number, number]
) {
  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(x, y, w, h, 3, 3, "FD");
  doc.setFillColor(...accent);
  doc.rect(x, y, 3, h, "F");
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(label.toUpperCase(), x + 8, y + 10);
  doc.setFontSize(13);
  doc.setTextColor(15, 23, 42);
  doc.text(value, x + 8, y + 22);
}

function growthText(pct: number | null): string {
  if (pct === null) return "N/A";
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% vs prior period`;
}

export function buildClientStatementPdf(summary: AdminReportSummary): Uint8Array {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const clientName = summary.scope.clientName || "Client Account";

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageW, 40, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.text("PrepCorex Account Statement", 14, 16);
  doc.setFontSize(11);
  doc.text(clientName, 14, 24);
  doc.setFontSize(9);
  doc.text(summary.period.label, 14, 31);
  doc.text("Partnership Performance Summary", pageW - 14, 31, { align: "right" });

  let y = 50;
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(12);
  doc.text("Your Partnership at a Glance", 14, y);
  y += 5;
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text("This statement shows what you invested with PrepCorex and the fulfillment services we delivered.", 14, y);
  y += 10;

  const half = (pageW - 31) / 2;
  doc.setFontSize(11);
  doc.setTextColor(79, 70, 229);
  doc.text("You invested", 14, y);
  y += 6;
  drawBox(doc, 14, y, half, 26, "Total invoiced", formatReportMoney(summary.financial.totalBilled), [79, 70, 229]);
  drawBox(doc, 14 + half + 3, y, half, 26, "Total paid", formatReportMoney(summary.financial.totalPaid), [34, 197, 94]);
  y += 32;
  drawBox(doc, 14, y, half, 26, "Outstanding", formatReportMoney(summary.financial.totalPending), [245, 158, 11]);
  drawBox(doc, 14 + half + 3, y, half, 26, "Growth", growthText(summary.growth.revenueChangePct), [14, 165, 233]);
  y += 34;

  doc.setFontSize(11);
  doc.setTextColor(59, 130, 246);
  doc.text("PrepCorex delivered for you", 14, y);
  y += 6;
  const qW = (pageW - 28 - 6) / 3;
  drawBox(doc, 14, y, qW, 24, "Units shipped", String(summary.clientActivity.unitsShipped), [59, 130, 246]);
  drawBox(doc, 14 + qW + 3, y, qW, 24, "Lifetime inbound", String(summary.clientActivity.lifetimeInboundReceived), [168, 85, 247]);
  drawBox(doc, 14 + (qW + 3) * 2, y, qW, 24, "Stock on hand", String(summary.clientActivity.currentStockOnHand), [124, 58, 237]);
  y += 32;

  y = drawBarChart(
    doc,
    14,
    y,
    pageW - 28,
    38,
    summary.charts.revenueByDay.slice(-14),
    "Your Billing Trend",
    [79, 70, 229]
  );
  y += 8;

  doc.setFontSize(10);
  doc.setTextColor(30, 41, 59);
  doc.text("Activity Summary", 14, y);
  y += 6;
  const activities = [
    ["Shipment requests", summary.clientActivity.shipmentRequests],
    ["Inventory requests", summary.clientActivity.inventoryRequests],
    ["Dispose requests", summary.clientActivity.disposeRequests],
    ["Invoices this period", summary.financial.invoiceCount],
  ];
  activities.forEach(([label, val]) => {
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(String(label), 14, y);
    doc.text(String(val), pageW - 14, y, { align: "right" });
    y += 6;
  });

  if (summary.rows.invoices.length > 0) {
    y += 4;
    if (y > 240) {
      doc.addPage();
      y = 20;
    }
    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    doc.text("Recent Invoices", 14, y);
    y += 6;
    summary.rows.invoices.slice(0, 8).forEach((inv) => {
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      doc.text(`${inv.invoiceNumber} · ${inv.date} · ${inv.status}`, 14, y);
      doc.text(formatReportMoney(inv.grandTotal), pageW - 14, y, { align: "right" });
      y += 6;
    });
  }

  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `Prepared by PrepCorex · ${new Date().toLocaleDateString()} · Questions: support@prepcorex.com`,
    14,
    290
  );

  return new Uint8Array(doc.output("arraybuffer"));
}
