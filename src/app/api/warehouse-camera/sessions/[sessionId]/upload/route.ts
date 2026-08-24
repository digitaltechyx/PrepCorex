import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminFieldValue } from "@/lib/firebase-admin";
import {
  getGoogleDriveClient,
  ensureWarehouseVideoFolder,
  startGoogleDriveResumableVideoUpload,
} from "@/lib/google-drive-video-server";
import {
  cameraSessionRef,
  requireWarehouseCameraAuth,
  serializeCameraSession,
  summarizeWarehouseCameraRequest,
  summarizeWarehouseCameraShipment,
  warehouseCameraCalendarParts,
  warehouseCameraDateStamp,
  warehouseCameraDriveFileName,
  warehouseCameraDriveRequestFolderName,
} from "@/lib/warehouse-camera-server";
import { warehouseCameraDriveStageFolderWithDate } from "@/lib/warehouse-camera-types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ sessionId: string }> };

async function authorizedSession(request: NextRequest, context: RouteContext) {
  const result = await requireWarehouseCameraAuth(request);
  if (!result.ok) return { ok: false as const, status: result.status, error: result.error };
  if (!result.auth.canOperate) {
    return { ok: false as const, status: 403, error: "Warehouse camera access required" };
  }
  const { sessionId } = await context.params;
  const ref = cameraSessionRef(sessionId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false as const, status: 404, error: "Recording session not found" };
  }
  const session = serializeCameraSession(snap.id, snap.data()!);
  if (!result.auth.isAdmin && session.operatorId !== result.auth.uid) {
    return { ok: false as const, status: 403, error: "Upload access denied" };
  }
  return { ok: true as const, auth: result.auth, ref, snap, session };
}

