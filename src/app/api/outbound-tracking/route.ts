import { NextRequest, NextResponse } from "next/server";
import { requireFullAdmin } from "@/lib/api-admin-auth";
import {
  addOutboundTrackerEntry,
  deleteOutboundTrackerEntry,
  listOutboundTrackerEntries,
  refreshOutboundTrackerEntry,
} from "@/lib/outbound-tracking-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireFullAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const entries = await listOutboundTrackerEntries();
    return NextResponse.json({ entries });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load outbound tracker." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireFullAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: { trackingNumber?: string; carrier?: string | null };
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
    const entry = await addOutboundTrackerEntry({
      trackingNumber,
      carrier: body.carrier ?? null,
      addedBy: auth.uid,
      addedByName: auth.name,
    });
    return NextResponse.json({ entry });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to add tracking.";
    const status = message.includes("already") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireFullAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

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
    const entry = await refreshOutboundTrackerEntry(id);
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
  const auth = await requireFullAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const id = String(request.nextUrl.searchParams.get("id") || "").trim();
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  try {
    const deleted = await deleteOutboundTrackerEntry(id);
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
