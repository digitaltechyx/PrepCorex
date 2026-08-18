import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-admin-auth";
import { adminDb } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const snap = await adminDb().collection("system").doc("googleDrive").get();
  const data = snap.exists ? snap.data() ?? {} : {};
  const disabled = data.disabled === true;
  const firestoreConnected = Boolean(data.refreshToken) && !disabled;
  const environmentConnected =
    Boolean(process.env.GOOGLE_DRIVE_REFRESH_TOKEN) && !disabled;

  return NextResponse.json({
    connected: firestoreConnected || environmentConnected,
    source: firestoreConnected
      ? "firestore"
      : environmentConnected
        ? "environment"
        : null,
    connectedAt:
      typeof data.connectedAt?.toDate === "function"
        ? data.connectedAt.toDate().toISOString()
        : data.connectedAt instanceof Date
          ? data.connectedAt.toISOString()
          : null,
  });
}
