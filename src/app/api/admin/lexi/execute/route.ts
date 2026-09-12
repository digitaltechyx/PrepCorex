import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-admin-auth";
import { loadLexiAdminProfile } from "@/lib/lexi/access";
import { writeLexiAuditLog } from "@/lib/lexi/audit";
import {
  lexiApproveInboundRequest,
  lexiCreateInboundRequest,
} from "@/lib/lexi/inbound-actions-server";
import type {
  LexiInboundApprovePayload,
  LexiInboundCreatePayload,
  LexiPendingAction,
} from "@/lib/lexi/types";

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
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

  if (action.type === "inbound_complete") {
    return NextResponse.json({
      ok: false,
      delegateToClient: true,
      message: "Complete receive runs in the browser with warehouse putaway.",
      action,
    });
  }

  const adminProfile = await loadLexiAdminProfile(auth.uid);
  if (!adminProfile) {
    return NextResponse.json({ error: "Admin profile not found." }, { status: 403 });
  }

  try {
    if (action.type === "inbound_create") {
      const data = await lexiCreateInboundRequest(
        adminProfile,
        auth.uid,
        action.payload as LexiInboundCreatePayload
      );
      await writeLexiAuditLog({
        adminUid: auth.uid,
        adminName: auth.name,
        actionType: "inbound_create",
        summary: action.summary,
        payload: action.payload as unknown as Record<string, unknown>,
        result: data,
        ok: true,
      });
      return NextResponse.json({
        ok: true,
        message: `Inbound request created for ${data.clientUserName} (#${data.requestId}). Status: pending approval.`,
        data,
      });
    }

    if (action.type === "inbound_approve") {
      const data = await lexiApproveInboundRequest(
        adminProfile,
        auth.uid,
        action.payload as LexiInboundApprovePayload
      );
      await writeLexiAuditLog({
        adminUid: auth.uid,
        adminName: auth.name,
        actionType: "inbound_approve",
        summary: action.summary,
        payload: action.payload as unknown as Record<string, unknown>,
        result: data,
        ok: true,
      });
      return NextResponse.json({
        ok: true,
        message: `Inbound #${data.requestId} approved. Status: pending receive.`,
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
      result: { error: message },
    });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