export async function POST(request: NextRequest, context: RouteContext) {
  const access = await authorizedSession(request, context);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const { session, ref } = access;
  if (!["stopped", "upload_failed"].includes(session.status)) {
    return NextResponse.json(
      { error: "Only a completed local clip can be uploaded" },
      { status: 409 }
    );
  }
  const body = await request.json().catch(() => ({}));
  const sizeBytes = Math.max(0, Math.floor(Number(body.sizeBytes) || 0));
  const mimeType = String(body.mimeType || session.mimeType || "video/webm").slice(0, 100);
  if (!sizeBytes) {
    return NextResponse.json({ error: "Video size is required" }, { status: 400 });
  }

  try {
    const { drive, accessToken } = await getGoogleDriveClient();
    let requestSummaries = session.inventoryRequestSummaries;
    let requestDate = session.startedAt;
    if (session.jobType === "receive" && session.inventoryRequestIds.length > 0) {
      const requestSnaps = await Promise.all(
        session.inventoryRequestIds.map((id) =>
          adminDb()
            .collection("users")
            .doc(session.clientUserId)
            .collection("inventoryRequests")
            .doc(id)
            .get()
        )
      );
      const summaries = requestSnaps
        .map((snap, index) =>
          snap.exists
            ? summarizeWarehouseCameraRequest(
                { id: session.inventoryRequestIds[index], ...(snap.data() ?? {}) },
                session.inventoryRequestIds[index]
              )
            : null
        )
        .filter((row): row is NonNullable<typeof row> => Boolean(row));
      if (summaries.length > 0) requestSummaries = summaries;
      const firstData = requestSnaps.find((snap) => snap.exists)?.data() ?? null;
      if (firstData) {
        requestDate = warehouseCameraDateStamp(
          firstData.requestedAt ?? firstData.date ?? firstData.createdAt,
          session.startedAt
        );
      }
    } else if (session.shipmentRequestIds.length > 0) {
      const shipmentSnaps = await Promise.all(
        session.shipmentRequestIds.map((id) =>
          adminDb()
            .collection("users")
            .doc(session.clientUserId)
            .collection("shipmentRequests")
            .doc(id)
            .get()
        )
      );
      const summaries = shipmentSnaps.flatMap((snap, index) =>
        snap.exists
          ? summarizeWarehouseCameraShipment(snap.data() ?? {}, session.shipmentRequestIds[index])
          : []
      );
      if (summaries.length > 0) requestSummaries = summaries;
      const firstData = shipmentSnaps.find((snap) => snap.exists)?.data() ?? null;
      if (firstData) {
        requestDate = warehouseCameraDateStamp(
          firstData.requestedAt ?? firstData.date ?? firstData.createdAt,
          session.startedAt
        );
      }
    }

    const calendar = warehouseCameraCalendarParts(session.startedAt);
    const recordingDate = calendar.date;
    const folder = await ensureWarehouseVideoFolder({
      drive,
      warehouseCode: session.warehouseLabel || session.warehouseId || "Warehouse",
      year: calendar.year,
      month: calendar.month,
      day: calendar.day,
      clientLabel: session.clientDisplayName || "Client",
      requestFolderName: warehouseCameraDriveRequestFolderName({
        summaries: requestSummaries,
        jobType: session.jobType,
        requestDate,
      }),
      stageFolder: warehouseCameraDriveStageFolderWithDate(session.jobType, recordingDate),
    });
    const extension = mimeType.includes("mp4") ? "mp4" : "webm";
    const fileName = warehouseCameraDriveFileName({
      summaries: requestSummaries,
      startedAt: session.startedAt,
      clipNumber: session.clipNumber,
      extension,
      jobType: session.jobType,
    });
    const uploadUrl = await startGoogleDriveResumableVideoUpload({
      accessToken,
      folderId: folder.folderId,
      fileName,
      mimeType,
      sizeBytes,
      origin: request.headers.get("origin") || request.nextUrl.origin,
    });
    await ref.update({
      status: "uploading",
      uploadError: null,
      uploadStoragePath: `${folder.storagePath}/${fileName}`,
      uploadFileName: fileName,
      updatedAt: adminFieldValue().serverTimestamp(),
    });
    return NextResponse.json({
      uploadUrl,
      fileName,
      storagePath: `${folder.storagePath}/${fileName}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Drive upload could not start";
    await ref.update({
      status: "upload_failed",
      uploadError: message,
      updatedAt: adminFieldValue().serverTimestamp(),
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const access = await authorizedSession(request, context);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const { ref, snap } = access;
  const body = await request.json().catch(() => ({}));
  const fileId = String(body.fileId || "").trim();
  if (!fileId) {
    return NextResponse.json({ error: "Google Drive file ID is required" }, { status: 400 });
  }
  try {
    const { drive } = await getGoogleDriveClient();
    const file = await drive.files.get({
      fileId,
      fields: "id,name,size,webViewLink,parents",
    });
    const raw = snap.data() ?? {};
    const driveFile = {
      fileId,
      fileName: String(file.data.name || raw.uploadFileName || ""),
      webViewLink: file.data.webViewLink || null,
      storagePath: String(raw.uploadStoragePath || ""),
      size: file.data.size ? Number(file.data.size) : null,
      uploadedAt: adminFieldValue().serverTimestamp(),
    };
    await ref.update({
      status: "uploaded",
      driveFile,
      uploadError: null,
      uploadFileName: adminFieldValue().delete(),
      uploadStoragePath: adminFieldValue().delete(),
      updatedAt: adminFieldValue().serverTimestamp(),
    });
    const updated = await ref.get();
    return NextResponse.json({
      session: serializeCameraSession(updated.id, updated.data()!),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Drive upload could not be verified";
    await ref.update({
      status: "upload_failed",
      uploadError: message,
      updatedAt: adminFieldValue().serverTimestamp(),
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const access = await authorizedSession(request, context);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const body = await request.json().catch(() => ({}));
  const message = String(body.error || "Upload interrupted").slice(0, 500);
  await access.ref.update({
    status: "upload_failed",
    uploadError: message,
    updatedAt: adminFieldValue().serverTimestamp(),
  });
  return NextResponse.json({ ok: true });
}
