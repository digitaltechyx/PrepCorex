import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import imageCompression from "browser-image-compression";
import { storage } from "@/lib/firebase";

async function compressImage(file: File): Promise<File> {
  return imageCompression(file, {
    maxSizeMB: 1,
    maxWidthOrHeight: 1920,
    useWebWorker: true,
    fileType: file.type,
  });
}

/** Upload multiple dock receive photos for a warehouse batch. */
export async function uploadReceivePhotos(input: {
  warehouseId: string;
  files: File[];
  uploadedBy?: string | null;
}): Promise<string[]> {
  const urls: string[] = [];
  const errors: string[] = [];
  for (let i = 0; i < input.files.length; i++) {
    const file = input.files[i]!;
    try {
      const compressed = await compressImage(file);
      // Prefer compressed under 1.5MB; still upload if slightly over so remarks keep photos.
      const safeName = String(compressed.name || file.name || `photo-${i}.jpg`)
        .replace(/[^\w.\-]+/g, "_")
        .slice(0, 80);
      const path = `warehouse-receive/${input.warehouseId}/${Date.now()}_${i}_${safeName}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, compressed, {
        contentType: compressed.type || file.type || "image/jpeg",
      });
      urls.push(await getDownloadURL(storageRef));
    } catch (err) {
      const message = err instanceof Error ? err.message : "upload failed";
      errors.push(`${file.name || `photo ${i + 1}`}: ${message}`);
      console.warn("[uploadReceivePhotos] failed", file.name, err);
    }
  }
  if (urls.length === 0 && input.files.length > 0) {
    throw new Error(
      errors[0]
        ? `Could not upload receive photos (${errors[0]})`
        : "Could not upload receive photos."
    );
  }
  return urls;
}
