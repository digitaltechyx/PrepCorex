import { endOfMonth, startOfMonth, startOfYear, subDays, subMonths } from "date-fns";
import { adminDb } from "@/lib/firebase-admin";
import { resolveLexiClient, assertLexiCanManageClient } from "@/lib/lexi/access";
import { buildAdminReportCsv } from "@/lib/admin-reports-csv";
import { moduleLabel } from "@/lib/admin-reports-modules";
import { buildAdminReport } from "@/lib/admin-reports-server";
import type { AdminReportType } from "@/lib/admin-reports-types";
import type { LexiReportAttachment } from "@/lib/lexi/types";
import type { UserProfile } from "@/types";

const REPORT_TYPES = new Set<AdminReportType>([
  "overview",
  "full",
  "financial",
  "commission",
  "client_activity",
  "operations",
  "inbound",
  "outbound",
  "returns",
  "dispose",
  "audit",
]);

function resolvePeriod(period?: string, fromIso?: string, toIso?: string): {
  from: Date;
  to: Date;
  allTime: boolean;
  label: string;
} {
  const now = new Date();
  if (fromIso && toIso) {
    const from = new Date(fromIso);
    const to = new Date(toIso);
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) {
      return { from, to, allTime: false, label: `${fromIso} to ${toIso}` };
    }
  }
  switch (String(period || "this_month")) {
    case "all_time":
      return { from: new Date(2020, 0, 1), to: now, allTime: true, label: "All time" };
    case "today":
      return { from: now, to: now, allTime: false, label: "Today" };
    case "last_7_days":
      return { from: subDays(now, 7), to: now, allTime: false, label: "Last 7 days" };
    case "last_30_days":
      return { from: subDays(now, 30), to: now, allTime: false, label: "Last 30 days" };
    case "last_month": {
      const d = subMonths(now, 1);
      return { from: startOfMonth(d), to: endOfMonth(d), allTime: false, label: "Last month" };
    }
    case "this_year":
      return { from: startOfYear(now), to: now, allTime: false, label: "This year" };
    default:
      return { from: startOfMonth(now), to: now, allTime: false, label: "This month" };
  }
}

function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function inventoryCsv(clientUserId: string, clientName: string): Promise<string> {
  const snap = await adminDb().collection(`users/${clientUserId}/inventory`).get();
  const header = ["Product", "SKU", "Quantity", "Status"];
  const rows = snap.docs.map((d) => {
    const data = d.data();
    return [
      csvEscape(data.productName),
      csvEscape(data.sku),
      csvEscape(data.quantity ?? 0),
      csvEscape(data.status),
    ].join(",");
  });
  return [`Client,${csvEscape(clientName)}`, `Report,Inventory snapshot`, "", header.join(","), ...rows].join("\r\n");
}

export async function lexiGenerateReport(
  adminProfile: UserProfile,
  args: {
    reportType?: string;
    period?: string;
    from?: string;
    to?: string;
    clientUserId?: string;
    clientUserName?: string;
  }
): Promise<{ summary: Record<string, unknown>; report: LexiReportAttachment }> {
  const rawType = String(args.reportType || "overview").toLowerCase();
  const period = resolvePeriod(args.period, args.from, args.to);

  let clientId: string | undefined;
  let clientName: string | undefined;
  if (args.clientUserId || args.clientUserName) {
    const client = await resolveLexiClient(
      adminProfile,
      String(args.clientUserId ?? ""),
      args.clientUserName
    );
    await assertLexiCanManageClient(adminProfile, client.uid);
    clientId = client.uid;
    clientName = client.name;
  }

  if (rawType === "inventory" || rawType === "stock") {
    if (!clientId) {
      throw new Error("Inventory/stock reports need a client. Ask which client, then generate again.");
    }
    const csv = await inventoryCsv(clientId, clientName || clientId);
    const filename = `lexi-inventory-${clientName || clientId}-${Date.now()}.csv`.replace(/\s+/g, "-");
    return {
      summary: {
        reportType: "inventory",
        scope: clientName,
        period: "Current snapshot",
        rowCount: csv.split(/\r?\n/).length - 4,
        note: "CSV is ready to download in the chat.",
      },
      report: {
        title: `Inventory — ${clientName}`,
        filename,
        csv,
      },
    };
  }

  const reportType: AdminReportType = REPORT_TYPES.has(rawType as AdminReportType)
    ? (rawType as AdminReportType)
    : "overview";

  const summary = await buildAdminReport({
    from: period.from,
    to: period.to,
    allTime: period.allTime,
    clientId,
    reportType,
    callerUid: String(adminProfile.uid ?? ""),
  });

  const csv = buildAdminReportCsv(summary, reportType);
  const scope = summary.scope.allClients ? "all-clients" : summary.scope.clientName || "client";
  const filename = `lexi-${reportType}-${scope}-${Date.now()}.csv`.replace(/\s+/g, "-");

  return {
    summary: {
      reportType,
      label: moduleLabel(reportType),
      period: summary.period.label,
      scope: summary.scope.allClients ? "All clients" : summary.scope.clientName,
      financial: summary.financial,
      activity: summary.clientActivity,
      topClients: summary.charts.topClientsByRevenue.slice(0, 5),
      note: "CSV is ready to download in the chat. Summarize these numbers for the admin.",
    },
    report: {
      title: `${moduleLabel(reportType)} — ${summary.period.label}`,
      filename,
      csv,
    },
  };
}
