import pdfContent from "./platform-documents-pdf-content.json";
import type {
  PlatformDocument,
  PlatformDocumentSection,
  PlatformDocumentSlug,
} from "./platform-documents-types";
import {
  PLATFORM_DOCUMENT_CONTENT_SCHEMA_VERSION,
  PLATFORM_DOCUMENT_LABELS,
} from "./platform-documents-types";

export { MSA_SERVICE_PROVIDER } from "./msa-content";

type PdfContentEntry = {
  headerLine?: string;
  footerLine?: string;
  showDocumentControlHeading?: boolean;
  coverTitle?: string;
  coverSubtitle?: string;
  documentControl?: { field: string; value: string }[];
  revisionHistory?: { version: string; date: string; changes: string }[];
  preamble?: string;
  intro?: string;
  tableOfContents?: string;
  sections: { title: string; body: string }[];
};

function cleanBody(text: string): string {
  return text
    .replace(/\n-- \d+ of \d+ --\n/g, "\n")
    .replace(/\n\d+\n(?=\n|$)/g, "\n")
    .replace(/\t/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function mapSections(sections: { title: string; body: string }[]): PlatformDocumentSection[] {
  return sections.map((s) => ({
    title: s.title.trim(),
    body: cleanBody(s.body),
  }));
}

function buildFromPdfContent(slug: PlatformDocumentSlug): PlatformDocument {
  const labels = PLATFORM_DOCUMENT_LABELS[slug];
  const raw = pdfContent[slug] as PdfContentEntry;
  const now = new Date().toISOString();

  return {
    slug,
    title: labels.title,
    subtitle: raw.coverSubtitle,
    headerLine: raw.headerLine,
    footerLine: raw.footerLine,
    showDocumentControlHeading: raw.showDocumentControlHeading ?? slug === "msa",
    coverTitle: raw.coverTitle,
    coverSubtitle: raw.coverSubtitle,
    documentControl: raw.documentControl?.map((row) => ({
      field: row.field.trim(),
      value: row.value.trim(),
    })),
    revisionHistory: raw.revisionHistory?.map((row) => ({
      version: row.version.trim(),
      date: row.date.trim(),
      changes: row.changes.trim(),
    })),
    preamble: raw.preamble ? cleanBody(raw.preamble) : undefined,
    intro: raw.intro ? cleanBody(raw.intro) : undefined,
    tableOfContents: raw.tableOfContents ? cleanBody(raw.tableOfContents) : undefined,
    sections: mapSections(raw.sections),
    version: 1,
    contentSchemaVersion: PLATFORM_DOCUMENT_CONTENT_SCHEMA_VERSION,
    updatedAt: now,
    updatedByName: "System",
  };
}

export function getDefaultPlatformDocument(slug: PlatformDocumentSlug): PlatformDocument {
  return buildFromPdfContent(slug);
}

export function getAllDefaultPlatformDocuments(): PlatformDocument[] {
  return (["msa", "terms", "privacy"] as PlatformDocumentSlug[]).map(getDefaultPlatformDocument);
}

export function minimumSectionCount(slug: PlatformDocumentSlug): number {
  if (slug === "msa") return 50;
  if (slug === "terms") return 10;
  return 12;
}
