import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminFieldValue } from "@/lib/firebase-admin";
import { hasFeature } from "@/lib/permissions";
import {
  WAREHOUSE_CAMERA_SESSIONS_COLLECTION,
  canAccessCameraSession,
  canOperateCameraInWarehouse,
  cleanCameraLabel,
  createWarehouseCameraToken,
  livekitConfigured,
  requireWarehouseCameraAuth,
  serializeCameraSession,
  summarizeWarehouseCameraRequest,
  summarizeWarehouseCameraShipment,
  warehouseCameraRequestLabel,
} from "@/lib/warehouse-camera-server";
import {
  normalizeWarehouseCameraJobType,
  type WarehouseCameraJobType,
  type WarehouseCameraRequestSummary,
  type WarehouseCameraSession,
} from "@/lib/warehouse-camera-types";

export const dynamic = "force-dynamic";

function canOperateJobType(
  auth: { isAdmin: boolean; profile: Parameters<typeof hasFeature>[0] },
  jobType: WarehouseCameraJobType
): boolean {
  if (auth.isAdmin) return true;
  if (jobType === "receive") return hasFeature(auth.profile, "ops_receive");
  if (jobType === "pick") return hasFeature(auth.profile, "ops_pick");
  return hasFeature(auth.profile, "ops_pack");
}

export async function GET(request: NextRequest) {
  const result = await requireWarehouseCameraAuth(request);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { auth } = result;
  const requestId = request.nextUrl.searchParams.get("requestId")?.trim() || "";
  const shipmentRequestId =
    request.nextUrl.searchParams.get("shipmentRequestId")?.trim() || "";
  const jobTypeFilter = request.nextUrl.searchParams.get("jobType")?.trim() || "";
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
    .filter((session: WarehouseCameraSession) => canAccessCameraSession(auth, session))
    .filter((session: WarehouseCameraSession) => {
      if (jobTypeFilter) {
        return session.jobType === normalizeWarehouseCameraJobType(jobTypeFilter);
      }
      return true;
    })
    .filter((session: WarehouseCameraSession) => {
      if (shipmentRequestId) {
        return session.shipmentRequestIds.includes(shipmentRequestId);
      }
      if (requestId) {
        return (
          session.inventoryRequestIds.includes(requestId) ||
          session.shipmentRequestIds.includes(requestId)
        );
      }
      return true;
    })
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
    return NextResponse.json({ error: "Warehouse camera access required" }, { status: 403 });
  }
  if (!livekitConfigured()) {
    return NextResponse.json({ error: "LiveKit is not configured" }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const jobType = normalizeWarehouseCameraJobType(body.jobType);
  if (!canOperateJobType(auth, jobType)) {
    return NextResponse.json(
      { error: `You do not have permission to record ${jobType} video` },
      { status: 403 }
    );
  }

  const clientUserId = String(body.clientUserId || "").trim();
  const inventoryRequestIds = (
    Array.isArray(body.inventoryRequestIds)
      ? body.inventoryRequestIds.map((id: unknown) => String(id).trim()).filter(Boolean)
      : []
  )
    .filter((id: string, index: number, all: string[]) => all.indexOf(id) === index)
    .slice(0, 20) as string[];
  const shipmentRequestIds = (
    Array.isArray(body.shipmentRequestIds)
      ? body.shipmentRequestIds.map((id: unknown) => String(id).trim()).filter(Boolean)
      : []
  )
    .filter((id: string, index: number, all: string[]) => all.indexOf(id) === index)
    .slice(0, 20) as string[];
  const warehouseId = String(body.warehouseId || "").trim();
  if (!clientUserId || !warehouseId) {
    return NextResponse.json(
      { error: "Client and warehouse are required" },
      { status: 400 }
    );
  }
  if (jobType === "receive" && inventoryRequestIds.length === 0) {
    return NextResponse.json(
      { error: "Inbound request is required for receive recording" },
      { status: 400 }
    );
  }
  if (jobType !== "receive" && shipmentRequestIds.length === 0) {
    return NextResponse.json(
      { error: "Shipment request is required for outbound recording" },
      { status: 400 }
    );
  }
  if (!canOperateCameraInWarehouse(auth, warehouseId)) {
    return NextResponse.json(
      { error: "You are not assigned to this warehouse" },
      { status: 403 }
    );
  }

  let inventoryRequestSummaries: WarehouseCameraRequestSummary[] = [];
  let inventoryRequestLabels: string[] = [];

  if (jobType === "receive") {
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
    inventoryRequestSummaries = requestSnaps.map((snap, index) =>
      summarizeWarehouseCameraRequest(
        { id: inventoryRequestIds[index], ...(snap.data() ?? {}) },
        inventoryRequestIds[index]
      )
    );
    inventoryRequestLabels = inventoryRequestSummaries.map(warehouseCameraRequestLabel);
  } else {
    const shipmentSnaps = await Promise.all(
      shipmentRequestIds.map((id) =>
        adminDb().collection("users").doc(clientUserId).collection("shipmentRequests").doc(id).get()
      )
    );
    if (shipmentSnaps.some((snap) => !snap.exists)) {
      return NextResponse.json(
        { error: "One or more outbound shipments were not found for this client" },
        { status: 404 }
      );
    }
    const clientSummaries = Array.isArray(body.requestSummaries)
      ? (body.requestSummaries as WarehouseCameraRequestSummary[])
      : [];
    inventoryRequestSummaries =
      clientSummaries.length > 0
        ? clientSummaries.map((row, index) =>
            summarizeWarehouseCameraRequest(row, String(row?.id || `line-${index}`))
          )
        : shipmentSnaps.flatMap((snap, index) =>
            summarizeWarehouseCameraShipment(snap.data() ?? {}, shipmentRequestIds[index])
          );
    inventoryRequestLabels = inventoryRequestSummaries.map(warehouseCameraRequestLabel);
  }

  const ref = adminDb().collection(WAREHOUSE_CAMERA_SESSIONS_COLLECTION).doc();
  const roomName = `prepcorex-${jobType}-${ref.id}`;
  const now = adminFieldValue().serverTimestamp();
  const payload = {
    roomName,
    clientUserId,
    clientDisplayName: cleanCameraLabel(body.clientDisplayName, "Client"),
    inventoryRequestIds: jobType === "receive" ? inventoryRequestIds : [],
    shipmentRequestIds: jobType === "receive" ? [] : shipmentRequestIds,
    jobType,
    inventoryRequestLabels,
    inventoryRequestSummaries,
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
