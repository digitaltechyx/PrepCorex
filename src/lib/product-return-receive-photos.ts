import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import imageCompression from "browser-image-compression";
import { storage } from "@/lib/firebase";

async function compressImage(file: File): Promise<File> {
  try {
    return await imageCompression(file, {
      maxSizeMB: 0.9,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
      fileType: file.type.startsWith("image/") ? file.type : "image/jpeg",
    });
  } catch {
    return file;
  }
}

/** Upload optional dock/open-receive photos for a product return arrival. */
export async function uploadProductReturnReceivePhotos(input: {
  ownerUid: string;
  returnId: string;
  files: File[];
}): Promise<string[]> {
  const urls: string[] = [];
  for (const file of input.files) {
    if (!file.type.startsWith("image/")) continue;
    try {
      const compressed = await compressImage(file);
      if (compressed.size >= 1024 * 1024) continue;
      const cleanName = (compressed.name || file.name || "receive.jpg").replace(/\s+/g, "_");
      const path = `product-return-receive/${input.ownerUid}/${input.returnId}/${Date.now()}_${cleanName}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, compressed, {
        contentType: compressed.type || file.type || "image/jpeg",
      });
      urls.push(await getDownloadURL(storageRef));
    } catch {
      // skip failed uploads
    }
  }
  return urls;
}
