import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminFieldValue } from "@/lib/firebase-admin";
import {
  WAREHOUSE_CAMERA_SESSIONS_COLLECTION,
  canAccessCameraSession,
  canOperateCameraInWarehouse,
  cleanCameraLabel,
  createWarehouseCameraToken,
  livekitConfigured,
  requireWarehouseCameraAuth,
  serializeCameraSession,
} from "@/lib/warehouse-camera-server";
import type { WarehouseCameraSession } from "@/lib/warehouse-camera-types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const result = await requireWarehouseCameraAuth(request);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { auth } = result;
  const requestId = request.nextUrl.searchParams.get("requestId")?.trim() || "";
  const requestedClientId =
    request.nextUrl.searchParams.get("clientUserId")?.trim() || "";
  const clientUserId = auth.canOperate ? requestedClientId : auth.uid;

  if (!clientUserId) {
    return NextResponse.json(
      { error: "clientUserId is required for warehouse/admin session lookup" },
      { status: 400 }
    );
  }

  const snap = await adminDb()
    .collection(WAREHOUSE_CAMERA_SESSIONS_COLLECTION)
    .where("clientUserId", "==", clientUserId)
    .limit(100)
    .get();
  const sessions: WarehouseCameraSession[] = snap.docs
    .map((doc: FirebaseFirestore.QueryDocumentSnapshot): WarehouseCameraSession =>
      serializeCameraSession(doc.id, doc.data())
    )
    .filter((session: WarehouseCameraSession) =>
      canAccessCameraSession(auth, session)
    )
    .filter((session: WarehouseCameraSession) =>
      requestId ? session.inventoryRequestIds.includes(requestId) : true
    )
    .sort(
      (a: WarehouseCameraSession, b: WarehouseCameraSession) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    )
    .map((session: WarehouseCameraSession): WarehouseCameraSession =>
      auth.canOperate || !session.driveFile
        ? session
        : {
            ...session,
            driveFile: {
              ...session.driveFile,
              fileId: "",
              webViewLink: null,
              storagePath: "",
            },
          }
    );

  return NextResponse.json({
    sessions,
    livekitConfigured: livekitConfigured(),
  });
}

export async function POST(request: NextRequest) {
  const result = await requireWarehouseCameraAuth(request);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { auth } = result;
  if (!auth.canOperate) {
    return NextResponse.json({ error: "Warehouse receiving access required" }, { status: 403 });
  }
  if (!livekitConfigured()) {
    return NextResponse.json({ error: "LiveKit is not configured" }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const clientUserId = String(body.clientUserId || "").trim();
  const inventoryRequestIds = Array.isArray(body.inventoryRequestIds)
    ? [...new Set(body.inventoryRequestIds.map((id: unknown) => String(id).trim()).filter(Boolean))]
        .slice(0, 20)
    : [];
  const warehouseId = String(body.warehouseId || "").trim();
  if (!clientUserId || inventoryRequestIds.length === 0 || !warehouseId) {
    return NextResponse.json(
      { error: "Client, inbound request, and warehouse are required" },
      { status: 400 }
    );
  }
  if (!canOperateCameraInWarehouse(auth, warehouseId)) {
    return NextResponse.json(
      { error: "You are not assigned to this warehouse" },
      { status: 403 }
    );
  }

  const requestSnaps = await Promise.all(
    inventoryRequestIds.map((id) =>
      adminDb().collection("users").doc(clientUserId).collection("inventoryRequests").doc(id).get()
    )
  );
  if (requestSnaps.some((snap) => !snap.exists)) {
    return NextResponse.json(
      { error: "One or more inbound requests were not found for this client" },
      { status: 404 }
    );
  }

  const ref = adminDb().collection(WAREHOUSE_CAMERA_SESSIONS_COLLECTION).doc();
  const roomName = `prepcorex-receive-${ref.id}`;
  const now = adminFieldValue().serverTimestamp();
  const payload = {
    roomName,
    clientUserId,
    clientDisplayName: cleanCameraLabel(body.clientDisplayName, "Client"),
    inventoryRequestIds,
    warehouseId,
    warehouseLabel: cleanCameraLabel(body.warehouseLabel, warehouseId),
    operatorId: auth.uid,
    operatorName: cleanCameraLabel(auth.name, "Warehouse"),
    status: "live",
    clipNumber: Math.max(1, Math.floor(Number(body.clipNumber) || 1)),
    mimeType: null,
    durationMs: null,
    sizeBytes: null,
    startedAt: now,
    pausedAt: null,
    resumedAt: null,
    endedAt: null,
    updatedAt: now,
    uploadError: null,
    driveFile: null,
  };
  await ref.set(payload);

  const token = await createWarehouseCameraToken({
    identity: `warehouse-${auth.uid}-${ref.id}`,
    name: auth.name,
    roomName,
    canPublish: true,
  });

  return NextResponse.json(
    {
      session: serializeCameraSession(ref.id, {
        ...payload,
        startedAt: new Date(),
        updatedAt: new Date(),
      }),
      token,
      url: process.env.LIVEKIT_URL,
      roomName,
    },
    { status: 201 }
  );
}
