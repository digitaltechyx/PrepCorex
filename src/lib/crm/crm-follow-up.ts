import {
  compareDateInputs,
  getCalendarPartsInNJ,
  getTodayDateInputInNJ,
  parseDateOnlyLocal,
} from "@/lib/nj-date";
import type { CrmLeadRecord, CrmTaskScope } from "@/lib/crm/types";

export function normalizeFollowUpDateInput(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
    if (match) return match[1];
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) {
      const { year, month, day } = getCalendarPartsInNJ(new Date(parsed));
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    return null;
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const { year, month, day } = getCalendarPartsInNJ(value);
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

export function leadMatchesFollowUpScope(
  lead: Pick<CrmLeadRecord, "followUpDate">,
  scope: CrmTaskScope,
  todayInput = getTodayDateInputInNJ()
): boolean {
  const date = lead.followUpDate;
  if (!date) return false;
  const cmp = compareDateInputs(date, todayInput);
  if (scope === "overdue") return cmp < 0;
  if (scope === "today") return cmp === 0;
  // due: today + overdue (automation-friendly; does not hide missed follow-ups)
  return cmp <= 0;
}

export function sortLeadsByFollowUpDate(
  leads: CrmLeadRecord[],
  direction: "asc" | "desc" = "asc"
): CrmLeadRecord[] {
  return [...leads].sort((a, b) => {
    const da = a.followUpDate ? parseDateOnlyLocal(a.followUpDate)?.getTime() ?? 0 : 0;
    const db = b.followUpDate ? parseDateOnlyLocal(b.followUpDate)?.getTime() ?? 0 : 0;
    return direction === "asc" ? da - db : db - da;
  });
}
