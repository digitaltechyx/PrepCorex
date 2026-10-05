import { NextRequest, NextResponse } from "next/server";
import { requireCrmAutomation } from "@/lib/crm/crm-automation-auth";
import { createCrmLead, listCrmLeads } from "@/lib/crm/crm-leads-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireCrmAutomation(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { searchParams } = request.nextUrl;
    const leads = await listCrmLeads({
      q: searchParams.get("q") || undefined,
      stage: searchParams.get("stage") || undefined,
      followUpBefore: searchParams.get("followUpBefore") || undefined,
      followUpAfter: searchParams.get("followUpAfter") || undefined,
      limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
    });
    return NextResponse.json({ leads, count: leads.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to list leads." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireCrmAutomation(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const lead = await createCrmLead(body as Parameters<typeof createCrmLead>[0], auth.actor);
    return NextResponse.json({ lead }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create lead.";
    const status = message.includes("required") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
