import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-admin-auth";
import { approveUserAccount } from "@/lib/approve-user-account";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ uid: string }> };

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
    const result = await approveUserAccount(uid.trim());
    return NextResponse.json({
      success: true,
      emailSent: result.emailSent,
      emailError: result.emailError ?? null,
    });
  } catch (e) {
    console.error("[POST /api/admin/users/approve]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to approve user." },
      { status: 500 }
    );
  }
}
