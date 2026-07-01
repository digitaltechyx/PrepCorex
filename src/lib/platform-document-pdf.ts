import jsPDF from "jspdf";
import type {
  PlatformDocument,
  PlatformDocumentControlRow,
  PlatformDocumentRevisionRow,
} from "./platform-documents-types";

const HEADER_COLOR: [number, number, number] = [30, 58, 95];
const TABLE_HEADER_BG: [number, number, number] = [30, 58, 95];
const MARGIN = 18;
const HEADER_Y = 12;
const FOOTER_Y = 287;
const CONTENT_TOP = 22;
const CONTENT_BOTTOM = 275;

function formatVersion(doc: PlatformDocument): string {
  const v = doc.version || 1;
  return Number.isInteger(v) ? `${v}.0` : String(v);
}

function headerText(doc: PlatformDocument): string {
  const version = formatVersion(doc);
  if (doc.slug === "msa") {
    return `PREP SERVICES FBA LLC | Master Service Agreement | Version ${version}`;
  }
  const base = doc.headerLine || doc.title;
  return `${base} | Version ${version}`;
}

function footerText(doc: PlatformDocument, page: number, total: number): string {
  const label = doc.footerLine || "Prep Services FBA LLC";
  return `${label} | ${page} of ${total}`;
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\t/g, " ").trim();
}

type PdfLayout = {
  pdf: jsPDF;
  y: number;
  pageWidth: number;
  maxWidth: number;
  margin: number;
};

function createLayout(pdf: jsPDF): PdfLayout {
  return {
    pdf,
    y: CONTENT_TOP,
    pageWidth: pdf.internal.pageSize.getWidth(),
    maxWidth: pdf.internal.pageSize.getWidth() - MARGIN * 2,
    margin: MARGIN,
  };
}

function drawPageChrome(layout: PdfLayout, doc: PlatformDocument, page: number, total: number) {
  const { pdf, pageWidth } = layout;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(...HEADER_COLOR);
  const header = headerText(doc);
  pdf.text(header, pageWidth / 2, HEADER_Y, { align: "center" });
  pdf.setDrawColor(200, 200, 200);
  pdf.line(MARGIN, HEADER_Y + 2, pageWidth - MARGIN, HEADER_Y + 2);

  pdf.setFontSize(7);
  pdf.setTextColor(100, 100, 100);
  pdf.text(footerText(doc, page, total), pageWidth / 2, FOOTER_Y, { align: "center" });
  pdf.setTextColor(0, 0, 0);
}

function ensureSpace(layout: PdfLayout, needed: number, doc: PlatformDocument, pageRef: { current: number; total: number }) {
  if (layout.y + needed <= CONTENT_BOTTOM) return;
  layout.pdf.addPage();
  pageRef.current += 1;
  pageRef.total += 1;
  layout.y = CONTENT_TOP;
  drawPageChrome(layout, doc, pageRef.current, pageRef.total);
}

function addParagraph(
  layout: PdfLayout,
  text: string,
  fontSize: number,
  isBold = false,
  doc: PlatformDocument,
  pageRef: { current: number; total: number },
  lineGap = 0.42
) {
  const content = normalizeText(text);
  if (!content) return;
  layout.pdf.setFontSize(fontSize);
  layout.pdf.setFont("helvetica", isBold ? "bold" : "normal");
  const lines = layout.pdf.splitTextToSize(content, layout.maxWidth);
  const lineHeight = fontSize * lineGap;
  for (const line of lines) {
    ensureSpace(layout, lineHeight + 1, doc, pageRef);
    layout.pdf.text(line, layout.margin, layout.y);
    layout.y += lineHeight;
  }
  layout.y += 2;
}

function drawKeyValueTable(
  layout: PdfLayout,
  rows: PlatformDocumentControlRow[],
  doc: PlatformDocument,
  pageRef: { current: number; total: number },
  showHeading: boolean
) {
  if (!rows.length) return;

  if (showHeading) {
    addParagraph(layout, "Document Control", 11, true, doc, pageRef);
    layout.y += 1;
  }

  const col1 = layout.maxWidth * 0.35;
  const col2 = layout.maxWidth * 0.65;
  const rowHeight = 7;
  const tableWidth = layout.maxWidth;

  ensureSpace(layout, rowHeight + 4, doc, pageRef);

  const drawHeader = () => {
    layout.pdf.setFillColor(...TABLE_HEADER_BG);
    layout.pdf.rect(layout.margin, layout.y - 4.5, tableWidth, rowHeight, "F");
    layout.pdf.setTextColor(255, 255, 255);
    layout.pdf.setFontSize(9);
    layout.pdf.setFont("helvetica", "bold");
    layout.pdf.text("Field", layout.margin + 2, layout.y);
    layout.pdf.text("Value", layout.margin + col1 + 2, layout.y);
    layout.pdf.setTextColor(0, 0, 0);
    layout.y += rowHeight;
  };

  drawHeader();

  for (const row of rows) {
    ensureSpace(layout, rowHeight + 2, doc, pageRef);
    if (layout.y > CONTENT_BOTTOM - rowHeight) {
      drawHeader();
    }
    layout.pdf.setDrawColor(210, 210, 210);
    layout.pdf.rect(layout.margin, layout.y - 4.5, tableWidth, rowHeight);
    layout.pdf.line(layout.margin + col1, layout.y - 4.5, layout.margin + col1, layout.y - 4.5 + rowHeight);
    layout.pdf.setFontSize(8.5);
    layout.pdf.setFont("helvetica", "bold");
    layout.pdf.text(row.field, layout.margin + 2, layout.y);
    layout.pdf.setFont("helvetica", "normal");
    const valueLines = layout.pdf.splitTextToSize(row.value, col2 - 4);
    layout.pdf.text(valueLines[0] || "", layout.margin + col1 + 2, layout.y);
    layout.y += rowHeight;
  }
  layout.y += 4;
}

