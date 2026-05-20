import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont, type PDFImage } from "pdf-lib";
import type { WarehousePalletDoc } from "@/types";
import { encodePalletBarcode } from "@/lib/warehouse-carton-barcode";
import {
  drawFramedLabel,
  ink,
  muted,
  palletAccent,
  palletAccentLight,
  pdfText,
  qrPngBytes,
} from "@/lib/warehouse-handling-label-pdf-shared";

function drawPalletLabel(
  page: PDFPage,
  xLeft: number,
  yTop: number,
  w: number,
  h: number,
  pallet: WarehousePalletDoc,
  font: PDFFont,
  fontBold: PDFFont,
  img: PDFImage
) {
  const borderW = 4;
  const { bottom, innerX, innerW, innerH } = drawFramedLabel(
    page,
    xLeft,
    yTop,
    w,
    h,
    palletAccent,
    borderW
  );

  const headerH = Math.min(22, innerH * 0.12);
  const footerH = Math.max(36, innerH * 0.2);
  const bodyH = innerH - headerH - footerH;
  const headerBottom = bottom + innerH - headerH;

  page.drawRectangle({
    x: innerX,
    y: headerBottom,
    width: innerW,
    height: headerH,
    color: palletAccent,
  });
  page.drawText(pdfText("PALLET"), {
    x: innerX + 6,
    y: headerBottom + (headerH - 8) / 2,
    size: 8,
    font: fontBold,
    color: rgb(1, 1, 1),
  });
  page.drawText(pdfText("Mixed SKU · move as unit"), {
    x: innerX + 52,
    y: headerBottom + (headerH - 6) / 2,
    size: 5.5,
    font,
    color: rgb(1, 1, 1),
    maxWidth: innerW - 64,
  });

  // Body: centered QR on tinted panel
  page.drawRectangle({
    x: innerX,
    y: bottom + footerH,
    width: innerW,
    height: bodyH,
    color: palletAccentLight,
  });

  const qrPad = 8;
  const qrSide = Math.min(innerW - qrPad * 2, bodyH - qrPad * 2);
  const qx = innerX + (innerW - qrSide) / 2;
  const qy = bottom + footerH + (bodyH - qrSide) / 2;
  page.drawRectangle({
    x: qx - 4,
    y: qy - 4,
    width: qrSide + 8,
    height: qrSide + 8,
    color: rgb(1, 1, 1),
  });
  page.drawImage(img, { x: qx, y: qy, width: qrSide, height: qrSide });

  // Footer: large pallet ID
  page.drawRectangle({
    x: innerX,
    y: bottom,
    width: innerW,
    height: footerH,
    color: rgb(1, 1, 1),
  });
  page.drawLine({
    start: { x: innerX, y: bottom + footerH },
    end: { x: innerX + innerW, y: bottom + footerH },
    thickness: 0.5,
    color: rgb(0.88, 0.9, 0.93),
  });

  const codeSize = innerW < 180 ? 11 : 13;
  const codeText = pdfText(pallet.palletCode);
  const codeW = fontBold.widthOfTextAtSize(codeText, codeSize);
  page.drawText(codeText, {
    x: innerX + (innerW - codeW) / 2,
    y: bottom + footerH - codeSize - 10,
    size: codeSize,
    font: fontBold,
    color: ink,
  });
  page.drawText(pdfText("Scan pallet + bin at putaway"), {
    x: innerX + 6,
    y: bottom + 6,
    size: 5,
    font,
    color: muted,
    maxWidth: innerW - 12,
  });
}

export async function buildWarehousePalletLabelsPdf(options: {
  title: string;
  pallets: WarehousePalletDoc[];
}): Promise<Uint8Array> {
  const list = [...options.pallets].filter((p) => p.palletCode);
  if (list.length === 0) throw new Error("No pallets to print.");

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pageW = 612;
  const pageH = 792;
  const margin = 32;
  const headerBand = 36;
  const labelSize = 220;
  const gutter = 14;
  const cols = 2;
  const rowsPerPage = 3;

  let page = pdf.addPage([pageW, pageH]);
  let idx = 0;
  const startY = pageH - margin - headerBand;

  const drawPageTitle = (p: PDFPage) => {
    p.drawText(pdfText(options.title), {
      x: margin,
      y: pageH - margin - 14,
      size: 11,
      font: fontBold,
      color: ink,
    });
    p.drawText(pdfText("Pallet labels (indigo) — groups cartons for mixed-SKU inbound."), {
      x: margin,
      y: pageH - margin - 28,
      size: 6.5,
      font,
      color: muted,
    });
  };

  drawPageTitle(page);

  for (const pallet of list) {
    if (idx > 0 && idx % (cols * rowsPerPage) === 0) {
      page = pdf.addPage([pageW, pageH]);
      idx = 0;
      drawPageTitle(page);
    }
    const col = idx % cols;
    const row = Math.floor((idx % (cols * rowsPerPage)) / cols);
    const x0 = margin + col * (labelSize + gutter);
    const yTop = startY - row * (labelSize + gutter);

    const payload = pallet.barcode || encodePalletBarcode(pallet.palletCode);
    const png = await qrPngBytes(payload, 260);
    const img = await pdf.embedPng(png);
    drawPalletLabel(page, x0, yTop, labelSize, labelSize, pallet, font, fontBold, img);
    idx += 1;
  }

  return pdf.save();
}

export { downloadUint8ArrayAsFile } from "@/lib/warehouse-bin-label-pdf";
