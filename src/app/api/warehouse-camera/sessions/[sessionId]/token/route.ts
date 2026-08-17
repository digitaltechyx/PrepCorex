import { NextRequest, NextResponse } from "next/server";
import {
  cameraSessionRef,
  canAccessCameraSession,
  createWarehouseCameraToken,
  requireWarehouseCameraAuth,
  serializeCameraSession,
} from "@/lib/warehouse-camera-server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const result = await requireWarehouseCameraAuth(request);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { sessionId } = await context.params;
  const snap = await cameraSessionRef(sessionId).get();
  if (!snap.exists) {
    return NextResponse.json({ error: "Recording session not found" }, { status: 404 });
  }
  const session = serializeCameraSession(snap.id, snap.data()!);
  if (!canAccessCameraSession(result.auth, session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const publishRequested = body.role === "publisher";
  const canPublish =
    publishRequested &&
    result.auth.canOperate &&
    session.operatorId === result.auth.uid &&
    (session.status === "live" || session.status === "paused");
  if (publishRequested && !canPublish) {
    return NextResponse.json({ error: "Publisher access denied" }, { status: 403 });
  }

  const token = await createWarehouseCameraToken({
    identity: canPublish
      ? `warehouse-${result.auth.uid}-${session.id}`
      : `viewer-${result.auth.uid}-${session.id}`,
    name: result.auth.name,
    roomName: session.roomName,
    canPublish,
  });
  return NextResponse.json({
    token,
    url: process.env.LIVEKIT_URL,
    roomName: session.roomName,
  });
}
