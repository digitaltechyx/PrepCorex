import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-admin-auth";
import {
  affiliateAuditEventsToCsv,
  enrichAffiliateAuditWithCommissions,
  getAffiliateAuditTrail,
} from "@/lib/affiliate-audit-trail-server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const agentId = request.nextUrl.searchParams.get("agentId")?.trim() || undefined;
  const agentName = request.nextUrl.searchParams.get("agentName")?.trim() || undefined;
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam) || 2000, 1), 5000);

  try {
    let events = await getAffiliateAuditTrail({ agentId, limit });
    if (agentId) {
      events = await enrichAffiliateAuditWithCommissions(agentId, agentName, events);
      events = events.slice(0, limit);
    }
    const csv = affiliateAuditEventsToCsv(events, agentName);
    const filename = agentId
      ? `affiliate-audit_${agentId}.csv`
      : "affiliate-audit_all.csv";

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
