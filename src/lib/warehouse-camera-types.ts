export type WarehouseCameraSessionStatus =
  | "live"
  | "paused"
  | "stopped"
  | "uploading"
  | "uploaded"
  | "upload_failed"
  | "discarded";

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
