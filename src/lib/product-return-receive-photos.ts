import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import imageCompression from "browser-image-compression";
import { storage } from "@/lib/firebase";

async function compressImage(file: File): Promise<File> {
  try {
    return await imageCompression(file, {
      maxSizeMB: 0.75,
      maxWidthOrHeight: 1600,
      useWebWorker: true,
      fileType: file.type.startsWith("image/") ? file.type : "image/jpeg",
    });
  } catch {
    return file;
  }
}

async function uploadOneReceivePhoto(input: {
  ownerUid: string;
  returnId: string;
  file: File;
  index: number;
}): Promise<string | null> {
  if (!input.file.type.startsWith("image/")) return null;
  try {
    const compressed = await compressImage(input.file);
    if (compressed.size >= 1024 * 1024) return null;
    const cleanName = (compressed.name || input.file.name || "receive.jpg").replace(/\s+/g, "_");
    const path = `product-return-receive/${input.ownerUid}/${input.returnId}/${Date.now()}_${input.index}_${cleanName}`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, compressed, {
      contentType: compressed.type || input.file.type || "image/jpeg",
    });
    return await getDownloadURL(storageRef);
  } catch {
    return null;
  }
}

/** Upload optional dock/open-receive photos (parallel) for a product return arrival. */
export async function uploadProductReturnReceivePhotos(input: {
  ownerUid: string;
  returnId: string;
  files: File[];
}): Promise<string[]> {
  const imageFiles = input.files.filter((f) => f.type.startsWith("image/"));
  if (imageFiles.length === 0) return [];

  const results = await Promise.all(
    imageFiles.map((file, index) =>
      uploadOneReceivePhoto({
        ownerUid: input.ownerUid,
        returnId: input.returnId,
        file,
        index,
      })
    )
  );
  return results.filter((url): url is string => Boolean(url));
}
