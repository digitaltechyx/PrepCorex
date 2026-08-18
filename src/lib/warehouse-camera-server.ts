import { AccessToken } from "livekit-server-sdk";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { verifyBearerToken } from "@/lib/api-admin-auth";
import { hasFeature, hasRole } from "@/lib/permissions";
import type { UserProfile } from "@/types";
import type {
  WarehouseCameraRequestSummary,
  WarehouseCameraSession,
  WarehouseCameraSessionStatus,
} from "@/lib/warehouse-camera-types";
import type { NextRequest } from "next/server";

export const WAREHOUSE_CAMERA_SESSIONS_COLLECTION = "warehouseCameraSessions";

export type WarehouseCameraAuth = {
  uid: string;
  name: string;
  email: string;
  profile: UserProfile;
  canOperate: boolean;
  isAdmin: boolean;
};

export async function requireWarehouseCameraAuth(
  request: NextRequest
): Promise<
  | { ok: true; auth: WarehouseCameraAuth }
  | { ok: false; status: number; error: string }
> {
  const header = request.headers.get("authorization") || "";
  const bearer = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  const queryToken = request.nextUrl.searchParams.get("token")?.trim() || "";
  const decoded = bearer
    ? await verifyBearerToken(request)
    : queryToken
      ? await adminAuth()
          .verifyIdToken(queryToken)
          .catch(() => null)
      : null;
  if (!decoded?.uid) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  const snap = await adminDb().collection("users").doc(decoded.uid).get();
  if (!snap.exists) {
    return { ok: false, status: 403, error: "User profile not found" };
  }
  const data = snap.data() ?? {};
  const profile = { uid: decoded.uid, ...data } as UserProfile;
  const isAdmin = hasRole(profile, "admin") || hasRole(profile, "sub_admin");
  const canOperate = isAdmin || hasFeature(profile, "ops_receive");
  return {
    ok: true,
    auth: {
      uid: decoded.uid,
      name: String(data.name || decoded.name || data.email || decoded.email || decoded.uid),
      email: String(data.email || decoded.email || ""),
      profile,
      canOperate,
      isAdmin,
    },
  };
}

export function cameraSessionRef(sessionId: string) {
  return adminDb().collection(WAREHOUSE_CAMERA_SESSIONS_COLLECTION).doc(sessionId);
}

function iso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.toDate === "function") {
      return (record.toDate as () => Date)().toISOString();
    }
    if (typeof record.seconds === "number") {
      return new Date(record.seconds * 1000).toISOString();
    }
  }
  return null;
}

export function serializeCameraSession(
  id: string,
  data: FirebaseFirestore.DocumentData
): WarehouseCameraSession {
  const now = new Date().toISOString();
  const inventoryRequestIds = Array.isArray(data.inventoryRequestIds)
    ? data.inventoryRequestIds.map(String)
    : [];
  const drive =
    data.driveFile && typeof data.driveFile === "object"
      ? (data.driveFile as Record<string, unknown>)
      : null;
  return {
    id,
    roomName: String(data.roomName || ""),
    clientUserId: String(data.clientUserId || ""),
    clientDisplayName: String(data.clientDisplayName || "Client"),
    inventoryRequestIds,
    inventoryRequestLabels: Array.isArray(data.inventoryRequestLabels)
      ? data.inventoryRequestLabels.map(String)
      : inventoryRequestIds.map((requestId) => `Request ${requestId}`),
    inventoryRequestSummaries: Array.isArray(data.inventoryRequestSummaries)
      ? data.inventoryRequestSummaries.map((row: unknown) =>
          summarizeWarehouseCameraRequest(row, "")
        )
      : [],
    warehouseId: String(data.warehouseId || ""),
    warehouseLabel: String(data.warehouseLabel || data.warehouseId || "Warehouse"),
    operatorId: String(data.operatorId || ""),
    operatorName: String(data.operatorName || "Warehouse"),
    status: String(data.status || "stopped") as WarehouseCameraSessionStatus,
    clipNumber: Math.max(1, Number(data.clipNumber) || 1),
    mimeType: data.mimeType ? String(data.mimeType) : null,
    durationMs: Number.isFinite(Number(data.durationMs)) ? Number(data.durationMs) : null,
    sizeBytes: Number.isFinite(Number(data.sizeBytes)) ? Number(data.sizeBytes) : null,
    startedAt: iso(data.startedAt) || now,
    pausedAt: iso(data.pausedAt),
    resumedAt: iso(data.resumedAt),
    endedAt: iso(data.endedAt),
    updatedAt: iso(data.updatedAt) || now,
    uploadError: data.uploadError ? String(data.uploadError) : null,
    driveFile: drive
      ? {
          fileId: String(drive.fileId || ""),
          fileName: String(drive.fileName || ""),
          webViewLink: drive.webViewLink ? String(drive.webViewLink) : null,
          storagePath: String(drive.storagePath || ""),
          size: Number.isFinite(Number(drive.size)) ? Number(drive.size) : null,
          uploadedAt: iso(drive.uploadedAt) || now,
        }
      : null,
  };
}

