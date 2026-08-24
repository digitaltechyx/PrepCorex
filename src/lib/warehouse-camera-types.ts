export type WarehouseCameraSessionStatus =
  | "live"
  | "paused"
  | "stopped"
  | "uploading"
  | "uploaded"
  | "upload_failed"
  | "discarded";

/** Receive = inbound. pick/pack/dispatch = outbound stages. */
export type WarehouseCameraJobType = "receive" | "pick" | "pack" | "dispatch";

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
  /** Inbound receive request ids (empty for outbound). */
  inventoryRequestIds: string[];
  inventoryRequestLabels: string[];
  inventoryRequestSummaries: WarehouseCameraRequestSummary[];
  /** Outbound shipment request ids (empty for receive). */
  shipmentRequestIds: string[];
  jobType: WarehouseCameraJobType;
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

export function normalizeWarehouseCameraJobType(value: unknown): WarehouseCameraJobType {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "pick" || raw === "pack" || raw === "dispatch" || raw === "receive") {
    return raw;
  }
  return "receive";
}

export function warehouseCameraJobTypeLabel(jobType: WarehouseCameraJobType): string {
  switch (jobType) {
    case "pick":
      return "Pick";
    case "pack":
      return "Pack";
    case "dispatch":
      return "Dispatch";
    default:
      return "Receive";
  }
}

export function warehouseCameraDriveStageFolder(jobType: WarehouseCameraJobType): string {
  switch (jobType) {
    case "pick":
      return "Pick";
    case "pack":
      return "Pack";
    case "dispatch":
      return "Dispatch";
    default:
      return "Receiving";
  }
}

/** Stage folder on Drive always includes the recording date (e.g. `Pick 2026-08-25`). */
export function warehouseCameraDriveStageFolderWithDate(
  jobType: WarehouseCameraJobType,
  recordingDate: string
): string {
  const date = String(recordingDate || "").trim() || new Date().toISOString().slice(0, 10);
  return `${warehouseCameraDriveStageFolder(jobType)} ${date}`;
}

export function warehouseCameraDriveRequestKind(
  jobType: WarehouseCameraJobType
): "Inbound" | "Outbound" | "Return" {
  if (jobType === "receive") return "Inbound";
  // Return camera can map here later when jobType expands.
  return "Outbound";
}


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
  return session.jobType === "receive" ? "this inbound request" : "this shipment";
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
    if (session.jobType !== "receive" && session.jobType) continue;
    for (const id of session.inventoryRequestIds) {
      const requestId = String(id || "").trim();
      if (requestId) ids.add(requestId);
    }
  }
  return ids;
}

export function warehouseCameraRecordedShipmentIds(
  sessions: WarehouseCameraSession[]
): Set<string> {
  const ids = new Set<string>();
  for (const session of sessions) {
    if (!warehouseCameraSessionHasRecording(session)) continue;
    if (session.jobType === "receive") continue;
    for (const id of session.shipmentRequestIds || []) {
      const shipmentId = String(id || "").trim();
      if (shipmentId) ids.add(shipmentId);
    }
  }
  return ids;
}

export function linesToWarehouseCameraSummaries(
  lines: Array<{
    id?: string;
    productId?: string;
    productName?: string;
    sku?: string | null;
    quantityUnits?: number;
    quantity?: number;
  }>
): WarehouseCameraRequestSummary[] {
  return (lines || []).map((line, index) => ({
    id: String(line.id || line.productId || `line-${index}`),
    productName: String(line.productName || "Product").trim() || "Product",
    sku: line.sku ? String(line.sku).trim() || null : null,
    quantity: Math.max(0, Math.round(Number(line.quantityUnits ?? line.quantity) || 0)),
  }));
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
  shipmentRequestIds: string[];
  jobType: WarehouseCameraJobType;
  warehouseId: string;
  warehouseLabel: string;
  operatorId?: string;
  clipNumber: number;
  mimeType: string;
  durationMs: number;
  sizeBytes: number;
  createdAt: string;
  blob: Blob;
};

export function normalizeLocalWarehouseCameraClip(
  clip: LocalWarehouseCameraClip | (Omit<LocalWarehouseCameraClip, "jobType" | "shipmentRequestIds"> & {
    jobType?: WarehouseCameraJobType;
    shipmentRequestIds?: string[];
  })
): LocalWarehouseCameraClip {
  return {
    ...clip,
    inventoryRequestIds: Array.isArray(clip.inventoryRequestIds)
      ? clip.inventoryRequestIds.map(String)
      : [],
    shipmentRequestIds: Array.isArray(clip.shipmentRequestIds)
      ? clip.shipmentRequestIds.map(String)
      : [],
    jobType: normalizeWarehouseCameraJobType(clip.jobType),
  };
}
