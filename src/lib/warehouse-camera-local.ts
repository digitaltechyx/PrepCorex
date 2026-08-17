"use client";

import { openDB, type DBSchema } from "idb";
import type { LocalWarehouseCameraClip } from "@/lib/warehouse-camera-types";

interface WarehouseCameraDb extends DBSchema {
  clips: {
    key: string;
    value: LocalWarehouseCameraClip;
    indexes: {
      "by-request": string;
      "by-created": string;
    };
  };
}

const DB_NAME = "prepcorex-warehouse-camera";
const DB_VERSION = 1;

async function cameraDb() {
  return openDB<WarehouseCameraDb>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const store = db.createObjectStore("clips", { keyPath: "sessionId" });
      store.createIndex("by-request", "inventoryRequestIds", { multiEntry: true });
      store.createIndex("by-created", "createdAt");
    },
  });
}

export async function saveLocalWarehouseCameraClip(
  clip: LocalWarehouseCameraClip
): Promise<void> {
  const db = await cameraDb();
  await db.put("clips", clip);
}

export async function getLocalWarehouseCameraClip(
  sessionId: string
): Promise<LocalWarehouseCameraClip | undefined> {
  const db = await cameraDb();
  return db.get("clips", sessionId);
}

export async function listLocalWarehouseCameraClips(
  inventoryRequestIds: string[]
): Promise<LocalWarehouseCameraClip[]> {
  const db = await cameraDb();
  const seen = new Map<string, LocalWarehouseCameraClip>();
  for (const requestId of inventoryRequestIds) {
    const rows = await db.getAllFromIndex("clips", "by-request", requestId);
    rows.forEach((row) => seen.set(row.sessionId, row));
  }
  return [...seen.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function deleteLocalWarehouseCameraClip(sessionId: string): Promise<void> {
  const db = await cameraDb();
  await db.delete("clips", sessionId);
}
