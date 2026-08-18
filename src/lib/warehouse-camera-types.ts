export type WarehouseCameraSessionStatus =
  | "live"
  | "paused"
  | "stopped"
  | "uploading"
  | "uploaded"
  | "upload_failed"
  | "discarded";

export type WarehouseCameraRequestSummary = {
  id: string;
  productName: string;
  sku: string | null;
  quantity: number;
};

export type WarehouseCameraDriveFile = {
  fileId: string;
  fileName: string;
  webViewLink: string | null;
  storagePath: string;
  size: number | null;
  uploadedAt: string;
};

export type WarehouseCameraSession = {
  id: string;
  roomName: string;
  clientUserId: string;
  clientDisplayName: string;
  inventoryRequestIds: string[];
  inventoryRequestLabels: string[];
  inventoryRequestSummaries: WarehouseCameraRequestSummary[];
  warehouseId: string;
  warehouseLabel: string;
  operatorId: string;
  operatorName: string;
  status: WarehouseCameraSessionStatus;
  clipNumber: number;
  mimeType: string | null;
  durationMs: number | null;
  sizeBytes: number | null;
  startedAt: string;
  pausedAt: string | null;
  resumedAt: string | null;
  endedAt: string | null;
  updatedAt: string;
  uploadError: string | null;
  driveFile: WarehouseCameraDriveFile | null;
};

export const WAREHOUSE_CAMERA_HEARTBEAT_TIMEOUT_MS = 30_000;

export function isWarehouseCameraSessionActive(
  session: WarehouseCameraSession,
  now = Date.now()
): boolean {
  if (session.status !== "live" && session.status !== "paused") return false;
  const updatedAt = new Date(session.updatedAt).getTime();
  return Number.isFinite(updatedAt) && now - updatedAt <= WAREHOUSE_CAMERA_HEARTBEAT_TIMEOUT_MS;
}

export function warehouseCameraSessionProductLabel(session: WarehouseCameraSession): string {
  if (session.inventoryRequestSummaries.length > 0) {
    return session.inventoryRequestSummaries
      .map((row) => `${row.productName}${row.sku ? ` (${row.sku})` : ""}`)
      .join("; ");
  }
  if (session.inventoryRequestLabels.length > 0) {
    return session.inventoryRequestLabels.join("; ");
  }
  return "this inbound request";
}

export function warehouseCameraSessionHasPlayback(session: WarehouseCameraSession): boolean {
  return session.status === "uploaded";
}

/** True when warehouse started a clip for this session (not discarded). */
export function warehouseCameraSessionHasRecording(session: WarehouseCameraSession): boolean {
  return session.status !== "discarded";
}

export function warehouseCameraRecordedRequestIds(
  sessions: WarehouseCameraSession[]
): Set<string> {
  const ids = new Set<string>();
  for (const session of sessions) {
    if (!warehouseCameraSessionHasRecording(session)) continue;
    for (const id of session.inventoryRequestIds) {
      const requestId = String(id || "").trim();
      if (requestId) ids.add(requestId);
    }
  }
  return ids;
}

export type WarehouseCameraTokenResponse = {
  token: string;
  url: string;
  roomName: string;
};

export type LocalWarehouseCameraClip = {
  sessionId: string;
  clientUserId: string;
  clientDisplayName: string;
  inventoryRequestIds: string[];
  warehouseId: string;
  warehouseLabel: string;
  clipNumber: number;
  mimeType: string;
  durationMs: number;
  sizeBytes: number;
  createdAt: string;
  blob: Blob;
};
