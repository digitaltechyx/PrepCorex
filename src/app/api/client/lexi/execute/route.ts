import { NextRequest, NextResponse } from "next/server";
import { writeLexiAuditLog } from "@/lib/lexi/audit";
import { requireLexiClient } from "@/lib/lexi/client-access";
import { lexiCreateInboundRequest } from "@/lib/lexi/inbound-actions-server";
import {
  LEXI_ENDUSER_BROWSER_ACTION_TYPES,
  LEXI_ENDUSER_SERVER_ACTION_TYPES,
  type LexiInboundCreatePayload,
  type LexiPendingAction,
} from "@/lib/lexi/types";

export async function POST(request: NextRequest) {
  const auth = await requireLexiClient(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: { action?: LexiPendingAction };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const action = body.action;
  if (!action?.type || !action.payload) {
    return NextResponse.json({ error: "action is required." }, { status: 400 });
  }

  const payloadUid = String(
    (action.payload as { clientUserId?: string }).clientUserId || ""
  ).trim();
  if (payloadUid && payloadUid !== auth.uid) {
    return NextResponse.json(
      { error: "You can only confirm actions for your own account." },
      { status: 403 }
    );
  }

  if (LEXI_ENDUSER_BROWSER_ACTION_TYPES.includes(action.type)) {
    return NextResponse.json({
      ok: false,
      delegateToClient: true,
      message: "This action runs in the browser for your account.",
      action,
    });
  }

  if (!LEXI_ENDUSER_SERVER_ACTION_TYPES.includes(action.type)) {
    return NextResponse.json(
      { error: "This action is not available in client LEXI." },
      { status: 400 }
    );
  }

  try {
    if (action.type === "inbound_create") {
      const data = await lexiCreateInboundRequest(
        auth.profile,
        auth.uid,
        {
          ...(action.payload as LexiInboundCreatePayload),
          clientUserId: auth.uid,
          clientUserName: auth.name,
        }
      );
      await writeLexiAuditLog({
        adminUid: auth.uid,
        adminName: auth.name,
        actionType: "client_inbound_create",
        summary: action.summary,
        payload: action.payload as unknown as Record<string, unknown>,
        result: { ...data, mode: "client" },
        ok: true,
      });
      return NextResponse.json({
        ok: true,
        message: `Inbound request created (#${data.requestId}). Status: pending approval.`,
        data,
      });
    }

    return NextResponse.json({ error: "Unsupported action type." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Action failed.";
    await writeLexiAuditLog({
      adminUid: auth.uid,
      adminName: auth.name,
      actionType: action.type,
      summary: action.summary,
      payload: action.payload as unknown as Record<string, unknown>,
      ok: false,
      result: { error: message, mode: "client" },
    });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
