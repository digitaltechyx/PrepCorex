import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import {
  getDefaultPlatformDocument,
  minimumSectionCount,
} from "@/lib/platform-documents-seed";
import { withResolvedDocumentMetadata } from "@/lib/platform-document-control";
import type {
  PlatformDocument,
  PlatformDocumentSlug,
  PlatformDocumentSummary,
  PlatformDocumentVersionEntry,
} from "@/lib/platform-documents-types";
import {
  PLATFORM_DOCUMENT_CONTENT_SCHEMA_VERSION,
  PLATFORM_DOCUMENT_SLUGS,
} from "@/lib/platform-documents-types";

const COLLECTION = "platformDocuments";

function toFirestoreDocument(
  doc: PlatformDocument | Record<string, unknown>,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...extra };
  for (const [key, value] of Object.entries(doc)) {
    if (value !== undefined) {
      payload[key] = value;
    }
  }
  return payload;
}

function mapDoc(slug: PlatformDocumentSlug, data: FirebaseFirestore.DocumentData): PlatformDocument {
  const updatedAt = data.updatedAt;
  const effectiveAt = data.effectiveAt;
  let updatedAtIso: string | undefined;
  let effectiveAtIso: string | undefined;
  if (updatedAt instanceof Timestamp) {
    updatedAtIso = updatedAt.toDate().toISOString();
  } else if (typeof updatedAt === "string") {
    updatedAtIso = updatedAt;
  }
  if (effectiveAt instanceof Timestamp) {
    effectiveAtIso = effectiveAt.toDate().toISOString();
  } else if (typeof effectiveAt === "string") {
    effectiveAtIso = effectiveAt;
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
    effectiveAt: effectiveAtIso || updatedAtIso,
    contentSchemaVersion: Number(data.contentSchemaVersion) || 1,
    updatedAt: updatedAtIso,
    updatedBy: data.updatedBy ? String(data.updatedBy) : undefined,
    updatedByName: data.updatedByName ? String(data.updatedByName) : undefined,
  };
}

function needsContentMigration(doc: PlatformDocument): boolean {
  if ((doc.contentSchemaVersion || 1) < PLATFORM_DOCUMENT_CONTENT_SCHEMA_VERSION) return true;
  if (!doc.headerLine) return true;
  if (!doc.effectiveAt && !doc.updatedAt) return true;
  if (doc.sections.length < minimumSectionCount(doc.slug)) return true;
  return false;
}

export async function ensurePlatformDocument(slug: PlatformDocumentSlug): Promise<PlatformDocument> {
  const db = adminDb();
  const ref = db.collection(COLLECTION).doc(slug);
  const snap = await ref.get();
  const seed = getDefaultPlatformDocument(slug);

  if (!snap.exists) {
    await ref.set(
      toFirestoreDocument(seed, {
        updatedAt: FieldValue.serverTimestamp(),
        effectiveAt: FieldValue.serverTimestamp(),
      })
    );
    const created = await ref.get();
    return withResolvedDocumentMetadata(mapDoc(slug, created.data()!));
  }

  const existing = mapDoc(slug, snap.data()!);
  if (!needsContentMigration(existing)) {
    return withResolvedDocumentMetadata(existing);
  }

  const migrated: PlatformDocument = {
    ...seed,
    version: existing.version || seed.version,
    updatedAt: existing.updatedAt || seed.updatedAt,
    effectiveAt: existing.effectiveAt || existing.updatedAt || seed.effectiveAt,
    updatedBy: existing.updatedBy,
    updatedByName: existing.updatedByName || "System",
    contentSchemaVersion: PLATFORM_DOCUMENT_CONTENT_SCHEMA_VERSION,
  };

  await ref.set(
    toFirestoreDocument(migrated, {
      updatedAt: FieldValue.serverTimestamp(),
      effectiveAt: migrated.effectiveAt
        ? migrated.effectiveAt
        : FieldValue.serverTimestamp(),
    }),
    { merge: true }
  );

  const refreshed = await ref.get();
  return withResolvedDocumentMetadata(mapDoc(slug, refreshed.data()!));
}

