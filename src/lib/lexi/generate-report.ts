import {
  endOfMonth,
  format,
  startOfMonth,
  startOfYear,
  subDays,
  subMonths,
} from "date-fns";
import { resolveLexiClient, assertLexiCanManageClient } from "@/lib/lexi/access";
import { buildAdminReportCsv } from "@/lib/admin-reports-csv";
import { filterActivitiesByReportType, moduleLabel } from "@/lib/admin-reports-modules";
import { buildAdminReport } from "@/lib/admin-reports-server";
import type { AdminReportType } from "@/lib/admin-reports-types";
import {
  buildLexiClientInboundReport,
  buildLexiClientInventoryReport,
  buildLexiClientOutboundReport,
} from "@/lib/lexi/lexi-client-module-report";
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

  // YYYY-MM-DD as local calendar date (avoid UTC shift from Date.parse)
  const ymd = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymd) {
    const d = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
    if (!Number.isNaN(d.getTime())) {
      return endOfDay
        ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
        : new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
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

  // "september", "sep and october", "sep-oct 2026", "october 2026"
  const parts = raw.replace(/[_/,]+/g, " ").split(/\s+/).filter(Boolean);
  const now = new Date();
  let year: number | undefined;
  const months: number[] = [];
  for (const part of parts) {
    if (/^\d{4}$/.test(part)) {
      year = Number(part);
      continue;
    }
    if (MONTH_ALIASES[part] != null) months.push(MONTH_ALIASES[part]);
  }
  if (months.length === 0) return null;
  const y = year ?? now.getFullYear();
  const startMonth = Math.min(...months);
  const endMonth = Math.max(...months);
  const from = startOfMonth(new Date(y, startMonth, 1));
  const to = endOfMonth(new Date(y, endMonth, 1));
  const label =
    startMonth === endMonth
      ? format(from, "MMMM yyyy")
      : `${format(from, "MMM yyyy")} - ${format(to, "MMM yyyy")}`;
  return { from, to, label };
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
        // Avoid commas in the label so Excel CSV columns don't split the period.
        label: `${format(from, "MMM d yyyy")} - ${format(to, "MMM d yyyy")}`,
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

    // Period-aware inventory-only export (Inventory table). Never mixes inbound requests.
    const inventory = await buildLexiClientInventoryReport({
      clientUserId: clientId,
      clientUserName: clientName || clientId,
      from: period.from,
      to: period.to,
      allTime: period.allTime,
    });
    const filename = `lexi-inventory-${clientName || clientId}-${Date.now()}.csv`.replace(/\s+/g, "-");
    return {
      summary: {
        reportType: "inventory",
        label: "Inventory",
        scope: clientName,
        period: inventory.periodLabel,
        rowCount: inventory.rowCount,
        unitsOnHandInPeriod: inventory.unitsOnHandInPeriod,
        currentStockOnHand: inventory.currentStockOnHand,
        includes: "inventory_products_only",
        excludes: "inbound_requests",
        sampleRows: inventory.rows.slice(0, 10).map((row) => ({
          productName: row.productName,
          sku: row.sku,
          quantity: row.quantity,
          dateAdded: row.dateAdded,
          receivingDate: row.receivingDate,
        })),
        isEmpty: inventory.rowCount === 0,
        note:
          inventory.rowCount > 0
            ? `Found ${inventory.rowCount} inventory product(s) in ${inventory.periodLabel}. CSV is inventory-only (no inbound requests). Do NOT say there are no records.`
            : `No inventory products matched ${inventory.periodLabel}. Current stock on hand (all) is ${inventory.currentStockOnHand}.`,
      },
      report: {
        title: `Inventory — ${inventory.periodLabel}`,
        filename,
        csv: inventory.csv,
      },
    };
  }

  const reportType: AdminReportType = REPORT_TYPES.has(rawType as AdminReportType)
    ? (rawType as AdminReportType)
    : "overview";

  // Single-client inbound/outbound: read that user's collections directly so Lexi
  // matches Inventory Date Added / Receiving Date (collectionGroup admin reports were empty).
  if (clientId && reportType === "inbound") {
    const inbound = await buildLexiClientInboundReport({
      clientUserId: clientId,
      clientUserName: clientName || clientId,
      from: period.from,
      to: period.to,
      allTime: period.allTime,
    });
    const activityRowCount = inbound.rows.length;
    const isEmpty = activityRowCount === 0;
    const filename = `lexi-inbound-${clientName || clientId}-${Date.now()}.csv`.replace(/\s+/g, "-");
    return {
      summary: {
        reportType: "inbound",
        label: "Inbound",
        period: inbound.periodLabel,
        scope: clientName || clientId,
        scopeClientId: clientId,
        activityRowCount,
        inventoryRequests: inbound.inventoryRequestCount,
        unitsReceived: inbound.unitsReceived,
        currentStockOnHand: inbound.currentStockOnHand,
        includes: "inbound_requests_only",
        excludes: "inventory_table_products",
        sampleActivities: inbound.rows.slice(0, 10).map((row) => ({
          type: row.type,
          description: row.description,
          sku: row.sku,
          quantity: row.quantity,
          status: row.status,
          occurredAt: row.occurredAt,
          dateAdded: row.dateAdded,
          receivingDate: row.receivingDate,
        })),
        isEmpty,
        note: isEmpty
          ? `No inbound requests in ${inbound.periodLabel}. Current stock on hand is ${inbound.currentStockOnHand}. If they wanted Inventory table products, use reportType inventory.`
          : `Found ${inbound.inventoryRequestCount} inbound request(s) in ${inbound.periodLabel}. CSV is inbound-requests-only (no Inventory table products). Do NOT say there are no records.`,
      },
      report: {
        title: `Inbound requests — ${inbound.periodLabel}`,
        filename,
        csv: inbound.csv,
      },
    };
  }

  if (clientId && reportType === "outbound") {
    const outbound = await buildLexiClientOutboundReport({
      clientUserId: clientId,
      clientUserName: clientName || clientId,
      from: period.from,
      to: period.to,
      allTime: period.allTime,
    });
    const activityRowCount = outbound.rows.length;
    const isEmpty = activityRowCount === 0;
    const filename = `lexi-outbound-${clientName || clientId}-${Date.now()}.csv`.replace(/\s+/g, "-");
    return {
      summary: {
        reportType: "outbound",
        label: "Outbound",
        period: outbound.periodLabel,
        scope: clientName || clientId,
        scopeClientId: clientId,
        activityRowCount,
        unitsShipped: outbound.unitsShipped,
        shipmentRequests: outbound.shipmentRequestCount,
        sampleActivities: outbound.rows.slice(0, 10).map((row) => ({
          type: row.type,
          description: row.description,
          sku: row.sku,
          quantity: row.quantity,
          status: row.status,
          occurredAt: row.occurredAt,
        })),
        isEmpty,
        note: isEmpty
          ? `No outbound activity in ${outbound.periodLabel}.`
          : `Found ${activityRowCount} outbound row(s) in ${outbound.periodLabel}. CSV is ready — do NOT say there are no records.`,
      },
      report: {
        title: `Outbound — ${outbound.periodLabel}`,
        filename,
        csv: outbound.csv,
      },
    };
  }

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
