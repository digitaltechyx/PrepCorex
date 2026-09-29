import { NextRequest, NextResponse } from "next/server";
import { requireFullAdmin } from "@/lib/api-admin-auth";
import { ALL_WIPE_MODULE_IDS, normalizeWipeModules } from "@/lib/admin-wipe-user-modules";
import { wipeUserOperationalData } from "@/lib/admin-wipe-user-data";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteContext = { params: Promise<{ uid: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireFullAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { uid } = await context.params;
  if (!uid?.trim()) {
    return NextResponse.json({ error: "User id is required." }, { status: 400 });
  }

  if (uid.trim() === auth.uid) {
    return NextResponse.json({ error: "You cannot wipe your own account data." }, { status: 400 });
  }

  let body: {
    modules?: unknown;
    resetAll?: boolean;
    resetOnboarding?: boolean;
    confirmEmail?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const modules = body.resetAll
    ? [...ALL_WIPE_MODULE_IDS]
    : normalizeWipeModules(body.modules);
  const resetOnboarding = body.resetOnboarding === true;

  if (modules.length === 0 && !resetOnboarding) {
    return NextResponse.json(
      { error: "Select at least one module, or enable setup wizard / MSA reset." },
      { status: 400 }
    );
  }

  try {
    const result = await wipeUserOperationalData({
      uid: uid.trim(),
      modules,
      resetOnboarding,
      performedByUid: auth.uid,
      performedByName: auth.name || null,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("[POST /api/admin/users/wipe-data]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to wipe user data." },
      { status: 500 }
    );
  }
}
