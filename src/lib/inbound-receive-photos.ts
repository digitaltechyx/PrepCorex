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
  for (const file of input.files) {
    try {
      const compressed = await compressImage(file);
      if (compressed.size > 1024 * 1024) continue;
      const path = `warehouse-receive/${input.warehouseId}/${Date.now()}_${compressed.name}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, compressed);
      urls.push(await getDownloadURL(storageRef));
    } catch {
      // skip failed uploads
    }
  }
  return urls;
}
