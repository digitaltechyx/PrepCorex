import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyBearerToken } from "@/lib/api-admin-auth";
import { getAuditRequestMeta } from "@/lib/user-audit-request-meta";
import { appendUserAuditEvent } from "@/lib/user-audit-trail-server";
import type { UserAuditEventType } from "@/types";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  type: z.enum([
    "account_created",
    "sign_in",
    "sign_out",
    "account_approved",
    "profile_completed",
    "account_activated",
    "user_action",
  ]),
  action: z.string().max(500).optional(),
  description: z.string().max(2000).optional(),
  sessionId: z.string().max(128).optional(),
  sessionStartedAt: z.string().max(64).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export async function POST(request: NextRequest) {
  const decoded = await verifyBearerToken(request);
  if (!decoded?.uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    const json = await request.json();
    body = bodySchema.parse(json);
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const clientMeta = body.metadata || {};
  const meta = getAuditRequestMeta(request);
  if (typeof clientMeta.userAgent === "string" && !meta.userAgent) {
    meta.userAgent = clientMeta.userAgent;
  }

  try {
    const id = await appendUserAuditEvent(decoded.uid, {
      type: body.type as UserAuditEventType,
      action: body.action,
      description: body.description,
      meta,
      sessionId: body.sessionId,
      sessionStartedAt: body.sessionStartedAt,
      metadata: body.metadata,
    });
    return NextResponse.json({ success: true, id });
  } catch (e) {
    console.error("[POST /api/audit/log]", e);
    return NextResponse.json({ error: "Failed to write audit log." }, { status: 500 });
  }
}
