import { NextRequest, NextResponse } from "next/server";
import { adminFieldValue } from "@/lib/firebase-admin";
import {
  cameraSessionRef,
  canAccessCameraSession,
  requireWarehouseCameraAuth,
  serializeCameraSession,
} from "@/lib/warehouse-camera-server";
import type { WarehouseCameraSessionStatus } from "@/lib/warehouse-camera-types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
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
  return NextResponse.json({
    session:
      result.auth.canOperate || !session.driveFile
        ? session
        : {
            ...session,
            driveFile: {
              ...session.driveFile,
              fileId: "",
              webViewLink: null,
              storagePath: "",
            },
          },
  });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const result = await requireWarehouseCameraAuth(request);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  if (!result.auth.canOperate) {
    return NextResponse.json({ error: "Warehouse receiving access required" }, { status: 403 });
  }

  const { sessionId } = await context.params;
  const ref = cameraSessionRef(sessionId);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "Recording session not found" }, { status: 404 });
  }
  const current = serializeCameraSession(snap.id, snap.data()!);
  if (!result.auth.isAdmin && current.operatorId !== result.auth.uid) {
    return NextResponse.json(
      { error: "Only the recording operator or an admin can update this session" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "").trim();
  const now = adminFieldValue().serverTimestamp();
  const patch: Record<string, unknown> = { updatedAt: now };
  let nextStatus: WarehouseCameraSessionStatus;

  if (action === "heartbeat") {
    if (current.status !== "live" && current.status !== "paused") {
      return NextResponse.json({ error: "Recording is no longer active" }, { status: 409 });
    }
    nextStatus = current.status;
  } else if (action === "pause") {
    if (current.status !== "live") {
      return NextResponse.json({ error: "Only a live recording can be paused" }, { status: 409 });
    }
    nextStatus = "paused";
    patch.pausedAt = now;
  } else if (action === "resume") {
    if (current.status !== "paused") {
      return NextResponse.json({ error: "Only a paused recording can be resumed" }, { status: 409 });
    }
    nextStatus = "live";
    patch.resumedAt = now;
  } else if (action === "stop") {
    if (current.status !== "live" && current.status !== "paused") {
      return NextResponse.json({ error: "Recording is already stopped" }, { status: 409 });
    }
    nextStatus = "stopped";
    patch.endedAt = now;
    patch.durationMs = Math.max(0, Math.floor(Number(body.durationMs) || 0));
    patch.sizeBytes = Math.max(0, Math.floor(Number(body.sizeBytes) || 0));
    patch.mimeType = String(body.mimeType || "video/webm").slice(0, 100);
  } else if (action === "discard") {
    nextStatus = "discarded";
    patch.endedAt = current.endedAt || now;
  } else {
    return NextResponse.json({ error: "Unsupported recording action" }, { status: 400 });
  }

  if (action !== "heartbeat") patch.status = nextStatus;
  await ref.update(patch);
  const updated = await ref.get();
  return NextResponse.json({
    session: serializeCameraSession(updated.id, updated.data()!),
  });
}
