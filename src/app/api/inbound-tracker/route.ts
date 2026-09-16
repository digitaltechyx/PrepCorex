import { NextRequest, NextResponse } from "next/server";
import {
  assertPublicTrackerAccess,
  publicTrackerAccessDeniedResponse,
} from "@/lib/public-tracker-access";
import { resolveTrackerActor } from "@/lib/tracker-api-auth";
import {
  addInboundTrackerEntry,
  deleteInboundTrackerEntry,
  listInboundTrackerEntries,
  refreshInboundTrackerEntry,
} from "@/lib/inbound-tracker-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await assertPublicTrackerAccess(request);
  if (!access.ok) return publicTrackerAccessDeniedResponse(access);

  try {
    const entries = await listInboundTrackerEntries();
    return NextResponse.json({ entries });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load inbound tracker." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const access = await assertPublicTrackerAccess(request);
  if (!access.ok) return publicTrackerAccessDeniedResponse(access);

  const actor = await resolveTrackerActor(request);

  let body: { trackingNumber?: string; carrier?: string | null; addedVia?: "scan" | "manual" };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const trackingNumber = String(body.trackingNumber || "").trim();
  if (!trackingNumber) {
    return NextResponse.json({ error: "Tracking number is required." }, { status: 400 });
  }

  try {
    const entry = await addInboundTrackerEntry({
      trackingNumber,
      carrier: body.carrier ?? null,
      addedBy: actor.uid,
      addedByName: actor.name,
      addedVia: body.addedVia === "scan" ? "scan" : "manual",
    });
    return NextResponse.json({ entry });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to add tracking.";
    const status = message.includes("already") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  const access = await assertPublicTrackerAccess(request);
  if (!access.ok) return publicTrackerAccessDeniedResponse(access);

  let body: { id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const id = String(body.id || "").trim();
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  try {
    const entry = await refreshInboundTrackerEntry(id);
    if (!entry) {
      return NextResponse.json({ error: "Tracking not found." }, { status: 404 });
    }
    return NextResponse.json({ entry });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to refresh tracking." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const access = await assertPublicTrackerAccess(request);
  if (!access.ok) return publicTrackerAccessDeniedResponse(access);

  const id = String(request.nextUrl.searchParams.get("id") || "").trim();
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  try {
    const deleted = await deleteInboundTrackerEntry(id);
    if (!deleted) {
      return NextResponse.json({ error: "Tracking not found." }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to delete tracking." },
      { status: 500 }
    );
  }
}
