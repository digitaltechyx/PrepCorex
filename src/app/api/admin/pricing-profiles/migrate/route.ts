import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-admin-auth";
import {
  migrateUsersToStandardProfile,
  seedGlobalPricingProfilesFromLegacy,
} from "@/lib/pricing-profiles-migrate";

export const dynamic = "force-dynamic";

/** One-time / repeatable migration: seed global profiles from legacy defaults and assign Standard to users. */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const seed = await seedGlobalPricingProfilesFromLegacy();
    const users = await migrateUsersToStandardProfile();
    return NextResponse.json({
      success: true,
      seededCategories: seed.seededCategories,
      usersUpdated: users.updated,
    });
  } catch (e) {
    console.error("[POST /api/admin/pricing-profiles/migrate]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Migration failed." },
      { status: 500 }
    );
  }
}
