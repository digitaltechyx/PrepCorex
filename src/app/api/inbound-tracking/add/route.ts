import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { addInboundTracking } from "@/lib/inbound-tracking-service";

export const dynamic = "force-dynamic";

async function verifyCaller(request: NextRequest, targetUserId: string) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false as const, status: 401, error: "Unauthorized" };
  }
  const token = authHeader.slice(7).trim();
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    if (decoded.uid !== targetUserId) {
      const { adminDb } = await import("@/lib/firebase-admin");
      const snap = await adminDb().collection("users").doc(decoded.uid).get();
      const role = snap.data()?.role;
      const roles = snap.data()?.roles;
      const isAdmin =
        role === "admin" ||
        role === "sub_admin" ||
        (Array.isArray(roles) && roles.includes("admin"));
      if (!isAdmin) return { ok: false as const, status: 403, error: "Forbidden" };
    }
    return { ok: true as const, uid: decoded.uid };
  } catch {
    return { ok: false as const, status: 401, error: "Invalid token" };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const userId = String(body.userId || "").trim();
    const requestId = String(body.requestId || "").trim();
    const trackingNumber = String(body.trackingNumber || "").trim();
    const carrier = body.carrier != null ? String(body.carrier) : undefined;

    if (!userId || !requestId || !trackingNumber) {
      return NextResponse.json(
        { error: "userId, requestId, and trackingNumber are required." },
        { status: 400 }
      );
    }

    const auth = await verifyCaller(request, userId);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const trackings = await addInboundTracking({
      userId,
      requestId,
      trackingNumber,
      carrier,
      addedBy: auth.uid,
    });

    return NextResponse.json({ success: true, inboundTrackings: trackings });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to add tracking" },
      { status: 500 }
    );
  }
}
