import { NextRequest, NextResponse } from "next/server";
import {
  isPublicTrackersPinConfigured,
  loadPublicTrackersSettings,
  verifyPublicTrackersPin,
} from "@/lib/public-trackers-settings-server";
import {
  clearPublicTrackersSessionCookie,
  setPublicTrackersSessionCookie,
} from "@/lib/public-trackers-session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: { pin?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const pin = String(body.pin ?? "").trim();
  if (!pin) {
    return NextResponse.json({ error: "PIN is required." }, { status: 400 });
  }

  try {
    const settings = await loadPublicTrackersSettings();
    if (!isPublicTrackersPinConfigured(settings)) {
      const res = NextResponse.json({ success: true, unlocked: true, pinRequired: false });
      return res;
    }

    const valid = await verifyPublicTrackersPin(pin);
    if (!valid) {
      const res = NextResponse.json({ error: "Incorrect PIN.", code: "invalid_pin" }, { status: 401 });
      clearPublicTrackersSessionCookie(res);
      return res;
    }

    const res = NextResponse.json({ success: true, unlocked: true, pinRequired: true });
    setPublicTrackersSessionCookie(res, settings.sessionVersion);
    return res;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not verify PIN." },
      { status: 500 }
    );
  }
}
