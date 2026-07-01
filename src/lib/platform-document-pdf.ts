import jsPDF from "jspdf";
import { MSA_SERVICE_PROVIDER } from "./msa-content";
import type { PlatformDocument } from "./platform-documents-types";

export async function generatePlatformDocumentPDF(doc: PlatformDocument): Promise<Blob> {
  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const margin = 18;
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  const addText = (text: string, fontSize: number = 10, isBold = false) => {
    pdf.setFontSize(fontSize);
    pdf.setFont("helvetica", isBold ? "bold" : "normal");
    const lines = pdf.splitTextToSize(text, maxWidth);
    lines.forEach((line: string) => {
      if (y > 270) {
        pdf.addPage();
        y = margin;
      }
      pdf.text(line, margin, y);
      y += fontSize * 0.45;
    });
    y += 2;
  };

  pdf.setFontSize(14);
  pdf.setFont("helvetica", "bold");
  pdf.text("Prep Services FBA", margin, y);
  y += 8;

  pdf.setFontSize(12);
  const titleLines = pdf.splitTextToSize(doc.title, maxWidth);
  titleLines.forEach((line: string) => {
    pdf.text(line, margin, y);
    y += 6;
  });
  y += 4;

  if (doc.subtitle) {
    addText(doc.subtitle, 10);
    y += 2;
  }

  if (doc.slug === "msa") {
    addText(
      `Service Provider: ${MSA_SERVICE_PROVIDER.name}, ${MSA_SERVICE_PROVIDER.address.replace(/\n/g, ", ")}`,
      9
    );
    addText(`${MSA_SERVICE_PROVIDER.email} | ${MSA_SERVICE_PROVIDER.phone}`, 9);
    y += 4;
  }

  addText(`Document version: ${doc.version}`, 9);
  if (doc.updatedAt) {
    addText(`Last updated: ${new Date(doc.updatedAt).toLocaleDateString("en-US")}`, 9);
  }
  y += 4;

  doc.sections.forEach((section) => {
    addText(section.title, 10, true);
    addText(section.body, 9);
  });

  addText(
    "This document was generated from the current PrepCorex legal document repository.",
    8
  );

  return pdf.output("blob");
}

export function platformDocumentPdfFilename(doc: PlatformDocument): string {
  return `PrepCorex-${doc.slug.toUpperCase()}-v${doc.version}.pdf`;
}
