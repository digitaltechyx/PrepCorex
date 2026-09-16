import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { isFullAdminToken, isFullAdminUserDoc } from "@/lib/api-admin-auth";
import {
  isPublicTrackersPinConfigured,
  loadPublicTrackersSettings,
} from "@/lib/public-trackers-settings-server";
import { readPublicTrackersSession } from "@/lib/public-trackers-session";

export async function isFullAdminRequest(request: NextRequest): Promise<boolean> {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return false;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return false;

  try {
    const decoded = await adminAuth().verifyIdToken(token);
    const uid = decoded?.uid;
    if (!uid) return false;
    if (isFullAdminToken(decoded as Record<string, unknown>)) return true;
    const snap = await adminDb().collection("users").doc(uid).get();
    return snap.exists && isFullAdminUserDoc(snap.data());
  } catch {
    return false;
  }
}

export async function assertPublicTrackerAccess(
  request: NextRequest
): Promise<{ ok: true } | { ok: false; status: number; error: string; code: string }> {
  if (await isFullAdminRequest(request)) {
    return { ok: true };
  }

  const settings = await loadPublicTrackersSettings();
  if (!isPublicTrackersPinConfigured(settings)) {
    return { ok: true };
  }

  if (readPublicTrackersSession(request, settings.sessionVersion)) {
    return { ok: true };
  }

  return {
    ok: false,
    status: 401,
    error: "Enter the trackers PIN at prepcorex.com/trackers to continue.",
    code: "trackers_pin_required",
  };
}

export function publicTrackerAccessDeniedResponse(
  result: Extract<Awaited<ReturnType<typeof assertPublicTrackerAccess>>, { ok: false }>
): NextResponse {
  return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
}
