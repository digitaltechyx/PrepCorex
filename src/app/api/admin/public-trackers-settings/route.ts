import { NextRequest, NextResponse } from "next/server";
import { requireFullAdmin } from "@/lib/api-admin-auth";
import {
  disablePublicTrackersPin,
  loadPublicTrackersSettings,
  normalizePublicTrackersPin,
  savePublicTrackersPin,
  toPublicTrackersSettingsView,
} from "@/lib/public-trackers-settings-server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireFullAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const settings = await loadPublicTrackersSettings();
    return NextResponse.json({
      settings: toPublicTrackersSettingsView(settings),
      publicUrl: "/trackers",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load settings." },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireFullAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: { pin?: string; disable?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    if (body.disable === true) {
      await disablePublicTrackersPin({ adminUid: auth.uid, adminName: auth.name });
      const settings = await loadPublicTrackersSettings();
      return NextResponse.json({
        settings: toPublicTrackersSettingsView(settings),
        message: "Public trackers PIN removed. /trackers is open without a PIN.",
      });
    }

    const pin = normalizePublicTrackersPin(body.pin);
    if (!pin) {
      return NextResponse.json({ error: "PIN is required." }, { status: 400 });
    }

    await savePublicTrackersPin({ pin, adminUid: auth.uid, adminName: auth.name });
    const settings = await loadPublicTrackersSettings();
    return NextResponse.json({
      settings: toPublicTrackersSettingsView(settings),
      message: "Public trackers PIN saved. Anyone opening /trackers must enter it.",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to save settings." },
      { status: 400 }
    );
  }
}
