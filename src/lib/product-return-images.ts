import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import imageCompression from "browser-image-compression";
import { storage } from "@/lib/firebase";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function validateProductReturnImageFile(file: File): string | null {
  if (!file.type.startsWith("image/")) {
    return "Please select an image file.";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "Please upload an image smaller than 5 MB.";
  }
  return null;
}

/** Upload optional product photo for a return request (Storage limit ~1MB). */
export async function uploadProductReturnImage(
  ownerUid: string,
  file: File
): Promise<string> {
  const err = validateProductReturnImageFile(file);
  if (err) throw new Error(err);

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

  const cleanName = (toUpload.name || file.name || "return.jpg").replace(/\s+/g, "_");
  const path = `product-return-images/${ownerUid}/${Date.now()}_${Math.random().toString(36).slice(2, 9)}_${cleanName}`;
  const storageRef = ref(storage, path);
  try {
    await uploadBytes(storageRef, toUpload, {
      contentType: toUpload.type || file.type || "image/jpeg",
    });
  } catch (uploadErr: unknown) {
    const raw = uploadErr instanceof Error ? uploadErr.message : String(uploadErr || "");
    if (/storage\/unauthorized|permission/i.test(raw)) {
      throw new Error(
        "Could not upload this photo. Please use a smaller image (under 1 MB) and try again."
      );
    }
    throw new Error("Could not upload the product photo. Please try another image.");
  }

  return getDownloadURL(storageRef);
}

export function getProductReturnImageUrls(
  data: { imageUrl?: string; imageUrls?: string[] } | null | undefined
): string[] {
  if (!data) return [];
  if (Array.isArray(data.imageUrls) && data.imageUrls.length > 0) return data.imageUrls;
  if (typeof data.imageUrl === "string" && data.imageUrl.trim()) return [data.imageUrl.trim()];
  return [];
}
