"use client";

import { openDB, type DBSchema } from "idb";
import type { LocalWarehouseCameraClip } from "@/lib/warehouse-camera-types";
import { normalizeLocalWarehouseCameraClip } from "@/lib/warehouse-camera-types";

interface WarehouseCameraDb extends DBSchema {
  clips: {
    key: string;
    value: LocalWarehouseCameraClip;
    indexes: {
      "by-request": string;
      "by-shipment": string;
      "by-jobType": string;
      "by-created": string;
    };
  };
}

const DB_NAME = "prepcorex-warehouse-camera";
const DB_VERSION = 2;

async function cameraDb() {
  return openDB<WarehouseCameraDb>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, transaction) {
      if (oldVersion < 1) {
        const store = db.createObjectStore("clips", { keyPath: "sessionId" });
        store.createIndex("by-request", "inventoryRequestIds", { multiEntry: true });
        store.createIndex("by-created", "createdAt");
      }
      if (oldVersion < 2) {
        const store = transaction.objectStore("clips");
        if (!store.indexNames.contains("by-shipment")) {
          store.createIndex("by-shipment", "shipmentRequestIds", { multiEntry: true });
        }
        if (!store.indexNames.contains("by-jobType")) {
          store.createIndex("by-jobType", "jobType");
        }
      }
    },
  });
}

export async function saveLocalWarehouseCameraClip(
  clip: LocalWarehouseCameraClip
): Promise<void> {
  const db = await cameraDb();
  await db.put("clips", normalizeLocalWarehouseCameraClip(clip));
}

export async function getLocalWarehouseCameraClip(
  sessionId: string
): Promise<LocalWarehouseCameraClip | undefined> {
  const db = await cameraDb();
  const row = await db.get("clips", sessionId);
  return row ? normalizeLocalWarehouseCameraClip(row) : undefined;
}

export async function listLocalWarehouseCameraClips(
  inventoryRequestIds: string[]
): Promise<LocalWarehouseCameraClip[]> {
  const db = await cameraDb();
  const seen = new Map<string, LocalWarehouseCameraClip>();
  for (const requestId of inventoryRequestIds) {
    const rows = await db.getAllFromIndex("clips", "by-request", requestId);
    rows.forEach((row) => seen.set(row.sessionId, normalizeLocalWarehouseCameraClip(row)));
  }
  return [...seen.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function listLocalWarehouseCameraClipsByShipment(
  shipmentRequestIds: string[]
): Promise<LocalWarehouseCameraClip[]> {
  const db = await cameraDb();
  const seen = new Map<string, LocalWarehouseCameraClip>();
  for (const shipmentId of shipmentRequestIds) {
    try {
      const rows = await db.getAllFromIndex("clips", "by-shipment", shipmentId);
      rows.forEach((row) => seen.set(row.sessionId, normalizeLocalWarehouseCameraClip(row)));
    } catch {
      // Index may be missing on very old DBs mid-upgrade.
    }
  }
  // Fallback scan for pre-v2 clips that only stored inventoryRequestIds empty + no shipment index.
  if (seen.size === 0 && shipmentRequestIds.length > 0) {
    const all = await db.getAll("clips");
    for (const row of all) {
      const normalized = normalizeLocalWarehouseCameraClip(row);
      if (normalized.shipmentRequestIds.some((id) => shipmentRequestIds.includes(id))) {
        seen.set(normalized.sessionId, normalized);
      }
    }
  }
  return [...seen.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/** All clips on this device (Gallery). Optionally filter to current operator. */
export async function listAllLocalWarehouseCameraClips(input?: {
  operatorId?: string;
}): Promise<LocalWarehouseCameraClip[]> {
  const db = await cameraDb();
  const rows = await db.getAll("clips");
  const operatorId = String(input?.operatorId || "").trim();
  return rows
    .map((row) => normalizeLocalWarehouseCameraClip(row))
    .filter((row) => !operatorId || !row.operatorId || row.operatorId === operatorId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function deleteLocalWarehouseCameraClip(sessionId: string): Promise<void> {
  const db = await cameraDb();
  await db.delete("clips", sessionId);
}
