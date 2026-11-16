import { NextRequest, NextResponse } from "next/server";
import { writeLexiAuditLog } from "@/lib/lexi/audit";
import { requireLexiClient } from "@/lib/lexi/client-access";
import { lexiGenerateReport } from "@/lib/lexi/generate-report";

type ReportBody = {
  reportType?: string;
  period?: string;
  from?: string;
  to?: string;
};

export async function POST(request: NextRequest) {
  const auth = await requireLexiClient(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: ReportBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const reportType = String(body.reportType || "").trim().toLowerCase();
  if (!reportType) {
    return NextResponse.json({ error: "reportType is required." }, { status: 400 });
  }

  try {
    const generated = await lexiGenerateReport(auth.profile, {
      reportType,
      period: body.period ? String(body.period) : undefined,
      from: body.from ? String(body.from) : undefined,
      to: body.to ? String(body.to) : undefined,
      clientUserId: auth.uid,
      clientUserName: auth.name,
    });

    await writeLexiAuditLog({
      adminUid: auth.uid,
      adminName: auth.name,
      actionType: "client_form_report_generate",
      summary: `${reportType} · ${String(generated.summary.period || "")}`,
      ok: true,
      result: {
        mode: "client_form",
        reportType,
        rowCount: generated.summary.rowCount ?? generated.summary.activityRowCount ?? null,
      },
    });

    const isEmpty = Boolean(generated.summary.isEmpty);
    const reply = isEmpty
      ? String(generated.summary.note || "No rows matched that report.")
      : String(
          generated.summary.note ||
            `CSV ready for ${reportType}. Download the file below.`
        );

    return NextResponse.json({
      reply,
      summary: generated.summary,
      report: generated.report,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not generate that report.";
    await writeLexiAuditLog({
      adminUid: auth.uid,
      adminName: auth.name,
      actionType: "client_form_report_generate",
      summary: message,
      ok: false,
      result: { mode: "client_form" },
    });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
