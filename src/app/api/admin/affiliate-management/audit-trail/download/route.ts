import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-admin-auth";
import { affiliateDateRangeLabel } from "@/lib/affiliate-date-filter";
import {
  affiliateAuditEventsToCsv,
  enrichAffiliateAuditWithCommissions,
  filterAffiliateAuditEvents,
  getAffiliateAuditTrail,
} from "@/lib/affiliate-audit-trail-server";

export const dynamic = "force-dynamic";

function parseDateParam(value: string | null): Date | undefined {
  if (!value?.trim()) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const agentId = request.nextUrl.searchParams.get("agentId")?.trim() || undefined;
  const agentName = request.nextUrl.searchParams.get("agentName")?.trim() || undefined;
  const from = parseDateParam(request.nextUrl.searchParams.get("from"));
  const to = parseDateParam(request.nextUrl.searchParams.get("to"));
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam) || 2000, 1), 5000);

  try {
    let events = await getAffiliateAuditTrail({ agentId, limit: agentId ? 5000 : limit, from, to });
    if (agentId) {
      events = await enrichAffiliateAuditWithCommissions(agentId, agentName, events);
      events = filterAffiliateAuditEvents(events, from, to);
      events = events.slice(0, limit);
    }
    const csv = affiliateAuditEventsToCsv(events, agentName);
    const rangeLabel = affiliateDateRangeLabel(from, to);
    const filename = agentId
      ? `affiliate-audit_${agentId}_${rangeLabel}.csv`
      : `affiliate-audit_all_${rangeLabel}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    console.error("[GET /api/admin/affiliate-management/audit-trail/download]", e);
    return NextResponse.json({ error: "Failed to download affiliate audit trail." }, { status: 500 });
  }
}
