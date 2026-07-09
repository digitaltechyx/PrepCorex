import type { AdminReportActivityRow, AdminReportType } from "@/lib/admin-reports-types";

export const MODULE_ACTIVITY_TYPES: Record<string, string[]> = {
  inbound: ["Inventory Received", "Inventory Request"],
  outbound: ["Units Shipped", "Shipment Request"],
  returns: ["Product Return"],
  dispose: ["Dispose Request"],
};

const MODULE_REPORT_TYPES = new Set(["inbound", "outbound", "returns", "dispose"]);

export function isModuleReportType(reportType: AdminReportType): boolean {
  return MODULE_REPORT_TYPES.has(reportType);
}

export function filterActivitiesByReportType(
  activities: AdminReportActivityRow[],
  reportType: AdminReportType
): AdminReportActivityRow[] {
  if (!isModuleReportType(reportType)) return activities;
  const allowed = MODULE_ACTIVITY_TYPES[reportType] || [];
  return activities.filter((row) => allowed.includes(row.type));
}

export function moduleLabel(reportType: AdminReportType): string {
  switch (reportType) {
    case "inbound":
      return "Inbound";
    case "outbound":
      return "Outbound";
    case "returns":
      return "Product Returns";
    case "dispose":
      return "Dispose";
    case "full":
      return "Full Report";
    case "comparison":
      return "Comparison";
    default:
      return reportType;
  }
}
