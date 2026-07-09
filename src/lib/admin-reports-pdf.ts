import { format } from "date-fns";
import { jsPDF } from "jspdf";
import { filterActivitiesByReportType, moduleLabel } from "@/lib/admin-reports-modules";
import type {
  AdminReportActivityRow,
  AdminReportComparisonSummary,
  AdminReportSummary,
  AdminReportType,
} from "@/lib/admin-reports-types";
import { formatReportMoney } from "@/lib/admin-reports-utils";

const SECTION_GAP = 14;
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
    const by = chartBottom - barH;
    doc.setFillColor(...color);
    doc.rect(bx, by, barW, Math.max(barH, 0.5), "F");
    if (data.length <= 14) {
      doc.setFontSize(6);
      doc.setTextColor(100, 116, 139);
      doc.text(point.label.slice(0, 5), bx, chartBottom + 5, { angle: 0 });
    }
  });

  return chartBottom + CHART_LABEL_SPACE;
}

function drawKpiBox(
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
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text(value, x + 8, y + 22);
}

function growthLabel(pct: number | null): string {
  if (pct === null) return "-";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function ensurePageSpace(doc: jsPDF, y: number, needed: number): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + needed > pageH - 18) {
    doc.addPage();
    return 20;
  }
  return y;
}

function drawReportHeader(
  doc: jsPDF,
  reportTitle: string,
  summary: AdminReportSummary
): number {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFillColor(79, 70, 229);
  doc.rect(0, 0, pageW, 36, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.text("PrepCorex Reports", 14, 16);
  doc.setFontSize(10);
  doc.text(reportTitle, 14, 24);
  doc.text(summary.period.label, 14, 30);
  doc.text(
    summary.scope.allClients ? "All clients" : `Client: ${summary.scope.clientName || summary.scope.clientId}`,
    pageW - 14,
    30,
    { align: "right" }
  );
  return 46;
}

function drawComparisonHeader(doc: jsPDF, comparison: AdminReportComparisonSummary): number {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFillColor(79, 70, 229);
  doc.rect(0, 0, pageW, 36, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.text("PrepCorex Reports", 14, 16);
  doc.setFontSize(10);
  doc.text("Period Comparison", 14, 24);
  doc.text(`${comparison.periodA.label} vs ${comparison.periodB.label}`, 14, 30);
  doc.text(
    comparison.scope.allClients ? "All clients" : `Client: ${comparison.scope.clientName || comparison.scope.clientId}`,
    pageW - 14,
    30,
    { align: "right" }
  );
  return 46;
}

function drawFooter(doc: jsPDF) {
  const pageH = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text(`Generated ${new Date().toLocaleString()} · PrepCorex Warehouse Management`, 14, pageH - 8);
}

function formatActivityDate(iso: string): string {
  try {
    return format(new Date(iso), "MMM d, yyyy");
  } catch {
    return iso.slice(0, 10);
  }
}

function drawTable(
  doc: jsPDF,
  y: number,
  title: string,
  headers: string[],
  rows: string[][],
  colWidths: number[]
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const rowH = 7;
  const x = 14;

  y = ensurePageSpace(doc, y, 20);
  doc.setFontSize(12);
  doc.setTextColor(30, 41, 59);
  doc.text(title, x, y);
  y += 8;

  const drawHeaderRow = (startY: number) => {
    doc.setFillColor(241, 245, 249);
    doc.rect(x, startY - 5, pageW - 28, rowH, "F");
    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    let cx = x + 2;
    headers.forEach((header, i) => {
      doc.text(header, cx, startY);
      cx += colWidths[i];
    });
    return startY + rowH;
  };

  y = drawHeaderRow(y);

  doc.setFontSize(7);
  doc.setTextColor(51, 65, 85);
  for (const row of rows) {
    if (y + rowH > pageH - 14) {
      doc.addPage();
      y = 20;
      y = drawHeaderRow(y);
      doc.setFontSize(7);
      doc.setTextColor(51, 65, 85);
    }
    let cx = x + 2;
    row.forEach((cell, i) => {
      doc.text(cell.slice(0, Math.floor(colWidths[i] / 1.8)), cx, y);
      cx += colWidths[i];
    });
    y += rowH;
  }

  return y + SECTION_GAP;
}

function sanitizePdfText(text: string): string {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2013\u2014\u2015]/g, "-")
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2026]/g, "...")
    .replace(/[^\t\n\r\x20-\x7E\xA0-\xFF]/g, "?");
}

