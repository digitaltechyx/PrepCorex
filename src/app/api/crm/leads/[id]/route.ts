import { NextRequest, NextResponse } from "next/server";
import { requireCrmAutomation } from "@/lib/crm/crm-automation-auth";
import { getCrmLead, updateCrmLead } from "@/lib/crm/crm-leads-service";
import type { CrmLeadRecord } from "@/lib/crm/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireCrmAutomation(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await context.params;
  try {
    const lead = await getCrmLead(id);
    if (!lead) return NextResponse.json({ error: "Lead not found." }, { status: 404 });
    return NextResponse.json({ lead });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load lead." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireCrmAutomation(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await context.params;
  let body: Partial<CrmLeadRecord>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const lead = await updateCrmLead(id, body, auth.actor);
    return NextResponse.json({ lead });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to update lead.";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