export function canAccessCameraSession(
  auth: WarehouseCameraAuth,
  session: WarehouseCameraSession
): boolean {
  return (
    session.clientUserId === auth.uid ||
    (auth.canOperate && canOperateCameraInWarehouse(auth, session.warehouseId))
  );
}

export function canOperateCameraInWarehouse(
  auth: WarehouseCameraAuth,
  warehouseId: string
): boolean {
  if (auth.isAdmin) return true;
  const assigned = Array.isArray(auth.profile.assignedWarehouseIds)
    ? auth.profile.assignedWarehouseIds.map(String)
    : [];
  return assigned.includes(warehouseId) || hasFeature(auth.profile, "ops_supervisor");
}

export function livekitConfigured(): boolean {
  return Boolean(
    process.env.LIVEKIT_URL &&
      process.env.LIVEKIT_API_KEY &&
      process.env.LIVEKIT_API_SECRET
  );
}

export async function createWarehouseCameraToken(input: {
  identity: string;
  name: string;
  roomName: string;
  canPublish: boolean;
}): Promise<string> {
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!key || !secret || !process.env.LIVEKIT_URL) {
    throw new Error("LiveKit is not configured");
  }
  const token = new AccessToken(key, secret, {
    identity: input.identity,
    name: input.name,
    ttl: "20m",
    metadata: JSON.stringify({
      source: "prepcorex-warehouse-camera",
      canPublish: input.canPublish,
    }),
  });
  token.addGrant({
    room: input.roomName,
    roomJoin: true,
    canPublish: input.canPublish,
    canSubscribe: true,
    canPublishData: input.canPublish,
  });
  return token.toJwt();
}

export function cleanCameraLabel(value: unknown, fallback: string): string {
  return cleanDriveName(value, fallback, 100);
}

export function cleanDriveName(value: unknown, fallback: string, max = 180): string {
  const text = String(value || "")
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (text || fallback).slice(0, max);
}

export function summarizeWarehouseCameraRequest(
  data: unknown,
  requestId: string
): WarehouseCameraRequestSummary {
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const quantity = Number(record.requestedQuantity ?? record.quantity ?? 0);
  const sku = cleanCameraLabel(record.sku, "");
  return {
    id: String(record.id || requestId || ""),
    productName: cleanCameraLabel(record.productName, "Inbound request"),
    sku: sku || null,
    quantity: Number.isFinite(quantity) ? Math.max(0, Math.round(quantity)) : 0,
  };
}

export function warehouseCameraRequestLabel(summary: WarehouseCameraRequestSummary): string {
  const sku = summary.sku ? ` (${summary.sku})` : "";
  return `${summary.productName}${sku} qty ${summary.quantity}`;
}

function recordingDateStamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

export function warehouseCameraDriveFolderName(
  summaries: WarehouseCameraRequestSummary[],
  startedAt: string
): string {
  const date = recordingDateStamp(startedAt);
  const parts = (summaries.length ? summaries : [{ productName: "Inbound request", sku: null, quantity: 0, id: "" }]).map(
    (row) => {
      const sku = row.sku ? ` (${row.sku})` : "";
      return `${row.productName}${sku} qty-${row.quantity}`;
    }
  );
  return cleanDriveName(`${parts.join(" + ")} ${date}`, `Receiving ${date}`);
}

export function warehouseCameraDriveFileName(input: {
  summaries: WarehouseCameraRequestSummary[];
  startedAt: string;
  clipNumber: number;
  extension: string;
}): string {
  const date = recordingDateStamp(input.startedAt);
  const first = input.summaries[0];
  const product = first?.productName || "Inbound request";
  const qty = first?.quantity ?? 0;
  const extra = input.summaries.length > 1 ? ` +${input.summaries.length - 1}` : "";
  const base = cleanDriveName(
    `${product}${extra} qty-${qty} ${date} session-${input.clipNumber}`,
    `receive ${date} session-${input.clipNumber}`
  );
  return `${base}.${input.extension}`;
}
