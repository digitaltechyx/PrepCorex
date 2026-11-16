import { NextRequest, NextResponse } from "next/server";
import { writeLexiAuditLog } from "@/lib/lexi/audit";
import { requireLexiClient } from "@/lib/lexi/client-access";
import { runLexiClientTool } from "@/lib/lexi/client-tools";

type ProposeBody = {
  kind?: "inbound_create" | "outbound_create";
  fields?: Record<string, unknown>;
};

export async function POST(request: NextRequest) {
  const auth = await requireLexiClient(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: ProposeBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const kind = body.kind;
  const fields = body.fields && typeof body.fields === "object" ? body.fields : {};
  if (kind !== "inbound_create" && kind !== "outbound_create") {
    return NextResponse.json({ error: "Unsupported form kind." }, { status: 400 });
  }

  const toolName =
    kind === "inbound_create" ? "propose_inbound_create" : "propose_outbound_create";

  try {
    const result = await runLexiClientTool(auth.profile, toolName, {
      ...fields,
      clientUserId: auth.uid,
      clientUserName: auth.name,
    });

    if (!result.pendingAction) {
      let error = "Could not prepare that request.";
      try {
        const parsed = JSON.parse(result.toolResult) as { error?: string };
        if (parsed.error) error = parsed.error;
      } catch {
        /* ignore */
      }
      return NextResponse.json({ error }, { status: 400 });
    }

    await writeLexiAuditLog({
      adminUid: auth.uid,
      adminName: auth.name,
      actionType: `client_form_${kind}`,
      summary: result.pendingAction.summary,
      payload: result.pendingAction.payload as unknown as Record<string, unknown>,
      ok: true,
      result: { mode: "client_form" },
    });

    return NextResponse.json({
      reply:
        kind === "inbound_create"
          ? "Inbound details captured from the form. Review the summary and Confirm to create the pending request."
          : "Outbound details captured from the form. Review the summary and Confirm to create the pending shipment.",
      pendingAction: result.pendingAction,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not prepare that request.";
    await writeLexiAuditLog({
      adminUid: auth.uid,
      adminName: auth.name,
      actionType: `client_form_${kind}`,
      summary: message,
      ok: false,
      result: { mode: "client_form" },
    });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
