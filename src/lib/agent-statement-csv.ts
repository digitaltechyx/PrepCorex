import type { AgentStatementSummary } from "@/lib/admin-reports-types";
import { csvEscape } from "@/lib/admin-reports-utils";

export function buildAgentStatementCsv(summary: AgentStatementSummary): string {
  const lines: string[] = [
    "PrepCorex Commission Agent Statement",
    `Agent,${csvEscape(summary.agent.name)}`,
    `Email,${csvEscape(summary.agent.email)}`,
    `Referral Code,${csvEscape(summary.agent.referralCode || "")}`,
    `Tier,${csvEscape(`${summary.agent.tier} (${summary.agent.rate}%)`)}`,
    `Period,${csvEscape(summary.period.label)}`,
    "",
    "=== EARNINGS SUMMARY ===",
    "Metric,Value",
    `Total Earned,${summary.earnings.totalEarned.toFixed(2)}`,
    `Pending Payout,${summary.earnings.totalPending.toFixed(2)}`,
    `Paid Out,${summary.earnings.totalPaid.toFixed(2)}`,
    `Qualified Client Revenue,${summary.earnings.qualifiedRevenue.toFixed(2)}`,
    `Commission Records,${summary.earnings.commissionCount}`,
    `Earnings Growth,${summary.growth.earningsChangePct !== null ? `${summary.growth.earningsChangePct.toFixed(1)}%` : "N/A"}`,
    "",
    "=== REFERRED CLIENTS ===",
    ["Client Name", "Email", "Status"].map(csvEscape).join(","),
    ...summary.rows.referredClients.map((c) =>
      [c.name, c.email, c.status || "approved"].map(csvEscape).join(",")
    ),
    "",
    "=== COMMISSION DETAIL ===",
    ["Client", "Invoice #", "Invoice Amount", "Rate %", "Tier", "Commission", "Status", "Date", "Paid At"].map(csvEscape).join(","),
    ...summary.rows.commissions.map((r) =>
      [
        r.clientName,
        r.invoiceNumber,
        r.invoiceAmount.toFixed(2),
        r.commissionRate?.toString() || "",
        r.tier || "",
        r.commissionAmount.toFixed(2),
        r.status,
        r.createdAt.slice(0, 10),
        r.paidAt?.slice(0, 10) || "",
      ]
        .map(csvEscape)
        .join(",")
    ),
  ];
  return lines.join("\r\n");
}
