import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import {
  getDefaultPlatformDocument,
  minimumSectionCount,
} from "@/lib/platform-documents-seed";
import type {
  PlatformDocument,
  PlatformDocumentControlRow,
  PlatformDocumentRevisionRow,
  PlatformDocumentSlug,
  PlatformDocumentSummary,
} from "@/lib/platform-documents-types";
import {
  PLATFORM_DOCUMENT_CONTENT_SCHEMA_VERSION,
  PLATFORM_DOCUMENT_SLUGS,
} from "@/lib/platform-documents-types";

const COLLECTION = "platformDocuments";

function mapControlRows(value: unknown): PlatformDocumentControlRow[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((row) => ({
      field: String((row as { field?: string }).field || "").trim(),
      value: String((row as { value?: string }).value || "").trim(),
    }))
    .filter((row) => row.field && row.value);
}

function mapRevisionRows(value: unknown): PlatformDocumentRevisionRow[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((row) => ({
      version: String((row as { version?: string }).version || "").trim(),
      date: String((row as { date?: string }).date || "").trim(),
      changes: String((row as { changes?: string }).changes || "").trim(),
    }))
    .filter((row) => row.version || row.date || row.changes);
}

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
    headerLine: data.headerLine ? String(data.headerLine) : undefined,
    footerLine: data.footerLine ? String(data.footerLine) : undefined,
    showDocumentControlHeading:
      typeof data.showDocumentControlHeading === "boolean"
        ? data.showDocumentControlHeading
        : slug === "msa",
    coverTitle: data.coverTitle ? String(data.coverTitle) : undefined,
    coverSubtitle: data.coverSubtitle ? String(data.coverSubtitle) : undefined,
    documentControl: mapControlRows(data.documentControl),
    revisionHistory: mapRevisionRows(data.revisionHistory),
    preamble: data.preamble ? String(data.preamble) : undefined,
    intro: data.intro ? String(data.intro) : undefined,
    tableOfContents: data.tableOfContents ? String(data.tableOfContents) : undefined,
    sections: Array.isArray(data.sections)
      ? data.sections.map((s: { title?: string; body?: string }) => ({
          title: String(s.title || ""),
          body: String(s.body || ""),
        }))
      : [],
    version: Number(data.version) || 1,
    contentSchemaVersion: Number(data.contentSchemaVersion) || 1,
    updatedAt: updatedAtIso,
    updatedBy: data.updatedBy ? String(data.updatedBy) : undefined,
    updatedByName: data.updatedByName ? String(data.updatedByName) : undefined,
  };
}

function needsContentMigration(doc: PlatformDocument): boolean {
  if ((doc.contentSchemaVersion || 1) < PLATFORM_DOCUMENT_CONTENT_SCHEMA_VERSION) return true;
  if (!doc.documentControl?.length) return true;
  if (!doc.headerLine) return true;
  if (doc.sections.length < minimumSectionCount(doc.slug)) return true;
  return false;
}

export async function ensurePlatformDocument(slug: PlatformDocumentSlug): Promise<PlatformDocument> {
  const db = adminDb();
  const ref = db.collection(COLLECTION).doc(slug);
  const snap = await ref.get();
  const seed = getDefaultPlatformDocument(slug);

  if (!snap.exists) {
    await ref.set({
      ...seed,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return seed;
  }

  const existing = mapDoc(slug, snap.data()!);
  if (!needsContentMigration(existing)) {
    return existing;
  }

  const migrated: PlatformDocument = {
    ...seed,
    version: existing.version || seed.version,
    updatedAt: existing.updatedAt || seed.updatedAt,
    updatedBy: existing.updatedBy,
    updatedByName: existing.updatedByName || "System",
    contentSchemaVersion: PLATFORM_DOCUMENT_CONTENT_SCHEMA_VERSION,
  };

  await ref.set(
    {
      ...migrated,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return migrated;
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
    contentSchemaVersion: existing.contentSchemaVersion || PLATFORM_DOCUMENT_CONTENT_SCHEMA_VERSION,
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
