import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-admin-auth";
import {
  applyClientAccountStatusAction,
  type ClientAccountStatusAction,
} from "@/lib/client-account-status-server";
import { getAuditRequestMeta } from "@/lib/user-audit-request-meta";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ uid: string }> };

const ACTIONS: ClientAccountStatusAction[] = [
  "lock",
  "unlock",
  "disable",
  "enable",
  "delete",
  "restore",
];

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { uid } = await context.params;
  if (!uid?.trim()) {
    return NextResponse.json({ error: "User id is required." }, { status: 400 });
  }

  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const action = String(body.action || "").trim() as ClientAccountStatusAction;
  if (!ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Invalid account action." }, { status: 400 });
  }

  try {
    const result = await applyClientAccountStatusAction(uid.trim(), action, {
      reason: "manual",
      meta: getAuditRequestMeta(request),
      performedByUid: auth.uid,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[POST /api/admin/users/account-status]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update account status." },
      { status: 500 }
    );
  }
}
