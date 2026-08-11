import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import imageCompression from "browser-image-compression";
import { storage } from "@/lib/firebase";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PROOF_FILES = 5;

export function validateLabelWalletProofFile(file: File): string | null {
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

/** Client receipt for a wallet top-up request. */
export async function uploadLabelWalletTopupReceipt(ownerUid: string, file: File): Promise<string> {
  const err = validateLabelWalletProofFile(file);
  if (err) throw new Error(err);

  const compressed = await compressImage(file);
  const cleanName = file.name.replace(/\s+/g, "_");
  const path = `label-wallet-topup/${ownerUid}/${Date.now()}_${Math.random().toString(36).slice(2, 9)}_${cleanName}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, compressed);
  return getDownloadURL(storageRef);
}

/** Admin evidence attached when approving or rejecting a top-up. */
export async function uploadLabelWalletAdminEvidence(ownerUid: string, file: File): Promise<string> {
  const err = validateLabelWalletProofFile(file);
  if (err) throw new Error(err);

  const compressed = await compressImage(file);
  const cleanName = file.name.replace(/\s+/g, "_");
  const path = `label-wallet-admin-evidence/${ownerUid}/${Date.now()}_${Math.random().toString(36).slice(2, 9)}_${cleanName}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, compressed);
  return getDownloadURL(storageRef);
}

export function clampLabelWalletProofUrls(urls: unknown): string[] {
  if (!Array.isArray(urls)) return [];
  return urls
    .map((u) => String(u || "").trim())
    .filter((u) => u.startsWith("https://"))
    .slice(0, MAX_PROOF_FILES);
}

export const LABEL_WALLET_MAX_PROOF_FILES = MAX_PROOF_FILES;
