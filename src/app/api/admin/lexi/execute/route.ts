import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-admin-auth";
import { loadLexiAdminProfile } from "@/lib/lexi/access";
import { writeLexiAuditLog } from "@/lib/lexi/audit";
import {
  lexiApproveInboundRequest,
  lexiCreateInboundRequest,
  lexiRejectInboundRequest,
} from "@/lib/lexi/inbound-actions-server";
import { lexiApproveOutboundRequest } from "@/lib/lexi/outbound-actions-server";
import { LEXI_CLIENT_ACTION_TYPES } from "@/lib/lexi/types";
import type {
  LexiInboundApprovePayload,
  LexiInboundCreatePayload,
  LexiOutboundApprovePayload,
  LexiPendingAction,
  LexiRejectPayload,
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

  if (LEXI_CLIENT_ACTION_TYPES.includes(action.type)) {
    return NextResponse.json({
      ok: false,
      delegateToClient: true,
      message: "This action runs in the admin browser against live warehouse/inventory functions.",
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
        message: `Inbound #${data.requestId} approved (clientUserId=${data.clientUserId}). Status: pending receive. To complete receive, use the same clientUserId and requestId.`,
        data,
      });
    }

    if (action.type === "inbound_reject") {
      const data = await lexiRejectInboundRequest(
        adminProfile,
        auth.uid,
        action.payload as LexiRejectPayload
      );
      await writeLexiAuditLog({
        adminUid: auth.uid,
        adminName: auth.name,
        actionType: "inbound_reject",
        summary: action.summary,
        payload: action.payload as unknown as Record<string, unknown>,
        result: data,
        ok: true,
      });
      return NextResponse.json({
        ok: true,
        message: `Inbound #${data.requestId} rejected.`,
        data,
      });
    }

    if (action.type === "outbound_approve") {
      const data = await lexiApproveOutboundRequest(
        adminProfile,
        auth.uid,
        action.payload as LexiOutboundApprovePayload
      );
      await writeLexiAuditLog({
        adminUid: auth.uid,
        adminName: auth.name,
        actionType: "outbound_approve",
        summary: action.summary,
        payload: action.payload as unknown as Record<string, unknown>,
        result: data,
        ok: true,
      });
      return NextResponse.json({
        ok: true,
        message: `Outbound #${data.requestId} approved and sent to warehouse pick.`,
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
