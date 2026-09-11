import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import imageCompression from "browser-image-compression";
import { storage } from "@/lib/firebase";
import type { TrackerLabelPhoto } from "@/types";

export const TRACKER_LABEL_PHOTOS_MAX = 10;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function validateTrackerLabelPhotoFile(file: File): string | null {
  if (!file.type.startsWith("image/")) {
    return "Please select an image file.";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "Please upload an image smaller than 5 MB.";
  }
  return null;
}

async function compressImage(file: File): Promise<File> {
  try {
    return await imageCompression(file, {
      maxSizeMB: 1,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
      fileType: file.type,
    });
  } catch {
    return file;
  }
}

export function parseTrackerLabelPhotos(raw: unknown): TrackerLabelPhoto[] {
  if (!Array.isArray(raw)) return [];
  const photos: TrackerLabelPhoto[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const url = String(row.url || "").trim();
    if (!url.startsWith("https://")) continue;
    photos.push({
      url,
      uploadedAt: row.uploadedAt as TrackerLabelPhoto["uploadedAt"],
      uploadedBy: row.uploadedBy != null ? String(row.uploadedBy) : null,
      uploadedByName: row.uploadedByName != null ? String(row.uploadedByName) : null,
    });
    if (photos.length >= TRACKER_LABEL_PHOTOS_MAX) break;
  }
  return photos;
}

/** Upload a label photo for an inbound or outbound tracker entry. */
export async function uploadTrackerLabelPhoto(input: {
  kind: "inbound" | "outbound";
  entryId: string;
  file: File;
}): Promise<string> {
  const err = validateTrackerLabelPhotoFile(input.file);
  if (err) throw new Error(err);

  const compressed = await compressImage(input.file);
  const cleanName = input.file.name.replace(/\s+/g, "_");
  const path = `tracker-labels/${input.kind}/${input.entryId}/${Date.now()}_${Math.random().toString(36).slice(2, 9)}_${cleanName}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, compressed);
  return getDownloadURL(storageRef);
}