function drawActivityTable(doc: jsPDF, y: number, title: string, activities: AdminReportActivityRow[]): number {
  return drawTable(
    doc,
    y,
    sanitizePdfText(title),
    ["Client", "Type", "Description", "Qty", "Status", "Date"],
    activities.map((r) => [
      sanitizePdfText(r.clientName),
      sanitizePdfText(r.type),
      sanitizePdfText(r.description),
      r.quantity?.toString() || "-",
      sanitizePdfText(r.status || "-"),
      sanitizePdfText(formatActivityDate(r.occurredAt)),
    ]),
    [32, 28, 48, 12, 22, 24]
  );
}

function moduleKpis(
  reportType: AdminReportType,
  summary: AdminReportSummary
): { label: string; value: string; accent: [number, number, number] }[] {
  const { clientActivity: a } = summary;
  switch (reportType) {
    case "inbound":
      return [
        { label: "Lifetime Inbound", value: String(a.lifetimeInboundReceived), accent: [168, 85, 247] },
        { label: "Stock On Hand", value: String(a.currentStockOnHand), accent: [124, 58, 237] },
        { label: "Inventory Requests", value: String(a.inventoryRequests), accent: [139, 92, 246] },
      ];
    case "outbound":
      return [
        { label: "Units Shipped", value: String(a.unitsShipped), accent: [59, 130, 246] },
        { label: "Shipment Requests", value: String(a.shipmentRequests), accent: [37, 99, 235] },
      ];
    case "returns":
      return [
        { label: "Returns Handled", value: String(a.returnsHandled), accent: [249, 115, 22] },
        { label: "Units Returned", value: String(a.unitsReturned), accent: [234, 88, 12] },
        { label: "Return Requests", value: String(a.returns), accent: [251, 146, 60] },
      ];
    case "dispose":
      return [
        { label: "Units Disposed", value: String(a.unitsDisposed), accent: [244, 63, 94] },
        { label: "Dispose Requests", value: String(a.disposeRequests), accent: [225, 29, 72] },
      ];
    default:
      return [];
  }
}

