import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { refreshStaleInboundTrackingsForUser } from "@/lib/inbound-tracking-service";

export const dynamic = "force-dynamic";

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

    const refreshedRequests = await refreshStaleInboundTrackingsForUser(userId);
    return NextResponse.json({
      success: true,
      refreshedRequests,
      message:
        refreshedRequests > 0
          ? `Refreshed tracking for ${refreshedRequests} request(s).`
          : "All trackings are up to date (checked within 6 hours).",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Refresh failed" },
      { status: 500 }
    );
  }
}
