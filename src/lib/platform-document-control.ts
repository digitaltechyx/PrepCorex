import { format } from "date-fns";
import type {
  PlatformDocument,
  PlatformDocumentControlRow,
  PlatformDocumentSlug,
} from "./platform-documents-types";

type DocumentControlTemplate = {
  documentName: string;
  showHeading: boolean;
  includeSupersedes: boolean;
  classification: string;
};

const DOCUMENT_CONTROL_TEMPLATES: Record<PlatformDocumentSlug, DocumentControlTemplate> = {
  msa: {
    documentName: "Master Service Agreement",
    showHeading: true,
    includeSupersedes: true,
    classification: "Client Agreement",
  },
  terms: {
    documentName: "Schedule A — Pricing & Commercial Terms",
    showHeading: false,
    includeSupersedes: false,
    classification: "Client Agreement",
  },
  privacy: {
    documentName: "Schedule D — Privacy, Data Processing & Information Security Policy",
    showHeading: false,
    includeSupersedes: false,
    classification: "Client Agreement",
  },
};

function formatControlDate(value?: string): string {
  if (!value) return format(new Date(), "MMMM dd, yyyy");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return format(new Date(), "MMMM dd, yyyy");
  return format(date, "MMMM dd, yyyy");
}

function formatControlVersion(version?: number): string {
  const v = version || 1;
  return Number.isInteger(v) ? `${v}.0` : String(v);
}

export function buildDocumentControlRows(
  slug: PlatformDocumentSlug,
  doc: Pick<PlatformDocument, "version" | "updatedAt" | "effectiveAt">
): PlatformDocumentControlRow[] {
  const template = DOCUMENT_CONTROL_TEMPLATES[slug];
  const effectiveDate = formatControlDate(doc.effectiveAt || doc.updatedAt);
  const lastUpdated = formatControlDate(doc.updatedAt || doc.effectiveAt);

  const rows: PlatformDocumentControlRow[] = [
    { field: "Document", value: template.documentName },
    { field: "Version", value: formatControlVersion(doc.version) },
    { field: "Effective Date", value: effectiveDate },
    { field: "Last Updated", value: lastUpdated },
  ];

  if (template.includeSupersedes) {
    rows.push({ field: "Supersedes", value: doc.version > 1 ? `Version ${doc.version - 1}.0` : "N/A" });
  }

  rows.push(
    { field: "Approved By", value: "Prep Services FBA LLC" },
    { field: "Document Owner", value: "Operations Department" },
    { field: "Classification", value: template.classification },
    { field: "Status", value: "Active" }
  );

  return rows;
}

export function withResolvedDocumentMetadata(doc: PlatformDocument): PlatformDocument {
  const template = DOCUMENT_CONTROL_TEMPLATES[doc.slug];
  return {
    ...doc,
    showDocumentControlHeading: template.showHeading,
    documentControl: buildDocumentControlRows(doc.slug, doc),
    revisionHistory: undefined,
  };
}

export function getDocumentControlHeading(slug: PlatformDocumentSlug): boolean {
  return DOCUMENT_CONTROL_TEMPLATES[slug].showHeading;
}

export function formatMsaAgreementVersionLabel(
  doc: Pick<PlatformDocument, "version" | "effectiveAt" | "updatedAt">
): string {
  return `MSA v${formatControlVersion(doc.version)} (Effective: ${formatControlDate(doc.effectiveAt || doc.updatedAt)})`;
}