function buildExecutiveSummaryPdf(summary: AdminReportSummary): Uint8Array {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  let y = drawReportHeader(doc, "Executive Summary", summary);

  doc.setTextColor(30, 41, 59);
  doc.setFontSize(13);
  doc.text("Financial Overview", 14, y);
  y += 10;

  const kpiW = (pageW - 28 - 9) / 4;
  drawKpiBox(doc, 14, y, kpiW, 28, "Total Billed", formatReportMoney(summary.financial.totalBilled), [79, 70, 229]);
  drawKpiBox(doc, 14 + kpiW + 3, y, kpiW, 28, "Paid", formatReportMoney(summary.financial.totalPaid), [34, 197, 94]);
  drawKpiBox(doc, 14 + (kpiW + 3) * 2, y, kpiW, 28, "Pending", formatReportMoney(summary.financial.totalPending), [245, 158, 11]);
  drawKpiBox(
    doc,
    14 + (kpiW + 3) * 3,
    y,
    kpiW,
    28,
    "Revenue Growth",
    growthLabel(summary.growth.revenueChangePct),
    [14, 165, 233]
  );

  y += 36 + SECTION_GAP;
  doc.setFontSize(13);
  doc.text("Client Value Exchange", 14, y);
  y += 8;
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text("What clients give us vs. what we fulfill for them in this period.", 14, y);
  y += 12;

  drawKpiBox(doc, 14, y, (pageW - 31) / 2, 26, "They give us (billed)", formatReportMoney(summary.financial.totalBilled), [239, 68, 68]);
  drawKpiBox(
    doc,
    14 + (pageW - 31) / 2 + 3,
    y,
    (pageW - 31) / 2,
    26,
    "They paid",
    formatReportMoney(summary.financial.totalPaid),
    [34, 197, 94]
  );
  y += 30;
  drawKpiBox(doc, 14, y, (pageW - 31) / 2, 26, "Units we shipped", String(summary.clientActivity.unitsShipped), [59, 130, 246]);
  drawKpiBox(
    doc,
    14 + (pageW - 31) / 2 + 3,
    y,
    (pageW - 31) / 2,
    26,
    "Lifetime inbound",
    String(summary.clientActivity.lifetimeInboundReceived),
    [168, 85, 247]
  );
  y += 30;
  drawKpiBox(doc, 14, y, (pageW - 31) / 2, 26, "Stock on hand", String(summary.clientActivity.currentStockOnHand), [124, 58, 237]);
  drawKpiBox(
    doc,
    14 + (pageW - 31) / 2 + 3,
    y,
    (pageW - 31) / 2,
    26,
    "Returns handled",
    String(summary.clientActivity.returnsHandled),
    [249, 115, 22]
  );

  y += 34 + SECTION_GAP;
  y = ensurePageSpace(doc, y, 58);
  y = drawBarChart(doc, 14, y, pageW - 28, 36, summary.charts.revenueByDay.slice(-14), "Revenue Trend", [79, 70, 229]);
  y += SECTION_GAP;

  y = ensurePageSpace(doc, y, 58);
  y = drawBarChart(
    doc,
    14,
    y,
    pageW - 28,
    36,
    summary.charts.activityByDay.slice(-14).map((point) => ({
      label: point.label,
      value: point.requests,
    })),
    "Activity Trend (Requests)",
    [34, 197, 94]
  );
  y += SECTION_GAP;

  y = ensurePageSpace(doc, y, 70);
  doc.setFontSize(13);
  doc.setTextColor(30, 41, 59);
  doc.text("Operations & Commissions", 14, y);
  y += 12;

  drawKpiBox(doc, 14, y, kpiW, 24, "Ship Requests", String(summary.clientActivity.shipmentRequests), [59, 130, 246]);
  drawKpiBox(doc, 14 + kpiW + 3, y, kpiW, 24, "Inventory Req.", String(summary.clientActivity.inventoryRequests), [168, 85, 247]);
  drawKpiBox(doc, 14 + (kpiW + 3) * 2, y, kpiW, 24, "Returns", String(summary.clientActivity.returns), [249, 115, 22]);
  drawKpiBox(
    doc,
    14 + (kpiW + 3) * 3,
    y,
    kpiW,
    24,
    "Commissions",
    formatReportMoney(summary.commission.totalEarned),
    [139, 92, 246]
  );

  y += 30;
  drawKpiBox(doc, 14, y, kpiW, 24, "Dispose Requests", String(summary.clientActivity.disposeRequests), [244, 63, 94]);
  drawKpiBox(doc, 14 + kpiW + 3, y, kpiW, 24, "Units Disposed", String(summary.clientActivity.unitsDisposed), [244, 63, 94]);
  drawKpiBox(doc, 14 + (kpiW + 3) * 2, y, kpiW, 24, "Returns Handled", String(summary.clientActivity.returnsHandled), [249, 115, 22]);
  drawKpiBox(
    doc,
    14 + (kpiW + 3) * 3,
    y,
    kpiW,
    24,
    "Clients Active",
    String(summary.clientActivity.activeClients),
    [14, 165, 233]
  );

  y += 34 + SECTION_GAP;
  const mix = summary.charts.requestMix.filter((m) => m.count > 0);
  if (mix.length > 0) {
    y = ensurePageSpace(doc, y, 12 + mix.length * 10);
    doc.setFontSize(11);
    doc.setTextColor(30, 41, 59);
    doc.text("Request Mix", 14, y);
    y += 10;
    const mixMax = Math.max(...mix.map((m) => m.count), 1);
    mix.forEach((m) => {
      const barLen = ((pageW - 60) * m.count) / mixMax;
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      doc.text(m.type, 14, y + 4);
      doc.setFillColor(99, 102, 241);
      doc.rect(50, y, barLen, 5, "F");
      doc.text(String(m.count), 52 + barLen, y + 4);
      y += 10;
    });
  }

  y += SECTION_GAP;
  if (summary.charts.topClientsByRevenue.length > 0) {
    y = ensurePageSpace(doc, y, 40);
    doc.setFontSize(11);
    doc.setTextColor(30, 41, 59);
    doc.text("Top Clients by Revenue", 14, y);
    y += 10;
    summary.charts.topClientsByRevenue.slice(0, 5).forEach((row) => {
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      doc.text(row.client.slice(0, 40), 14, y);
      doc.text(formatReportMoney(row.revenue), pageW - 14, y, { align: "right" });
      y += 7;
    });
  }

  drawFooter(doc);
  return new Uint8Array(doc.output("arraybuffer"));
}