function drawRevisionTable(
  layout: PdfLayout,
  rows: PlatformDocumentRevisionRow[],
  doc: PlatformDocument,
  pageRef: { current: number; total: number }
) {
  if (!rows.length) return;
  addParagraph(layout, "Revision History", 11, true, doc, pageRef);

  const cols = [22, 38, layout.maxWidth - 60];
  const rowHeight = 7;

  ensureSpace(layout, rowHeight + 4, doc, pageRef);
  layout.pdf.setFillColor(...TABLE_HEADER_BG);
  layout.pdf.rect(layout.margin, layout.y - 4.5, layout.maxWidth, rowHeight, "F");
  layout.pdf.setTextColor(255, 255, 255);
  layout.pdf.setFontSize(8);
  layout.pdf.setFont("helvetica", "bold");
  let x = layout.margin + 2;
  layout.pdf.text("Version", x, layout.y);
  x += cols[0];
  layout.pdf.text("Date", x, layout.y);
  x += cols[1];
  layout.pdf.text("Changes", x, layout.y);
  layout.pdf.setTextColor(0, 0, 0);
  layout.y += rowHeight;

  for (const row of rows) {
    ensureSpace(layout, rowHeight + 2, doc, pageRef);
    layout.pdf.setDrawColor(210, 210, 210);
    layout.pdf.rect(layout.margin, layout.y - 4.5, layout.maxWidth, rowHeight);
    layout.pdf.setFontSize(8);
    layout.pdf.setFont("helvetica", "normal");
    x = layout.margin + 2;
    layout.pdf.text(row.version, x, layout.y);
    x += cols[0];
    layout.pdf.text(row.date, x, layout.y);
    x += cols[1];
    const changeLines = layout.pdf.splitTextToSize(row.changes, cols[2] - 4);
    layout.pdf.text(changeLines[0] || "", x, layout.y);
    layout.y += rowHeight;
  }
  layout.y += 4;
}

export async function generatePlatformDocumentPDF(doc: PlatformDocument): Promise<Blob> {
  const pdf = new jsPDF("p", "mm", "a4");
  const layout = createLayout(pdf);
  const pageRef = { current: 1, total: 1 };

  drawPageChrome(layout, doc, pageRef.current, pageRef.total);

  if (doc.coverTitle) {
    addParagraph(layout, doc.coverTitle, 16, true, doc, pageRef, 0.5);
    layout.y += 2;
  }
  if (doc.coverSubtitle) {
    addParagraph(layout, doc.coverSubtitle, 10, false, doc, pageRef);
    layout.y += 2;
  }

  if (doc.documentControl?.length) {
    drawKeyValueTable(
      layout,
      doc.documentControl,
      doc,
      pageRef,
      doc.showDocumentControlHeading ?? doc.slug === "msa"
    );
  }

  if (doc.revisionHistory?.length) {
    drawRevisionTable(layout, doc.revisionHistory, doc, pageRef);
  }

  if (doc.preamble) {
    addParagraph(layout, "Important Notice", 11, true, doc, pageRef);
    addParagraph(layout, doc.preamble, 9, false, doc, pageRef);
  }

  if (doc.intro) {
    addParagraph(layout, doc.intro, 9, false, doc, pageRef);
  }

  if (doc.tableOfContents) {
    addParagraph(layout, "Table of Contents", 11, true, doc, pageRef);
    addParagraph(layout, doc.tableOfContents, 8.5, false, doc, pageRef);
  }

  for (const section of doc.sections) {
    addParagraph(layout, section.title, 10, true, doc, pageRef);
    addParagraph(layout, section.body, 9, false, doc, pageRef);
  }

  const totalPages = pdf.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);
    drawPageChrome(layout, doc, i, totalPages);
  }
  pageRef.total = totalPages;

  return pdf.output("blob");
}

export function platformDocumentPdfFilename(doc: PlatformDocument): string {
  const version = formatVersion(doc).replace(/\s+/g, "");
  const slugLabel =
    doc.slug === "msa" ? "MSA" : doc.slug === "terms" ? "Schedule-A" : "Schedule-D";
  return `Prep-Services-FBA-${slugLabel}-v${version}.pdf`;
}
