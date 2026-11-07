import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { refreshStaleInboundTrackingsForUser } from "@/lib/inbound-tracking-service";

export const dynamic = "force-dynamic";

const REFRESH_COOLDOWN_MS = 15 * 60 * 1000;
const refreshJobs = new Map<string, Promise<number>>();
const lastRefreshAt = new Map<string, number>();

async function refreshUserOnce(userId: string): Promise<{
  refreshedRequests: number;
  cached: boolean;
}> {
  const last = lastRefreshAt.get(userId) ?? 0;
  if (Date.now() - last < REFRESH_COOLDOWN_MS) {
    return { refreshedRequests: 0, cached: true };
  }

  const existing = refreshJobs.get(userId);
  if (existing) {
    return { refreshedRequests: await existing, cached: true };
  }

  const job = refreshStaleInboundTrackingsForUser(userId);
  refreshJobs.set(userId, job);
  try {
    const refreshedRequests = await job;
    lastRefreshAt.set(userId, Date.now());
    return { refreshedRequests, cached: false };
  } finally {
    refreshJobs.delete(userId);
  }
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const token = authHeader.slice(7).trim();
    const decoded = await adminAuth().verifyIdToken(token);

    const body = await request.json().catch(() => ({}));
    let userId = String(body.userId || decoded.uid).trim();
    if (userId !== decoded.uid) {
      const { adminDb } = await import("@/lib/firebase-admin");
      const snap = await adminDb().collection("users").doc(decoded.uid).get();
      const role = snap.data()?.role;
      const roles = snap.data()?.roles;
      const isAdmin =
        role === "admin" ||
        role === "sub_admin" ||
        (Array.isArray(roles) && roles.includes("admin"));
      if (!isAdmin) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const { refreshedRequests, cached } = await refreshUserOnce(userId);
    return NextResponse.json({
      success: true,
      refreshedRequests,
      cached,
      message:
        refreshedRequests > 0
          ? `Refreshed tracking for ${refreshedRequests} request(s).`
          : "All trackings are up to date.",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Refresh failed" },
      { status: 500 }
    );
  }
}
