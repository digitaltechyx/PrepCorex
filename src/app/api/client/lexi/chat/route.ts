import { NextRequest, NextResponse } from "next/server";
import { writeLexiAuditLog } from "@/lib/lexi/audit";
import { requireLexiClient } from "@/lib/lexi/client-access";
import { runLexiClientChat } from "@/lib/lexi/run-client-chat";
import type { LexiChatMessage } from "@/lib/lexi/types";

export async function POST(request: NextRequest) {
  const auth = await requireLexiClient(request);
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

  try {
    const result = await runLexiClientChat({
      clientProfile: auth.profile,
      messages,
    });
    await writeLexiAuditLog({
      adminUid: auth.uid,
      adminName: auth.name,
      actionType: "client_chat",
      summary: messages[messages.length - 1]?.content?.slice(0, 200) ?? "client_chat",
      ok: true,
      result: {
        pendingActionType: result.pendingAction?.type ?? null,
        mode: "client",
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "LEXI chat failed.";
    await writeLexiAuditLog({
      adminUid: auth.uid,
      adminName: auth.name,
      actionType: "client_chat",
      summary: message,
      ok: false,
      result: { mode: "client" },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
