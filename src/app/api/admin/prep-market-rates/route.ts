import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-admin-auth";
import {
  loadPrepSavingsBenchmarks,
  savePrepSavingsBenchmarks,
} from "@/lib/prep-savings-benchmarks-server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const benchmarks = await loadPrepSavingsBenchmarks();
  return NextResponse.json({ benchmarks });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const body = await request.json().catch(() => ({}));
  const benchmarks = await savePrepSavingsBenchmarks({
    fbaPerUnit: body.fbaPerUnit,
    fbmPerUnit: body.fbmPerUnit,
    crossdockPerUnit: body.crossdockPerUnit,
    returnsPerUnit: body.returnsPerUnit,
  });
  return NextResponse.json({ ok: true, benchmarks });
}
