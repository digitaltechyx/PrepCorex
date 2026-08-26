import { csvEscape, formatReportMoney } from "@/lib/admin-reports-utils";
import type { ClientReportSummary, ClientReportTab } from "@/lib/client-reports-types";

function money(n: number): string {
  return n.toFixed(2);
}

export function buildClientReportCsv(summary: ClientReportSummary, tab: ClientReportTab): string {
  const lines: string[] = [
    "PrepCorex Client Report",
    `Period,${csvEscape(summary.period.label)}`,
    "",
  ];

  if (tab === "overview" || tab === "inventory") {
    lines.push(
      "=== OVERVIEW ===",
      "Metric,Value",
      `Units received,${summary.overview.unitsReceived}`,
      `Units shipped,${summary.overview.unitsShipped}`,
      `Current on hand,${summary.overview.currentOnHand}`,
      `Damaged / quarantine,${summary.overview.currentDamaged}`,
      `Returns handled,${summary.overview.returnsHandled}`,
      `Units returned,${summary.overview.unitsReturned}`,
      `Units disposed,${summary.overview.unitsDisposed}`,
      `Invoices billed,${money(summary.overview.invoicesBilled)}`,
      `Invoices paid,${money(summary.overview.invoicesPaid)}`,
      `Invoices pending,${money(summary.overview.invoicesPending)}`,
      `Est. save on shipping,${money(summary.savings.savedOnShipping)}`,
      `Est. save on prep,${money(summary.savings.prep.savedOnPrep)}`,
      ""
    );
  }

  if (tab === "inventory") {
    lines.push(
      "=== INVENTORY SNAPSHOT ===",
      ["Product", "SKU", "Source", "On hand", "Damaged", "Status"].map(csvEscape).join(","),
      ...summary.inventory.map((r) =>
        [r.productName, r.sku || "", r.source, String(r.quantity), String(r.damagedQuantity), r.status]
          .map(csvEscape)
          .join(",")
      ),
      ""
    );
  }

  if (tab === "invoices") {
    lines.push(
      "=== INVOICES ===",
      ["Invoice #", "Date", "Status", "Subtotal", "Total"].map(csvEscape).join(","),
      ...summary.invoices.map((r) =>
        [r.invoiceNumber, r.date.slice(0, 10), r.status, money(r.subtotal), money(r.grandTotal)]
          .map(csvEscape)
          .join(",")
      ),
      ""
    );
  }

  if (tab === "savings") {
    const s = summary.savings;
    lines.push(
      "=== ESTIMATED LABEL SAVINGS ===",
      "These USPS / UPS / FedEx amounts are approximate market rates set by PrepCorex, not live quotes.",
      "Metric,Value",
      `Labels,${s.labelCount}`,
      `You paid,${money(s.paidTotal)}`,
      `Paid GOFO,${money(s.paidGofo)}`,
      `Paid USPS,${money(s.paidUsps)}`,
      `Paid UPS,${money(s.paidUps)}`,
      `Paid FedEx,${money(s.paidFedex)}`,
      `Approx USPS total,${money(s.estimatedUsps)}`,
      `Saved vs USPS (est.),${money(s.savedVsUsps)}`,
      `Approx UPS total,${money(s.estimatedUps)}`,
      `Saved vs UPS (est.),${money(s.savedVsUps)}`,
      `Approx FedEx total,${money(s.estimatedFedex)}`,
      `Saved vs FedEx (est.),${money(s.savedVsFedex)}`,
      `Est. save on shipping,${money(s.savedOnShipping)}`,
      `Average paid,${money(s.averagePaid)}`,
      "",
      "=== ESTIMATED PREP SAVINGS ===",
      "Billed prep line items on paid invoices vs typical 3PL FBA / FBM / cross-dock / return rates.",
      "Metric,Value",
      `Units prepped,${s.prep.unitCount}`,
      `You paid on prep,${money(s.prep.paidTotal)}`,
      `Paid FBA prep,${money(s.prep.paidFba)}`,
      `Paid FBM pick/pack,${money(s.prep.paidFbm)}`,
      `Paid cross-dock,${money(s.prep.paidCrossdock)}`,
      `Paid returns handling,${money(s.prep.paidReturns)}`,
      `Typical 3PL total (est.),${money(s.prep.estimatedMarket)}`,
      `Est. save on prep,${money(s.prep.savedOnPrep)}`,
      `Typical FBA / unit,${money(s.prep.benchmarks.fbaPerUnit)}`,
      `Typical FBM / unit,${money(s.prep.benchmarks.fbmPerUnit)}`,
      `Typical cross-dock / unit,${money(s.prep.benchmarks.crossdockPerUnit)}`,
      `Typical returns / unit,${money(s.prep.benchmarks.returnsPerUnit)}`,
      "",
      "=== WEIGHT RATE CARD (approx) ===",
      ["Weight band", "USPS", "UPS", "FedEx"].map(csvEscape).join(","),
      ...s.benchmarks.bands.map((b) =>
        [b.label, formatReportMoney(b.usps), formatReportMoney(b.ups), formatReportMoney(b.fedex)]
          .map(csvEscape)
          .join(",")
      ),
      "",
      "=== LABEL DETAIL ===",
      [
        "Date",
        "Tracking",
        "Carrier",
        "Service",
        "Paid",
        "Weight (lb)",
        "Rate card",
        "Bought",
        "Est. USPS",
        "Saved vs USPS",
        "Est. UPS",
        "Saved vs UPS",
        "Est. FedEx",
        "Saved vs FedEx",
      ]
        .map(csvEscape)
        .join(","),
      ...s.rows.map((r) =>
        [
          r.purchasedAt.slice(0, 10),
          r.trackingNumber || "",
          r.carrier,
          r.service,
          money(r.paid),
          String(r.weightLb),
          r.weightBand,
          r.carrierFamily,
          money(r.estimatedUsps),
          money(r.savedVsUsps),
          money(r.estimatedUps),
          money(r.savedVsUps),
          money(r.estimatedFedex),
          money(r.savedVsFedex),
        ]
          .map(csvEscape)
          .join(",")
      )
    );
  }

  return lines.join("\r\n");
}
