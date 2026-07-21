import imageCompression from "browser-image-compression";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "@/lib/firebase";

/** Compress and upload a product photo to inventory-images (Storage limit ~1MB). */
export async function uploadInventoryProductImage(
  ownerUid: string,
  file: File
): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please select an image file.");
  }
  const maxSizeBytes = 5 * 1024 * 1024;
  if (file.size > maxSizeBytes) {
    throw new Error("Please upload an image smaller than 5 MB.");
  }

  let toUpload = file;
  try {
    toUpload = await imageCompression(file, {
      maxSizeMB: 0.9,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
      fileType: file.type.startsWith("image/") ? file.type : "image/jpeg",
    });
  } catch {
    toUpload = file;
  }

  if (toUpload.size >= 1024 * 1024) {
    throw new Error(
      "This photo is too large. Please choose a smaller image (under 1 MB) and try again."
    );
  }

  const cleanName = (toUpload.name || file.name || "product.jpg").replace(/\s+/g, "_");
  const path = `inventory-images/${ownerUid}/${Date.now()}_${Math.random().toString(36).slice(2, 9)}_${cleanName}`;
  const storageRef = ref(storage, path);
  try {
    await uploadBytes(storageRef, toUpload, {
      contentType: toUpload.type || file.type || "image/jpeg",
    });
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : String(err || "");
    if (/storage\/unauthorized|permission/i.test(raw)) {
      throw new Error(
        "Could not upload this photo. Please use a smaller image (under 1 MB) and try again."
      );
    }
    throw new Error("Could not upload the product photo. Please try another image.");
  }

  return getDownloadURL(storageRef);
}
