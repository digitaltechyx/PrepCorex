import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { getDefaultPlatformDocument } from "@/lib/platform-documents-seed";
import type {
  PlatformDocument,
  PlatformDocumentSlug,
  PlatformDocumentSummary,
} from "@/lib/platform-documents-types";
import { PLATFORM_DOCUMENT_SLUGS } from "@/lib/platform-documents-types";

const COLLECTION = "platformDocuments";

function mapDoc(slug: PlatformDocumentSlug, data: FirebaseFirestore.DocumentData): PlatformDocument {
  const updatedAt = data.updatedAt;
  let updatedAtIso: string | undefined;
  if (updatedAt instanceof Timestamp) {
    updatedAtIso = updatedAt.toDate().toISOString();
  } else if (typeof updatedAt === "string") {
    updatedAtIso = updatedAt;
  }

  return {
    slug,
    title: String(data.title || ""),
    subtitle: data.subtitle ? String(data.subtitle) : undefined,
    sections: Array.isArray(data.sections)
      ? data.sections.map((s: { title?: string; body?: string }) => ({
          title: String(s.title || ""),
          body: String(s.body || ""),
        }))
      : [],
    version: Number(data.version) || 1,
    updatedAt: updatedAtIso,
    updatedBy: data.updatedBy ? String(data.updatedBy) : undefined,
    updatedByName: data.updatedByName ? String(data.updatedByName) : undefined,
  };
}

export async function ensurePlatformDocument(slug: PlatformDocumentSlug): Promise<PlatformDocument> {
  const db = adminDb();
  const ref = db.collection(COLLECTION).doc(slug);
  const snap = await ref.get();
  if (snap.exists) {
    return mapDoc(slug, snap.data()!);
  }

  const seed = getDefaultPlatformDocument(slug);
  await ref.set({
    ...seed,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return seed;
}

export async function getPlatformDocument(slug: PlatformDocumentSlug): Promise<PlatformDocument> {
  return ensurePlatformDocument(slug);
}

export async function listPlatformDocumentSummaries(): Promise<PlatformDocumentSummary[]> {
  const docs = await Promise.all(PLATFORM_DOCUMENT_SLUGS.map((slug) => ensurePlatformDocument(slug)));
  return docs.map(({ slug, title, subtitle, version, updatedAt }) => ({
    slug,
    title,
    subtitle,
    version,
    updatedAt,
  }));
}

export async function savePlatformDocument(
  slug: PlatformDocumentSlug,
  input: {
    title: string;
    subtitle?: string;
    sections: { title: string; body: string }[];
  },
  admin: { uid: string; name?: string }
): Promise<PlatformDocument> {
  const db = adminDb();
  const ref = db.collection(COLLECTION).doc(slug);
  const existing = await ensurePlatformDocument(slug);
  const nextVersion = (existing.version || 1) + 1;

  const payload = {
    slug,
    title: input.title.trim(),
    subtitle: input.subtitle?.trim() || null,
    sections: input.sections.map((s) => ({
      title: s.title.trim(),
      body: s.body.trim(),
    })),
    version: nextVersion,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: admin.uid,
    updatedByName: admin.name || "Admin",
  };

  await ref.set(payload, { merge: true });

  await ref.collection("versions").doc(String(existing.version)).set({
    ...existing,
    archivedAt: FieldValue.serverTimestamp(),
    archivedBy: admin.uid,
  });

  const updated = await ref.get();
  return mapDoc(slug, updated.data()!);
}
