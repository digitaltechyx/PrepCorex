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

/** Upload optional product photo for a return request. */
export async function uploadProductReturnImage(
  ownerUid: string,
  file: File
): Promise<string> {
  const err = validateProductReturnImageFile(file);
  if (err) throw new Error(err);

  const compressed = await compressImage(file);
  const cleanName = file.name.replace(/\s+/g, "_");
  const path = `product-return-images/${ownerUid}/${Date.now()}_${Math.random().toString(36).slice(2, 9)}_${cleanName}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, compressed);
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