function buildModuleReportPdf(summary: AdminReportSummary, reportType: AdminReportType): Uint8Array {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const title = `${moduleLabel(reportType)} Report`;
  let y = drawReportHeader(doc, title, summary);

  const kpis = moduleKpis(reportType, summary);
  const kpiW = (pageW - 28 - (kpis.length - 1) * 3) / Math.max(kpis.length, 1);
  kpis.forEach((kpi, i) => {
    drawKpiBox(doc, 14 + i * (kpiW + 3), y, kpiW, 28, kpi.label, kpi.value, kpi.accent);
  });
  y += 36 + SECTION_GAP;

  const activities = filterActivitiesByReportType(summary.rows.activities, reportType).slice(0, 500);
  y = drawActivityTable(doc, y, `${title} - Activity`, activities);

  drawFooter(doc);
  return new Uint8Array(doc.output("arraybuffer"));
}

function buildFullReportPdf(summary: AdminReportSummary): Uint8Array {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  let y = drawReportHeader(doc, "Full Report", summary);

  const kpiW = (pageW - 28 - 15) / 6;
  const fullKpis = [
    { label: "Lifetime Inbound", value: String(summary.clientActivity.lifetimeInboundReceived), accent: [168, 85, 247] as [number, number, number] },
    { label: "Stock On Hand", value: String(summary.clientActivity.currentStockOnHand), accent: [124, 58, 237] as [number, number, number] },
    { label: "Shipped", value: String(summary.clientActivity.unitsShipped), accent: [59, 130, 246] as [number, number, number] },
    { label: "Disposed", value: String(summary.clientActivity.unitsDisposed), accent: [244, 63, 94] as [number, number, number] },
    { label: "Returns", value: String(summary.clientActivity.returnsHandled), accent: [249, 115, 22] as [number, number, number] },
    { label: "Billed", value: formatReportMoney(summary.financial.totalBilled), accent: [79, 70, 229] as [number, number, number] },
  ];
  fullKpis.forEach((kpi, i) => {
    drawKpiBox(doc, 14 + i * (kpiW + 3), y, kpiW, 28, kpi.label, kpi.value, kpi.accent);
  });
  y += 36 + SECTION_GAP;

  y = drawTable(
    doc,
    y,
    "Invoices",
    ["Client", "Invoice", "Date", "Status", "Total"],
    summary.rows.invoices.map((r) => [
      r.clientName,
      r.invoiceNumber,
      r.date,
      r.status,
      formatReportMoney(r.grandTotal),
    ]),
    [38, 30, 28, 22, 28]
  );

  y = drawActivityTable(doc, y, "All Activity", summary.rows.activities.slice(0, 200));

  drawFooter(doc);
  return new Uint8Array(doc.output("arraybuffer"));
}

function buildFinancialReportPdf(summary: AdminReportSummary): Uint8Array {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  let y = drawReportHeader(doc, "Financial Report", summary);

  const kpiW = (pageW - 31) / 3;
  drawKpiBox(doc, 14, y, kpiW, 28, "Total Billed", formatReportMoney(summary.financial.totalBilled), [79, 70, 229]);
  drawKpiBox(doc, 14 + kpiW + 3, y, kpiW, 28, "Paid", formatReportMoney(summary.financial.totalPaid), [34, 197, 94]);
  drawKpiBox(doc, 14 + (kpiW + 3) * 2, y, kpiW, 28, "Pending", formatReportMoney(summary.financial.totalPending), [245, 158, 11]);
  y += 36 + SECTION_GAP;

  y = drawTable(
    doc,
    y,
    "Invoice Detail",
    ["Client", "Invoice", "Date", "Status", "Subtotal", "Total"],
    summary.rows.invoices.map((r) => [
      r.clientName,
      r.invoiceNumber,
      r.date,
      r.status,
      formatReportMoney(r.subtotal),
      formatReportMoney(r.grandTotal),
    ]),
    [32, 28, 24, 20, 26, 26]
  );

  drawFooter(doc);
  return new Uint8Array(doc.output("arraybuffer"));
}

function buildCommissionReportPdf(summary: AdminReportSummary): Uint8Array {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  let y = drawReportHeader(doc, "Commission Report", summary);

  const kpiW = (pageW - 31) / 3;
  drawKpiBox(doc, 14, y, kpiW, 28, "Total Earned", formatReportMoney(summary.commission.totalEarned), [139, 92, 246]);
  drawKpiBox(doc, 14 + kpiW + 3, y, kpiW, 28, "Pending", formatReportMoney(summary.commission.totalPending), [245, 158, 11]);
  drawKpiBox(doc, 14 + (kpiW + 3) * 2, y, kpiW, 28, "Paid", formatReportMoney(summary.commission.totalPaid), [34, 197, 94]);
  y += 36 + SECTION_GAP;

  y = drawTable(
    doc,
    y,
    "Commission Detail",
    ["Agent", "Client", "Invoice", "Rate", "Commission", "Status"],
    summary.rows.commissions.map((r) => [
      r.agentName,
      r.clientName,
      r.invoiceNumber,
      r.commissionRate ? `${r.commissionRate}%` : "—",
      formatReportMoney(r.commissionAmount),
      r.status,
    ]),
    [30, 30, 28, 14, 26, 22]
  );

  drawFooter(doc);
  return new Uint8Array(doc.output("arraybuffer"));
}

