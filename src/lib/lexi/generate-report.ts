import {
  endOfMonth,
  format,
  startOfMonth,
  startOfYear,
  subDays,
  subMonths,
} from "date-fns";
import { adminDb } from "@/lib/firebase-admin";
import { resolveLexiClient, assertLexiCanManageClient } from "@/lib/lexi/access";
import { buildAdminReportCsv } from "@/lib/admin-reports-csv";
import { filterActivitiesByReportType, moduleLabel } from "@/lib/admin-reports-modules";
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

const MONTH_ALIASES: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function parseFlexibleDate(raw: string, endOfDay: boolean): Date | null {
  const value = String(raw || "").trim();
  if (!value) return null;

  // YYYY-MM-DD or full ISO
  const direct = new Date(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(direct.getTime())) {
    return endOfDay
      ? new Date(direct.getFullYear(), direct.getMonth(), direct.getDate(), 23, 59, 59, 999)
      : new Date(direct.getFullYear(), direct.getMonth(), direct.getDate());
  }

  // YYYY-MM
  const ym = value.match(/^(\d{4})-(\d{1,2})$/);
  if (ym) {
    const year = Number(ym[1]);
    const month = Number(ym[2]) - 1;
    if (month >= 0 && month <= 11) {
      const d = new Date(year, month, 1);
      return endOfDay ? endOfMonth(d) : startOfMonth(d);
    }
  }

  return null;
}

function resolveNamedMonth(period?: string): { from: Date; to: Date; label: string } | null {
  const raw = String(period || "").trim().toLowerCase();
  if (!raw) return null;

  // 2026-09 or 2026-9
  const ym = raw.match(/^(\d{4})-(\d{1,2})$/);
  if (ym) {
    const year = Number(ym[1]);
    const month = Number(ym[2]) - 1;
    if (month >= 0 && month <= 11) {
      const d = new Date(year, month, 1);
      return {
        from: startOfMonth(d),
        to: endOfMonth(d),
        label: format(d, "MMMM yyyy"),
      };
    }
  }

  // "september", "sep 2026", "october 2026"
  const parts = raw.replace(/[_/]+/g, " ").split(/\s+/).filter(Boolean);
  let monthIdx: number | undefined;
  let year: number | undefined;
  for (const part of parts) {
    if (/^\d{4}$/.test(part)) {
      year = Number(part);
      continue;
    }
    if (MONTH_ALIASES[part] != null) monthIdx = MONTH_ALIASES[part];
  }
  if (monthIdx == null) return null;
  const now = new Date();
  const d = new Date(year ?? now.getFullYear(), monthIdx, 1);
  return {
    from: startOfMonth(d),
    to: endOfMonth(d),
    label: format(d, "MMMM yyyy"),
  };
}

function resolvePeriod(period?: string, fromIso?: string, toIso?: string): {
  from: Date;
  to: Date;
  allTime: boolean;
  label: string;
} {
  const now = new Date();
  if (fromIso || toIso) {
    const from = parseFlexibleDate(String(fromIso || ""), false);
    const to = parseFlexibleDate(String(toIso || fromIso || ""), true);
    if (from && to && !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) {
      return {
        from,
        to,
        allTime: false,
        label: `${format(from, "MMM d, yyyy")} – ${format(to, "MMM d, yyyy")}`,
      };
    }
  }

  const named = resolveNamedMonth(period);
  if (named) {
    return { ...named, allTime: false };
  }

  switch (String(period || "this_month").toLowerCase()) {
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
      return {
        from: startOfMonth(d),
        to: endOfMonth(d),
        allTime: false,
        label: format(d, "MMMM yyyy"),
      };
    }
    case "this_year":
      return { from: startOfYear(now), to: now, allTime: false, label: "This year" };
    case "this_month":
    default:
      return {
        from: startOfMonth(now),
        to: now,
        allTime: false,
        label: format(now, "MMMM yyyy"),
      };
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
    const rowCount = Math.max(0, csv.split(/\r?\n/).length - 4);
    const filename = `lexi-inventory-${clientName || clientId}-${Date.now()}.csv`.replace(/\s+/g, "-");
    return {
      summary: {
        reportType: "inventory",
        scope: clientName,
        period: "Current snapshot",
        rowCount,
        isEmpty: rowCount === 0,
        note:
          rowCount > 0
            ? `Found ${rowCount} inventory row(s). CSV is ready to download. Summarize these numbers — do NOT say there are no records.`
            : "CSV is ready. This inventory snapshot has 0 product rows.",
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

  const moduleActivities = filterActivitiesByReportType(summary.rows.activities, reportType);
  const activityRowCount =
    reportType === "inbound" ||
    reportType === "outbound" ||
    reportType === "returns" ||
    reportType === "dispose"
      ? moduleActivities.length
      : summary.rows.activities.length;

  const csv = buildAdminReportCsv(summary, reportType);
  const scope = summary.scope.allClients ? "all-clients" : summary.scope.clientName || "client";
  const filename = `lexi-${reportType}-${scope}-${Date.now()}.csv`.replace(/\s+/g, "-");
  const isEmpty = activityRowCount === 0 && summary.clientActivity.inventoryRequests === 0;

  return {
    summary: {
      reportType,
      label: moduleLabel(reportType),
      period: summary.period.label,
      periodFrom: summary.period.from,
      periodTo: summary.period.to,
      scope: summary.scope.allClients ? "All clients" : summary.scope.clientName || clientName || clientId,
      scopeClientId: summary.scope.clientId || clientId || null,
      activityRowCount,
      inventoryRequests: summary.clientActivity.inventoryRequests,
      unitsReceived: summary.clientActivity.lifetimeInboundReceived,
      unitsShipped: summary.clientActivity.unitsShipped,
      shipmentRequests: summary.clientActivity.shipmentRequests,
      currentStockOnHand: summary.clientActivity.currentStockOnHand,
      financial: summary.financial,
      activity: summary.clientActivity,
      sampleActivities: moduleActivities.slice(0, 8).map((row) => ({
        type: row.type,
        description: row.description,
        quantity: row.quantity ?? null,
        status: row.status ?? null,
        occurredAt: row.occurredAt,
      })),
      isEmpty,
      note: isEmpty
        ? `No ${moduleLabel(reportType).toLowerCase()} activity rows in ${summary.period.label} for this scope. CSV still attached (headers/summary only).`
        : `Found ${activityRowCount} activity row(s) in ${summary.period.label}. CSV is ready to download. Summarize these numbers — do NOT say there are no records.`,
    },
    report: {
      title: `${moduleLabel(reportType)} — ${summary.period.label}`,
      filename,
      csv,
    },
  };
}
