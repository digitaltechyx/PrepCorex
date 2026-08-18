import { NextRequest, NextResponse } from "next/server";
import { getGoogleDriveClient } from "@/lib/google-drive-video-server";
import {
  cameraSessionRef,
  canAccessCameraSession,
  requireWarehouseCameraAuth,
  serializeCameraSession,
} from "@/lib/warehouse-camera-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
  const fileId = session.driveFile?.fileId?.trim();
  if (session.status !== "uploaded" || !fileId) {
    return NextResponse.json({ error: "Receiving video is not uploaded yet" }, { status: 409 });
  }

  try {
    const { accessToken } = await getGoogleDriveClient();
    const range = request.headers.get("range");
    const driveResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(range ? { Range: range } : {}),
        },
      }
    );
    if (!driveResponse.ok || !driveResponse.body) {
      const detail = await driveResponse.text().catch(() => "");
      return NextResponse.json(
        { error: `Could not load receiving video (${driveResponse.status})${detail ? `: ${detail.slice(0, 200)}` : ""}` },
        { status: driveResponse.status === 404 ? 404 : 502 }
      );
    }

    const headers = new Headers();
    headers.set(
      "Content-Type",
      driveResponse.headers.get("content-type") || session.mimeType || "video/webm"
    );
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", "private, max-age=60");
    headers.set("Content-Disposition", "inline");
    const contentLength = driveResponse.headers.get("content-length");
    const contentRange = driveResponse.headers.get("content-range");
    if (contentLength) headers.set("Content-Length", contentLength);
    if (contentRange) headers.set("Content-Range", contentRange);

    return new NextResponse(driveResponse.body, {
      status: driveResponse.status,
      headers,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load receiving video" },
      { status: 500 }
    );
  }
}
