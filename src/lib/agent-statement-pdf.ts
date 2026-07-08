import { jsPDF } from "jspdf";
import type { AgentStatementSummary } from "@/lib/admin-reports-types";
import { formatReportMoney } from "@/lib/admin-reports-utils";

function drawBarChart(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  height: number,
  data: { label: string; value: number }[],
  title: string,
  color: [number, number, number]
) {
  doc.setFontSize(11);
  doc.setTextColor(30, 41, 59);
  doc.text(title, x, y);
  y += 6;
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
      doc.text(point.label.slice(0, 5), bx, chartBottom + 4);
    }
  });
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

export function buildAgentStatementPdf(summary: AgentStatementSummary): Uint8Array {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFillColor(109, 40, 217);
  doc.rect(0, 0, pageW, 40, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.text("PrepCorex Partner Statement", 14, 16);
  doc.setFontSize(11);
  doc.text(summary.agent.name, 14, 24);
  doc.setFontSize(9);
  doc.text(summary.period.label, 14, 31);
  doc.text(
    `${summary.agent.tier} Partner · ${summary.agent.rate}%`,
    pageW - 14,
    24,
    { align: "right" }
  );
  if (summary.agent.referralCode) {
    doc.text(`Code: ${summary.agent.referralCode}`, pageW - 14, 31, { align: "right" });
  }

  let y = 50;
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(12);
  doc.text("Commission Performance", 14, y);
  y += 10;

  const kpiW = (pageW - 28 - 9) / 4;
  drawBox(doc, 14, y, kpiW, 26, "Total earned", formatReportMoney(summary.earnings.totalEarned), [109, 40, 217]);
  drawBox(doc, 14 + kpiW + 3, y, kpiW, 26, "Pending", formatReportMoney(summary.earnings.totalPending), [245, 158, 11]);
  drawBox(doc, 14 + (kpiW + 3) * 2, y, kpiW, 26, "Paid", formatReportMoney(summary.earnings.totalPaid), [34, 197, 94]);
  drawBox(
    doc,
    14 + (kpiW + 3) * 3,
    y,
    kpiW,
    26,
    "Qualified revenue",
    formatReportMoney(summary.earnings.qualifiedRevenue),
    [59, 130, 246]
  );
  y += 34;

  doc.setFontSize(11);
  doc.text("Your Network", 14, y);
  y += 6;
  const half = (pageW - 31) / 2;
  drawBox(doc, 14, y, half, 24, "Total referred clients", String(summary.clients.totalReferred), [59, 130, 246]);
  drawBox(doc, 14 + half + 3, y, half, 24, "Active this period", String(summary.clients.activeInPeriod), [20, 184, 166]);
  y += 32;

  drawBarChart(
    doc,
    14,
    y,
    pageW - 28,
    38,
    summary.charts.earningsByDay.slice(-14),
    "Daily Commission Earned",
    [109, 40, 217]
  );
  y += 48;

  if (summary.charts.revenueByClient.length > 0) {
    doc.setFontSize(10);
    doc.text("Top Clients by Qualified Revenue", 14, y);
    y += 6;
    summary.charts.revenueByClient.slice(0, 6).forEach((row) => {
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      doc.text(row.client.slice(0, 45), 14, y);
      doc.text(formatReportMoney(row.revenue), pageW - 14, y, { align: "right" });
      y += 6;
    });
    y += 4;
  }

  if (summary.rows.commissions.length > 0) {
    if (y > 230) {
      doc.addPage();
      y = 20;
    }
    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    doc.text("Recent Commissions", 14, y);
    y += 6;
    summary.rows.commissions.slice(0, 10).forEach((c) => {
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      const rate = c.commissionRate ? `${c.commissionRate}%` : "";
      doc.text(`${c.invoiceNumber} · ${c.clientName} · ${rate} · ${c.status}`, 14, y);
      doc.text(formatReportMoney(c.commissionAmount), pageW - 14, y, { align: "right" });
      y += 5;
    });
  }

  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `PrepCorex Affiliate Program · ${new Date().toLocaleDateString()} · support@prepcorex.com`,
    14,
    290
  );

  return new Uint8Array(doc.output("arraybuffer"));
}
