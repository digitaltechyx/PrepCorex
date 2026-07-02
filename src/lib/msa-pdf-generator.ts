import type { PlatformDocument } from "@/lib/platform-documents-types";
import {
  generatePlatformDocumentPDF,
  type SignedMsaAcceptanceData,
} from "@/lib/platform-document-pdf";

export interface MSAClientDetails {
  legalName: string;
  companyName: string;
  address: string;
  email: string;
  phone: string;
}

export interface MSAExportData {
  effectiveDate: string;
  clientDetails: MSAClientDetails;
  acceptedAt?: string;
}

/**
 * Generates signed MSA PDF. Uses platform legal template when provided; otherwise legacy static text.
 */
export async function generateMSAPDF(
  data: MSAExportData,
  platformDoc?: PlatformDocument | null
): Promise<Blob> {
  if (platformDoc) {
    const acceptance: SignedMsaAcceptanceData = {
      effectiveDate: data.effectiveDate,
      clientDetails: data.clientDetails,
      acceptedAt: data.acceptedAt,
    };
    return generatePlatformDocumentPDF(platformDoc, { signedMsaAcceptance: acceptance });
  }

  const { default: jsPDF } = await import("jspdf");
  const { MSA_SERVICE_PROVIDER, MSA_AGREEMENT_SECTIONS } = await import("./msa-content");
  const doc = new jsPDF("p", "mm", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 18;
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  const addText = (text: string, fontSize: number = 10, isBold = false) => {
    doc.setFontSize(fontSize);
    doc.setFont("helvetica", isBold ? "bold" : "normal");
    const lines = doc.splitTextToSize(text, maxWidth);
    lines.forEach((line: string) => {
      if (y > 270) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin, y);
      y += fontSize * 0.45;
    });
    y += 2;
  };

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Prep Services FBA", margin, y);
  y += 10;
  doc.setFontSize(14);
  doc.text("MASTER SERVICE AGREEMENT", margin, y);
  y += 12;

  addText(
    `This Master Service Agreement ("Agreement") is entered into as of ${data.effectiveDate}, by and between:`,
    10
  );

  doc.setFont("helvetica", "bold");
  doc.text("Service Provider", margin, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  addText(MSA_SERVICE_PROVIDER.name, 10);
  addText(MSA_SERVICE_PROVIDER.address.replace(/\n/g, ", "), 10);
  addText(`${MSA_SERVICE_PROVIDER.email} | ${MSA_SERVICE_PROVIDER.phone}`, 10);
  y += 4;

  doc.setFont("helvetica", "bold");
  doc.text("Client", margin, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  addText(data.clientDetails.companyName, 10);
  addText(data.clientDetails.address, 10);
  addText(`${data.clientDetails.email} | ${data.clientDetails.phone}`, 10);
  y += 6;

  MSA_AGREEMENT_SECTIONS.forEach((section) => {
    addText(section.title, 10, true);
    addText(section.body, 9);
  });

  addText(
    "ACCEPTANCE: This Agreement may be executed electronically and shall be deemed legally binding upon digital acceptance.",
    10,
    true
  );
  addText(`Accepted by: ${data.clientDetails.legalName}`, 10);
  if (data.acceptedAt) addText(`Date: ${data.acceptedAt}`, 10);

  return doc.output("blob");
}
