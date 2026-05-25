import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont, type PDFImage } from "pdf-lib";
import type { WarehouseCartonDoc } from "@/types";
import { cartonBarcodeFromDoc } from "@/lib/warehouse-carton-barcode";
import {
  cartonAccent,
  cartonAccentLight,
  drawFieldRow,
  drawFramedLabel,
  ink,
  muted,
  pdfText,
  qrPngBytes,
} from "@/lib/warehouse-handling-label-pdf-shared";

function drawCartonLabel(
  page: PDFPage,
  xLeft: number,
  yTop: number,
  w: number,
  h: number,
  carton: WarehouseCartonDoc,
  font: PDFFont,
  fontBold: PDFFont,
  img: PDFImage
) {
  const borderW = h < 100 ? 3 : 4;
  const isMixed = !!carton.isMixed || (carton.lines && carton.lines.length > 1) || false;
  const hasDamaged = !!carton.lines?.some((l) => l.condition === "damaged");

  const { bottom, innerX, innerW, innerH } = drawFramedLabel(
    page,
    xLeft,
    yTop,
    w,
    h,
    cartonAccent,
    borderW
  );

  const headerH = Math.min(18, innerH * 0.14);
  const footerH = Math.max(22, innerH * 0.22);
  const bodyH = innerH - headerH - footerH;
  const headerBottom = bottom + innerH - headerH;
  const bodyBottom = bottom + footerH;

  // Header band
  page.drawRectangle({
    x: innerX,
    y: headerBottom,
    width: innerW,
    height: headerH,
    color: cartonAccent,
  });
  const headerLabel = isMixed ? "MIXED CARTON" : "CARTON";
  page.drawText(pdfText(headerLabel), {
    x: innerX + 6,
    y: headerBottom + (headerH - 7) / 2,
    size: 7,
    font: fontBold,
    color: rgb(1, 1, 1),
  });
  const codeSize = innerW < 200 ? 7.5 : 8.5;
  const codeText = pdfText(carton.cartonCode);
  const codeW = fontBold.widthOfTextAtSize(codeText, codeSize);
  page.drawText(codeText, {
    x: innerX + innerW - codeW - 6,
    y: headerBottom + (headerH - codeSize) / 2,
    size: codeSize,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  // Body: QR left + SKU block right
  const halfW = innerW / 2;
  const qrPad = 5;
  const qrSide = Math.min(halfW - qrPad * 2, bodyH - qrPad * 2);

  page.drawRectangle({
    x: innerX,
    y: bodyBottom,
    width: halfW,
    height: bodyH,
    color: rgb(1, 1, 1),
  });
  page.drawRectangle({
    x: innerX + halfW,
    y: bodyBottom,
    width: halfW,
    height: bodyH,
    color: cartonAccentLight,
  });
  const qx = innerX + (halfW - qrSide) / 2;
  const qy = bodyBottom + (bodyH - qrSide) / 2;
  page.drawImage(img, { x: qx, y: qy, width: qrSide, height: qrSide });

  const textX = innerX + halfW + 8;
  const textW = halfW - 14;
  let ty = bodyBottom + bodyH - 10;

  if (isMixed && carton.lines && carton.lines.length > 0) {
    page.drawText(pdfText(`LINES (${carton.lines.length})`), {
      x: textX,
      y: ty,
      size: 5,
      font,
      color: muted,
    });
    ty -= 9;
    const lineSize = innerW < 200 ? 6.5 : 7.5;
    const lineHeight = lineSize + 2;
    const maxLines = Math.floor((ty - bodyBottom - 4) / lineHeight);
    const shown = carton.lines.slice(0, maxLines);
    for (const line of shown) {
      const tag = line.condition === "damaged" ? " (DMG)" : "";
      const text = pdfText(`${line.sku} × ${line.quantity}${tag}`);
      page.drawText(text, {
        x: textX,
        y: ty,
        size: lineSize,
        font: line.condition === "damaged" ? fontBold : font,
        color: line.condition === "damaged" ? rgb(0.7, 0.15, 0.15) : ink,
        maxWidth: textW,
      });
      ty -= lineHeight;
    }
    if (carton.lines.length > shown.length) {
      page.drawText(pdfText(`+${carton.lines.length - shown.length} more (see manifest)`), {
        x: textX,
        y: ty,
        size: 5,
        font,
        color: muted,
        maxWidth: textW,
      });
    }
  } else {
    const skuSize = innerW < 200 ? 10 : 11;
    page.drawText(pdfText("SKU"), { x: textX, y: ty, size: 5, font, color: muted });
    ty -= skuSize + 2;
    page.drawText(pdfText(carton.sku), {
      x: textX,
      y: ty,
      size: skuSize,
      font: fontBold,
      color: ink,
      maxWidth: textW,
    });

    ty -= 10;
    if (carton.lot) {
      drawFieldRow(page, textX, ty - 10, "LOT", carton.lot, font, fontBold, textW, 7);
      ty -= 22;
    }
    if (carton.expiry) {
      drawFieldRow(page, textX, ty - 10, "EXP", carton.expiry.slice(0, 10), font, fontBold, textW, 7);
      ty -= 22;
    }
  }

  // Footer: qty + damaged badge + brand
  page.drawRectangle({
    x: innerX,
    y: bottom,
    width: innerW,
    height: footerH,
    color: rgb(0.97, 0.98, 0.99),
  });
  page.drawLine({
    start: { x: innerX, y: bottom + footerH },
    end: { x: innerX + innerW, y: bottom + footerH },
    thickness: 0.5,
    color: rgb(0.88, 0.9, 0.93),
  });

  const qtySize = footerH > 26 ? 14 : 12;
  page.drawText(pdfText("QTY"), {
    x: innerX + 8,
    y: bottom + footerH - 10,
    size: 5,
    font,
    color: muted,
  });
  page.drawText(pdfText(String(carton.quantity)), {
    x: innerX + 8,
    y: bottom + 6,
    size: qtySize,
    font: fontBold,
    color: cartonAccent,
  });

  if (hasDamaged) {
    const badgeText = "DAMAGED → QUARANTINE";
    const badgeSize = 6;
    const badgeW = fontBold.widthOfTextAtSize(badgeText, badgeSize) + 10;
    const badgeH = 12;
    const bx = innerX + innerW / 2 - badgeW / 2;
    const by = bottom + (footerH - badgeH) / 2;
    page.drawRectangle({
      x: bx,
      y: by,
      width: badgeW,
      height: badgeH,
      color: rgb(0.85, 0.18, 0.18),
    });
    page.drawText(pdfText(badgeText), {
      x: bx + 5,
      y: by + (badgeH - badgeSize) / 2,
      size: badgeSize,
      font: fontBold,
      color: rgb(1, 1, 1),
    });
  }

  page.drawText(pdfText("PrepCorex"), {
    x: innerX + innerW - 52,
    y: bottom + 8,
    size: 5.5,
    font,
    color: muted,
  });
}

export async function buildWarehouseCartonLabelsPdf(options: {
  title: string;
  cartons: WarehouseCartonDoc[];
}): Promise<Uint8Array> {
  const list = [...options.cartons].filter((c) => c.cartonCode && c.sku);
  if (list.length === 0) throw new Error("No cartons to print.");

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pageW = 612;
  const pageH = 792;
  const margin = 24;
  const headerBand = 44;
  /** ~4" × 2.75" landscape sticker */
  const LABEL_ASPECT = 4 / 2.75;
  const gutter = 8;
  const cols = 2;

  const usableW = pageW - 2 * margin - gutter * (cols - 1);
  const labelW = usableW / cols;
  const labelH = labelW / LABEL_ASPECT;
  const usableH = pageH - 2 * margin - headerBand;
  const rows = Math.max(1, Math.floor((usableH + gutter) / (labelH + gutter)));
  const gridH = rows * labelH + (rows - 1) * gutter;
  const gridTopOffset = Math.max(0, (usableH - gridH) / 2);
  const row0Top = pageH - margin - headerBand - gridTopOffset;

  let page = pdf.addPage([pageW, pageH]);
  let idxOnPage = 0;

  const drawHeader = (p: PDFPage) => {
    p.drawText(pdfText(options.title), {
      x: margin,
      y: pageH - margin - 14,
      size: 11,
      font: fontBold,
      color: ink,
    });
    p.drawText(
      pdfText("Carton labels (orange) — scan at receiving, putaway, pick. QR encodes SKU, lot, expiry, qty, carton ID."),
      {
        x: margin,
        y: pageH - margin - 28,
        size: 6.5,
        font,
        color: muted,
      }
    );
  };

  drawHeader(page);

  for (let i = 0; i < list.length; i++) {
    if (idxOnPage >= cols * rows) {
      page = pdf.addPage([pageW, pageH]);
      idxOnPage = 0;
      drawHeader(page);
    }
    const col = idxOnPage % cols;
    const row = Math.floor(idxOnPage / cols);
    const x0 = margin + col * (labelW + gutter);
    const yTop = row0Top - row * (labelH + gutter);

    const carton = list[i];
    const payload = carton.barcode || cartonBarcodeFromDoc(carton);
    const png = await qrPngBytes(payload, 240);
    const img = await pdf.embedPng(png);
    drawCartonLabel(page, x0, yTop, labelW, labelH, carton, font, fontBold, img);
    idxOnPage += 1;
  }

  return pdf.save();
}

export { downloadUint8ArrayAsFile } from "@/lib/warehouse-bin-label-pdf";
