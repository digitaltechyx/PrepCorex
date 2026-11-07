import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-admin-auth";
import { buildAdminDashboardSummary } from "@/lib/admin-dashboard-summary-server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type SummaryResult = Awaited<ReturnType<typeof buildAdminDashboardSummary>>;
const SUMMARY_CACHE_MS = 60_000;
const summaryCache = new Map<string, { value: SummaryResult; storedAt: number }>();
const summaryJobs = new Map<string, Promise<SummaryResult>>();

async function getSummaryOnce(
  key: string,
  input: Parameters<typeof buildAdminDashboardSummary>[0]
): Promise<SummaryResult> {
  const cached = summaryCache.get(key);
  if (cached && Date.now() - cached.storedAt < SUMMARY_CACHE_MS) return cached.value;

  const existing = summaryJobs.get(key);
  if (existing) return existing;

  const job = buildAdminDashboardSummary(input)
    .then((value) => {
      summaryCache.set(key, { value, storedAt: Date.now() });
      return value;
    })
    .finally(() => {
      summaryJobs.delete(key);
    });
  summaryJobs.set(key, job);
  return job;
}

function parseDateParam(value: string | null): Date | undefined {
  if (!value?.trim()) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const from = parseDateParam(request.nextUrl.searchParams.get("from"));
  const to = parseDateParam(request.nextUrl.searchParams.get("to"));
  const topClientsDays = Number(request.nextUrl.searchParams.get("topClientsDays") || "30");
  const allTime = !(from && to);

  try {
    const input = {
      callerUid: auth.uid,
      from: allTime ? undefined : from,
      to: allTime ? undefined : to,
      allTime,
      topClientsDays: Number.isFinite(topClientsDays) ? topClientsDays : 30,
    };
    const cacheKey = [
      auth.uid,
      input.from?.toISOString() ?? "all",
      input.to?.toISOString() ?? "all",
      input.topClientsDays,
    ].join(":");
    const summary = await getSummaryOnce(cacheKey, input);
    return NextResponse.json(summary);
  } catch (e) {
    console.error("[admin/dashboard/summary]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load dashboard summary" },
      { status: 500 }
    );
  }
}
