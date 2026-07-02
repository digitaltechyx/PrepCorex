import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-admin-auth";
import { adminAuth } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ uid: string }> };

/** Admin-only: mark a user's email as verified (e.g. after admin-created accounts). */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { uid } = await context.params;
  if (!uid?.trim()) {
    return NextResponse.json({ error: "User id is required." }, { status: 400 });
  }

  try {
    await adminAuth().updateUser(uid.trim(), { emailVerified: true });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[POST /api/admin/users/mark-email-verified]", e);
    return NextResponse.json({ error: "Failed to mark email as verified." }, { status: 500 });
  }
}
