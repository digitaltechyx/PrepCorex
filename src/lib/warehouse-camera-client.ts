"use client";

import type { User } from "firebase/auth";
import type {
  WarehouseCameraSession,
  WarehouseCameraTokenResponse,
} from "@/lib/warehouse-camera-types";

async function cameraFetch<T>(
  user: User,
  url: string,
  init?: RequestInit
): Promise<T> {
  const token = await user.getIdToken();
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Camera request failed");
  }
  return data as T;
}

export async function createWarehouseCameraSession(
  user: User,
  input: {
    clientUserId: string;
    clientDisplayName: string;
    inventoryRequestIds: string[];
    warehouseId: string;
    warehouseLabel: string;
    clipNumber: number;
  }
): Promise<{
  session: WarehouseCameraSession;
  token: string;
  url: string;
  roomName: string;
}> {
  return cameraFetch(user, "/api/warehouse-camera/sessions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listWarehouseCameraSessions(
  user: User,
  input: { requestId?: string; clientUserId?: string }
): Promise<WarehouseCameraSession[]> {
  const params = new URLSearchParams();
  if (input.requestId) params.set("requestId", input.requestId);
  if (input.clientUserId) params.set("clientUserId", input.clientUserId);
  const data = await cameraFetch<{ sessions: WarehouseCameraSession[] }>(
    user,
    `/api/warehouse-camera/sessions?${params.toString()}`
  );
  return data.sessions;
}

export async function updateWarehouseCameraSession(
  user: User,
  sessionId: string,
  action: "pause" | "resume" | "stop" | "discard",
  details?: { durationMs?: number; sizeBytes?: number; mimeType?: string }
): Promise<WarehouseCameraSession> {
  const data = await cameraFetch<{ session: WarehouseCameraSession }>(
    user,
    `/api/warehouse-camera/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ action, ...details }),
    }
  );
  return data.session;
}

export async function getWarehouseCameraToken(
  user: User,
  sessionId: string,
  role: "publisher" | "viewer"
): Promise<WarehouseCameraTokenResponse> {
  return cameraFetch(
    user,
    `/api/warehouse-camera/sessions/${encodeURIComponent(sessionId)}/token`,
    {
      method: "POST",
      body: JSON.stringify({ role }),
    }
  );
}

export async function uploadWarehouseCameraClipToDrive(
  user: User,
  sessionId: string,
  blob: Blob,
  onProgress?: (percent: number) => void
): Promise<WarehouseCameraSession> {
  const start = await cameraFetch<{
    uploadUrl: string;
    fileName: string;
    storagePath: string;
  }>(
    user,
    `/api/warehouse-camera/sessions/${encodeURIComponent(sessionId)}/upload`,
    {
      method: "POST",
      body: JSON.stringify({
        sizeBytes: blob.size,
        mimeType: blob.type || "video/webm",
      }),
    }
  );

  try {
    const uploaded = await new Promise<{ id: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", start.uploadUrl);
      xhr.setRequestHeader("Content-Type", blob.type || "video/webm");
      xhr.setRequestHeader(
        "Content-Range",
        `bytes 0-${Math.max(0, blob.size - 1)}/${blob.size}`
      );
      xhr.timeout = 30 * 60 * 1000;
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress?.(Math.round((event.loaded / event.total) * 100));
        }
      };
      xhr.onerror = () =>
        reject(
          new Error(
            "Google Drive blocked or lost the browser upload. Check the page connection and allowed origin, then retry."
          )
        );
      xhr.onabort = () => reject(new Error("Google Drive upload was cancelled"));
      xhr.ontimeout = () => reject(new Error("Google Drive upload timed out"));
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText) as { id: string });
          } catch {
            reject(new Error("Google Drive returned an invalid upload response"));
          }
        } else {
          const detail = xhr.responseText?.trim().slice(0, 300);
          reject(
            new Error(
              `Google Drive upload failed (${xhr.status})${detail ? `: ${detail}` : ""}`
            )
          );
        }
      };
      xhr.send(blob);
    });
    onProgress?.(100);
    const completed = await cameraFetch<{ session: WarehouseCameraSession }>(
      user,
      `/api/warehouse-camera/sessions/${encodeURIComponent(sessionId)}/upload`,
      {
        method: "PUT",
        body: JSON.stringify({ fileId: uploaded.id }),
      }
    );
    return completed.session;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    await cameraFetch(
      user,
      `/api/warehouse-camera/sessions/${encodeURIComponent(sessionId)}/upload`,
      {
        method: "PATCH",
        body: JSON.stringify({ error: message }),
      }
    ).catch(() => undefined);
    throw error;
  }
}
