import { NextRequest, NextResponse } from "next/server";
import { isFullAdminRequest } from "@/lib/public-tracker-access";
import {
  isPublicTrackersPinConfigured,
  loadPublicTrackersSettings,
  toPublicTrackersSettingsView,
} from "@/lib/public-trackers-settings-server";
import { readPublicTrackersSession } from "@/lib/public-trackers-session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const settings = await loadPublicTrackersSettings();
    const pinRequired = isPublicTrackersPinConfigured(settings);
    const adminBypass = await isFullAdminRequest(request);
    const unlocked =
      adminBypass || !pinRequired || readPublicTrackersSession(request, settings.sessionVersion);

    return NextResponse.json({
      pinRequired,
      unlocked,
      settings: toPublicTrackersSettingsView(settings),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not load tracker access." },
      { status: 500 }
    );
  }
}
