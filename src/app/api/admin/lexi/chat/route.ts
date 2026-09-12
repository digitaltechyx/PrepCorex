import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-admin-auth";
import { loadLexiAdminProfile } from "@/lib/lexi/access";
import { writeLexiAuditLog } from "@/lib/lexi/audit";
import { runLexiChat } from "@/lib/lexi/run-chat";
import type { LexiChatMessage } from "@/lib/lexi/types";

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: { messages?: LexiChatMessage[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) {
    return NextResponse.json({ error: "messages array is required." }, { status: 400 });
  }

  const adminProfile = await loadLexiAdminProfile(auth.uid);
  if (!adminProfile) {
    return NextResponse.json({ error: "Admin profile not found." }, { status: 403 });
  }

  try {
    const result = await runLexiChat({ adminProfile, messages });
    await writeLexiAuditLog({
      adminUid: auth.uid,
      adminName: auth.name,
      actionType: "chat",
      summary: messages[messages.length - 1]?.content?.slice(0, 200) ?? "chat",
      ok: true,
      result: {
        pendingActionType: result.pendingAction?.type ?? null,
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "LEXI chat failed.";
    await writeLexiAuditLog({
      adminUid: auth.uid,
      adminName: auth.name,
      actionType: "chat",
      summary: message,
      ok: false,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
