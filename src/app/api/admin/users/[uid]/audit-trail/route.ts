import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-admin-auth";
import { getUserAuditTrailForAdmin } from "@/lib/user-audit-trail-server";

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
  const limit = Math.min(Math.max(Number(limitParam) || 500, 1), 2000);

  try {
    const { events, userLabel } = await getUserAuditTrailForAdmin(uid.trim(), limit);
    return NextResponse.json({ events, userLabel, count: events.length });
  } catch (e) {
    console.error("[GET /api/admin/users/audit-trail]", e);
    return NextResponse.json({ error: "Failed to load audit trail." }, { status: 500 });
  }
}
