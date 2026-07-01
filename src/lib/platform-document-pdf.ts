import jsPDF from "jspdf";
import type {
  PlatformDocument,
  PlatformDocumentControlRow,
} from "./platform-documents-types";
import { withResolvedDocumentMetadata } from "./platform-document-control";
import {
  applyRunStyle,
  htmlToRichTextRuns,
  isRichTextContent,
} from "./platform-document-rich-text-pdf";

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
  pdf.setDrawColor(200, 200, 200);
  pdf.line(MARGIN, FOOTER_Y - 3, pageWidth - MARGIN, FOOTER_Y - 3);
  pdf.text(footerText(doc, page, total), pageWidth / 2, FOOTER_Y, { align: "center" });
  pdf.setTextColor(0, 0, 0);
}

function ensureSpace(layout: PdfLayout, needed: number, doc: PlatformDocument, pageRef: { current: number; total: number }) {
  if (layout.y + needed <= CONTENT_BOTTOM) return;
  layout.pdf.addPage();
  pageRef.current += 1;
  pageRef.total += 1;
  layout.y = CONTENT_TOP;
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

function addRichTextBody(
  layout: PdfLayout,
  html: string,
  defaultFontSize: number,
  doc: PlatformDocument,
  pageRef: { current: number; total: number }
) {
  const runs = htmlToRichTextRuns(html, defaultFontSize);
  if (!runs.length) return;

  const lineHeightFactor = 0.42;
  let y = layout.y;
  let cursorX = layout.margin;
  const rightEdge = layout.margin + layout.maxWidth;

  const ensureLineSpace = (fontSize: number) => {
    if (y + fontSize * lineHeightFactor > CONTENT_BOTTOM) {
      layout.pdf.addPage();
      pageRef.current += 1;
      pageRef.total += 1;
      y = CONTENT_TOP;
      cursorX = layout.margin;
    }
  };

  for (const run of runs) {
    const fontSize = run.fontSize || defaultFontSize;

    if (run.text === "\n") {
      cursorX = layout.margin;
      y += fontSize * lineHeightFactor;
      ensureLineSpace(fontSize);
      continue;
    }

    applyRunStyle(layout.pdf, run);
    const parts = run.text.split(/(\s+)/);

    for (const part of parts) {
      if (!part) continue;
      ensureLineSpace(fontSize);
      const width = layout.pdf.getTextWidth(part);
      if (cursorX + width > rightEdge && cursorX > layout.margin) {
        cursorX = layout.margin;
        y += fontSize * lineHeightFactor;
        ensureLineSpace(fontSize);
      }
      layout.pdf.text(part, cursorX, y);
      if (run.underline && part.trim()) {
        layout.pdf.setDrawColor(0, 0, 0);
        layout.pdf.line(cursorX, y + 0.8, cursorX + width, y + 0.8);
      }
      cursorX += width;
    }
  }

  layout.y = y + defaultFontSize * lineHeightFactor + 2;
}

function addBodyContent(
  layout: PdfLayout,
  text: string,
  fontSize: number,
  doc: PlatformDocument,
  pageRef: { current: number; total: number }
) {
  if (isRichTextContent(text)) {
    addRichTextBody(layout, text, fontSize, doc, pageRef);
    return;
  }
  addParagraph(layout, text, fontSize, false, doc, pageRef);
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

export async function generatePlatformDocumentPDF(doc: PlatformDocument): Promise<Blob> {
  const resolved = withResolvedDocumentMetadata(doc);
  const pdf = new jsPDF("p", "mm", "a4");
  const layout = createLayout(pdf);
  const pageRef = { current: 1, total: 1 };

  if (resolved.coverTitle) {
    addParagraph(layout, resolved.coverTitle, 16, true, doc, pageRef, 0.5);
    layout.y += 2;
  }
  if (resolved.coverSubtitle) {
    addParagraph(layout, resolved.coverSubtitle, 10, false, doc, pageRef);
    layout.y += 2;
  }

  if (resolved.documentControl?.length) {
    drawKeyValueTable(
      layout,
      resolved.documentControl,
      doc,
      pageRef,
      resolved.showDocumentControlHeading ?? resolved.slug === "msa"
    );
  }

  if (resolved.preamble) {
    addParagraph(layout, "Important Notice", 11, true, doc, pageRef);
    addBodyContent(layout, resolved.preamble, 9, doc, pageRef);
  }

  if (resolved.intro) {
    addBodyContent(layout, resolved.intro, 9, doc, pageRef);
  }

  if (resolved.tableOfContents) {
    addParagraph(layout, "Table of Contents", 11, true, doc, pageRef);
    addBodyContent(layout, resolved.tableOfContents, 8.5, doc, pageRef);
  }

  for (const section of resolved.sections) {
    addParagraph(layout, section.title, 10, true, doc, pageRef);
    addBodyContent(layout, section.body, 9, doc, pageRef);
  }

  const totalPages = pdf.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);
    drawPageChrome(layout, resolved, i, totalPages);
  }

  return pdf.output("blob");
}

export function platformDocumentPdfFilename(doc: PlatformDocument): string {
  const version = formatVersion(doc).replace(/\s+/g, "");
  const slugLabel =
    doc.slug === "msa" ? "MSA" : doc.slug === "terms" ? "Schedule-A" : "Schedule-D";
  return `Prep-Services-FBA-${slugLabel}-v${version}.pdf`;
}
