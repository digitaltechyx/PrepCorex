import { NextRequest, NextResponse } from "next/server";
import {
  assertPublicTrackerAccess,
  publicTrackerAccessDeniedResponse,
} from "@/lib/public-tracker-access";
import { resolveTrackerActor } from "@/lib/tracker-api-auth";
import { appendOutboundTrackerLabelPhoto } from "@/lib/outbound-tracking-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const access = await assertPublicTrackerAccess(request);
  if (!access.ok) return publicTrackerAccessDeniedResponse(access);

  const actor = await resolveTrackerActor(request);

  let body: { id?: string; url?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const id = String(body.id || "").trim();
  const url = String(body.url || "").trim();
  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }
  if (!url) {
    return NextResponse.json({ error: "url is required." }, { status: 400 });
  }

  try {
    const entry = await appendOutboundTrackerLabelPhoto({
      id,
      photo: {
        url,
        uploadedBy: actor.uid,
        uploadedByName: actor.name,
      },
    });
    if (!entry) {
      return NextResponse.json({ error: "Tracking not found." }, { status: 404 });
    }
    return NextResponse.json({ entry });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to save photo.";
    const status = message.includes("Maximum") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
