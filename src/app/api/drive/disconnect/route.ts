import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-admin-auth";
import { adminDb, adminFieldValue } from "@/lib/firebase-admin";

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  try {
    await adminDb().collection("system").doc("googleDrive").set(
      {
        refreshToken: adminFieldValue().delete(),
        accessToken: adminFieldValue().delete(),
        expiresAt: adminFieldValue().delete(),
        disabled: true,
        disconnectedAt: new Date(),
        disconnectedBy: admin.uid,
        updatedAt: new Date(),
      },
      { merge: true }
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Google Drive disconnect error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to disconnect Google Drive",
      },
      { status: 500 }
    );
  }
}