export async function getPlatformDocument(slug: PlatformDocumentSlug): Promise<PlatformDocument> {
  return ensurePlatformDocument(slug);
}

function timestampToIso(value: unknown): string | undefined {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === "string") return value;
  return undefined;
}

export async function listPlatformDocumentVersions(
  slug: PlatformDocumentSlug
): Promise<PlatformDocumentVersionEntry[]> {
  const current = await getPlatformDocument(slug);
  const db = adminDb();
  const snap = await db.collection(COLLECTION).doc(slug).collection("versions").get();

  const archived = snap.docs
    .map((d) => {
      const data = d.data();
      return {
        version: Number(data.version) || Number(d.id) || 1,
        effectiveAt: timestampToIso(data.effectiveAt) || timestampToIso(data.updatedAt),
        updatedAt: timestampToIso(data.updatedAt),
        updatedByName: data.updatedByName ? String(data.updatedByName) : undefined,
        isCurrent: false,
      };
    })
    .filter((entry) => entry.version !== current.version);

  const entries = [
    {
      version: current.version,
      effectiveAt: current.effectiveAt || current.updatedAt,
      updatedAt: current.updatedAt,
      updatedByName: current.updatedByName,
      isCurrent: true,
    },
    ...archived,
  ];

  return entries.sort((a, b) => b.version - a.version);
}

export async function getPlatformDocumentByVersion(
  slug: PlatformDocumentSlug,
  version: number
): Promise<PlatformDocument> {
  const current = await getPlatformDocument(slug);
  if (version === current.version) {
    return current;
  }

  const db = adminDb();
  const snap = await db.collection(COLLECTION).doc(slug).collection("versions").doc(String(version)).get();
  if (!snap.exists) {
    throw new Error(`Document version ${version} not found.`);
  }

  return withResolvedDocumentMetadata(mapDoc(slug, snap.data()!));
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
    version: number;
  },
  admin: { uid: string; name?: string }
): Promise<PlatformDocument> {
  const db = adminDb();
  const ref = db.collection(COLLECTION).doc(slug);
  const existing = await ensurePlatformDocument(slug);
  const nextVersion = input.version;

  if (!Number.isFinite(nextVersion) || nextVersion <= 0) {
    throw new Error("Invalid version number.");
  }
  if (nextVersion === existing.version) {
    throw new Error(
      `Version ${nextVersion} is already the current live version. Enter a different version number.`
    );
  }

  const archiveRef = ref.collection("versions").doc(String(nextVersion));
  const archiveSnap = await archiveRef.get();
  if (archiveSnap.exists) {
    throw new Error(
      `Version ${nextVersion} already exists in the archive. Choose a different version number.`
    );
  }

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
    effectiveAt: FieldValue.serverTimestamp(),
    updatedBy: admin.uid,
    updatedByName: admin.name || "Admin",
  };

  await ref.set(payload, { merge: true });

  await ref.collection("versions").doc(String(existing.version)).set(
    toFirestoreDocument(existing, {
      archivedAt: FieldValue.serverTimestamp(),
      archivedBy: admin.uid,
    })
  );

  const updated = await ref.get();
  return withResolvedDocumentMetadata(mapDoc(slug, updated.data()!));
}

export async function deletePlatformDocumentVersion(
  slug: PlatformDocumentSlug,
  version: number
): Promise<void> {
  const current = await getPlatformDocument(slug);
  if (version === current.version) {
    throw new Error("Cannot delete the current live version.");
  }

  const db = adminDb();
  const ref = db.collection(COLLECTION).doc(slug).collection("versions").doc(String(version));
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error(`Archived version ${version} not found.`);
  }

  await ref.delete();
}
