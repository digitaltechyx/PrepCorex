import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { verifyBearerToken } from "@/lib/api-admin-auth";
import { parseReportDateRange } from "@/lib/admin-reports-request-utils";
import { buildClientReport } from "@/lib/client-reports-server";
import { hasFeature } from "@/lib/permissions";
import type { UserProfile } from "@/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const decoded = await verifyBearerToken(request);
  if (!decoded?.uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snap = await adminDb().collection("users").doc(decoded.uid).get();
  const profile = snap.exists
    ? ({ uid: decoded.uid, ...(snap.data() as object) } as UserProfile)
    : null;
  if (!profile || !hasFeature(profile, "view_reports")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { from, to, allTime } = parseReportDateRange(request);
    const summary = await buildClientReport({
      userId: decoded.uid,
      from,
      to,
      allTime,
    });
    return NextResponse.json({ summary });
  } catch (e) {
    console.error("[GET /api/reports/client-summary]", e);
    return NextResponse.json(
      { error: "Failed to build report.", detail: e instanceof Error ? e.message : "Unknown" },
      { status: 500 }
    );
  }
}
