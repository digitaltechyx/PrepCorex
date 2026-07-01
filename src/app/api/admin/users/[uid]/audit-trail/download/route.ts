import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-admin-auth";
import { auditEventsToCsv, getUserAuditTrailForAdmin } from "@/lib/user-audit-trail-server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ uid: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { uid } = await context.params;
  if (!uid?.trim()) {
    return NextResponse.json({ error: "User id is required." }, { status: 400 });
  }

  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam) || 2000, 1), 5000);

  try {
    const { events, userLabel } = await getUserAuditTrailForAdmin(uid.trim(), limit);
    const csv = auditEventsToCsv(events, userLabel);
    const safeName = userLabel.replace(/[^\w.-]+/g, "_").slice(0, 80) || uid.trim();
    const filename = `audit-trail_${safeName}_${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    console.error("[GET /api/admin/users/audit-trail/download]", e);
    return NextResponse.json({ error: "Failed to export audit trail." }, { status: 500 });
  }
}
