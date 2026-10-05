import { NextRequest, NextResponse } from "next/server";
import { requireCrmAutomation } from "@/lib/crm/crm-automation-auth";
import { listCrmTasksByScope } from "@/lib/crm/crm-leads-service";
import { getTodayDateInputInNJ } from "@/lib/nj-date";
import type { CrmTaskScope } from "@/lib/crm/types";

export const dynamic = "force-dynamic";

function parseScope(raw: string | null): CrmTaskScope {
  if (raw === "today" || raw === "due") return raw;
  return "overdue";
}

/**
 * Follow-up tasks for CRM automation.
 * - scope=overdue — follow-up date before today (America/New_York)
 * - scope=due — today + overdue (recommended for daily automation)
 * - scope=today — follow-up date is today only
 */
export async function GET(request: NextRequest) {
  const auth = await requireCrmAutomation(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const scope = parseScope(request.nextUrl.searchParams.get("scope"));

  try {
    const tasks = await listCrmTasksByScope(scope);
    return NextResponse.json({
      scope,
      timezone: "America/New_York",
      today: getTodayDateInputInNJ(),
      tasks,
      count: tasks.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load tasks." },
      { status: 500 }
    );
  }
}
