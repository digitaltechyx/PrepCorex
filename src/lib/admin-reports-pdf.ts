import { jsPDF } from "jspdf";
import type { AdminReportSummary } from "@/lib/admin-reports-types";
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
  if (pct === null) return "—";
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

export function buildAdminReportPdf(summary: AdminReportSummary): Uint8Array {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  let y = 16;

  doc.setFillColor(79, 70, 229);
  doc.rect(0, 0, pageW, 36, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.text("PrepCorex Reports", 14, 16);
  doc.setFontSize(10);
  doc.text("Executive Summary", 14, 24);
  doc.text(summary.period.label, 14, 30);
  doc.text(
    summary.scope.allClients ? "All clients" : `Client: ${summary.scope.clientName || summary.scope.clientId}`,
    pageW - 14,
    30,
    { align: "right" }
  );

  y = 46;
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
    "Units we received",
    String(summary.clientActivity.unitsReceived),
    [168, 85, 247]
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
  drawKpiBox(doc, 14 + kpiW + 3, y, kpiW, 24, "Units Shipped", String(summary.clientActivity.unitsShipped), [59, 130, 246]);
  drawKpiBox(doc, 14 + (kpiW + 3) * 2, y, kpiW, 24, "Units Received", String(summary.clientActivity.unitsReceived), [20, 184, 166]);
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

  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text(`Generated ${new Date().toLocaleString()} · PrepCorex Warehouse Management`, 14, 290);

  return new Uint8Array(doc.output("arraybuffer"));
}
