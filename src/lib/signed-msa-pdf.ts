import type { PlatformDocument } from "@/lib/platform-documents-types";
import {
  generatePlatformDocumentPDF,
  type SignedMsaAcceptanceData,
} from "@/lib/platform-document-pdf";
import type { MSAExportData } from "@/lib/msa-pdf-generator";
import type { UserProfile } from "@/types";

export function createMsaDocumentSnapshot(doc: PlatformDocument): PlatformDocument {
  return JSON.parse(JSON.stringify(doc)) as PlatformDocument;
}

export function toSignedMsaAcceptance(data: MSAExportData): SignedMsaAcceptanceData {
  return {
    effectiveDate: data.effectiveDate,
    clientDetails: data.clientDetails,
    acceptedAt: data.acceptedAt,
  };
}

export async function generateSignedMsaPdf(
  platformDoc: PlatformDocument,
  exportData: MSAExportData
): Promise<Blob> {
  return generatePlatformDocumentPDF(platformDoc, {
    signedMsaAcceptance: toSignedMsaAcceptance(exportData),
  });
}

/** Use frozen snapshot from activation, or fetch current platform MSA as fallback. */
export async function resolveSignedMsaDocument(
  profile: Pick<UserProfile, "msaDocumentSnapshot" | "msaAcceptance">
): Promise<PlatformDocument> {
  if (profile.msaDocumentSnapshot) {
    return profile.msaDocumentSnapshot;
  }

  const res = await fetch("/api/platform-documents/msa");
  const data = await res.json();
  if (!res.ok || !data.document) {
    throw new Error("Could not load MSA document for PDF export.");
  }
  return data.document as PlatformDocument;
}

export async function generateSignedMsaPdfForUser(
  profile: UserProfile,
  exportData: MSAExportData
): Promise<Blob> {
  const platformDoc = await resolveSignedMsaDocument(profile);
  return generateSignedMsaPdf(platformDoc, exportData);
}