function buildOperationsReportPdf(summary: AdminReportSummary): Uint8Array {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  let y = drawReportHeader(doc, "Operations Report", summary);

  const a = summary.clientActivity;
  const pageW = doc.internal.pageSize.getWidth();
  const kpiW = (pageW - 28 - 12) / 5;
  drawKpiBox(doc, 14, y, kpiW, 24, "Lifetime Inbound", String(a.lifetimeInboundReceived), [168, 85, 247]);
  drawKpiBox(doc, 14 + kpiW + 3, y, kpiW, 24, "Stock On Hand", String(a.currentStockOnHand), [124, 58, 237]);
  drawKpiBox(doc, 14 + (kpiW + 3) * 2, y, kpiW, 24, "Shipped", String(a.unitsShipped), [59, 130, 246]);
  drawKpiBox(doc, 14 + (kpiW + 3) * 3, y, kpiW, 24, "Disposed", String(a.unitsDisposed), [244, 63, 94]);
  drawKpiBox(doc, 14 + (kpiW + 3) * 4, y, kpiW, 24, "Returns", String(a.returnsHandled), [249, 115, 22]);
  y += 30 + SECTION_GAP;

  y = drawActivityTable(doc, y, "Operations Activity", summary.rows.activities);

  drawFooter(doc);
  return new Uint8Array(doc.output("arraybuffer"));
}

function buildAuditReportPdf(summary: AdminReportSummary): Uint8Array {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  let y = drawReportHeader(doc, "Audit Trail", summary);

  y = drawTable(
    doc,
    y,
    "Audit Events",
    ["Module", "Event", "Description", "Client/Agent", "Date"],
    summary.rows.audit.map((r) => [
      r.module,
      r.eventType,
      r.description,
      r.clientName || r.agentName || "—",
      formatActivityDate(r.occurredAt),
    ]),
    [24, 28, 58, 32, 24]
  );

  drawFooter(doc);
  return new Uint8Array(doc.output("arraybuffer"));
}

function buildClientActivityReportPdf(summary: AdminReportSummary): Uint8Array {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  let y = drawReportHeader(doc, "Client Activity", summary);
  y = drawActivityTable(doc, y, "Client Activity Log", summary.rows.activities);
  drawFooter(doc);
  return new Uint8Array(doc.output("arraybuffer"));
}

export function buildAdminReportComparisonPdf(comparison: AdminReportComparisonSummary): Uint8Array {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  let y = drawComparisonHeader(doc, comparison);

  y = drawTable(
    doc,
    y,
    "Metric Comparison",
    ["Metric", "Period A", "Period B", "Change"],
    comparison.metrics.map((m) => {
      const fmt = (n: number) => (m.format === "currency" ? formatReportMoney(n) : String(n));
      const delta =
        m.format === "currency"
          ? `${m.delta >= 0 ? "+" : ""}${formatReportMoney(m.delta)}`
          : `${m.delta >= 0 ? "+" : ""}${m.delta}`;
      const pct = m.deltaPct === null ? "" : ` (${growthLabel(m.deltaPct)})`;
      return [m.label, fmt(m.periodA), fmt(m.periodB), `${delta}${pct}`];
    }),
    [42, 34, 34, 44]
  );

  drawFooter(doc);
  return new Uint8Array(doc.output("arraybuffer"));
}

export function buildAdminReportPdf(
  summary: AdminReportSummary,
  reportType: AdminReportType = "overview"
): Uint8Array {
  switch (reportType) {
    case "inbound":
    case "outbound":
    case "returns":
    case "dispose":
      return buildModuleReportPdf(summary, reportType);
    case "full":
      return buildFullReportPdf(summary);
    case "financial":
      return buildFinancialReportPdf(summary);
    case "commission":
      return buildCommissionReportPdf(summary);
    case "operations":
      return buildOperationsReportPdf(summary);
    case "audit":
      return buildAuditReportPdf(summary);
    case "client_activity":
      return buildClientActivityReportPdf(summary);
    case "overview":
    default:
      return buildExecutiveSummaryPdf(summary);
  }
}
