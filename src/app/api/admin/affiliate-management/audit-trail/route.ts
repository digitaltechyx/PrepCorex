import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/api-admin-auth";
import {
  appendAffiliateAuditEvent,
  getAffiliateAuditTrail,
} from "@/lib/affiliate-audit-trail-server";

export const dynamic = "force-dynamic";

const postSchema = z.object({
  agentId: z.string().min(1),
  agentName: z.string().max(200).optional().nullable(),
  type: z.enum([
    "commission_created",
    "commission_paid",
    "agent_approved",
    "agent_rejected",
    "agent_deleted",
    "agent_restored",
    "client_referred",
    "tier_snapshot",
  ]),
  action: z.string().max(500).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  performedByUid: z.string().max(128).optional().nullable(),
  performedByName: z.string().max(200).optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
});

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const agentId = request.nextUrl.searchParams.get("agentId")?.trim() || undefined;
  const limitParam = request.nextUrl.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam) || 500, 1), 2000);

  try {
    const events = await getAffiliateAuditTrail({ agentId, limit });
    return NextResponse.json({ events, count: events.length });
  } catch (e) {
    console.error("[GET /api/admin/affiliate-management/audit-trail]", e);
    return NextResponse.json({ error: "Failed to load affiliate audit trail." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: z.infer<typeof postSchema>;
  try {
    body = postSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    const id = await appendAffiliateAuditEvent({
      ...body,
      performedByUid: body.performedByUid || auth.uid,
      performedByName: body.performedByName || auth.name || null,
    });
    return NextResponse.json({ success: true, id });
  } catch (e) {
    console.error("[POST /api/admin/affiliate-management/audit-trail]", e);
    return NextResponse.json({ error: "Failed to write affiliate audit event." }, { status: 500 });
  }
}
