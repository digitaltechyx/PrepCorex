import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { recordClientLastLogin } from "@/lib/client-account-status-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const decoded = await adminAuth().verifyIdToken(token);
    await recordClientLastLogin(decoded.uid);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[POST /api/account/record-login]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to record login." },
      { status: 500 }
    );
  }
}
