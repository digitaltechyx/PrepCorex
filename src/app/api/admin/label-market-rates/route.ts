import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-admin-auth";
import {
  loadLabelSavingsBenchmarks,
  saveLabelSavingsBenchmarks,
} from "@/lib/label-savings-benchmarks-server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const benchmarks = await loadLabelSavingsBenchmarks();
  return NextResponse.json({ benchmarks });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const body = await request.json().catch(() => ({}));
  const benchmarks = await saveLabelSavingsBenchmarks({
    bands: Array.isArray(body.bands) ? body.bands : undefined,
    usps: body.usps,
    ups: body.ups,
    fedex: body.fedex,
  });
  return NextResponse.json({ ok: true, benchmarks });
}
