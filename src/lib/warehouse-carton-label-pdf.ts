import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont, type PDFImage } from "pdf-lib";
import type { WarehouseCartonDoc } from "@/types";
import { cartonBarcodeFromDoc } from "@/lib/warehouse-carton-barcode";
import { isCrossdockClosedCarton } from "@/lib/warehouse-crossdock";
import {
  manifestConditionQtys,
  resolveManifestLotLabel,
  manifestSkuCount,
} from "@/lib/warehouse-label-manifest";
import {
  cartonAccent,
  cartonAccentLight,
  drawFieldRow,
  drawFramedLabel,
  ink,
  muted,
  pdfText,
  qrPngBytes,
  thermal4x6LabelBox,
  thermal4x6PageSize,
} from "@/lib/warehouse-handling-label-pdf-shared";

function drawGoodDamagedQtyLines(
  page: PDFPage,
  textX: number,
  textW: number,
  ty: number,
  carton: WarehouseCartonDoc,
  font: PDFFont,
  fontBold: PDFFont
): number {
  const { goodQty, damagedQty, showSplit } = manifestConditionQtys(carton);
  if (!showSplit) return ty;

  page.drawText(pdfText(`GOOD QTY: ${goodQty}`), {
    x: textX,
    y: ty,
    size: 6.5,
    font: fontBold,
    color: rgb(0.05, 0.45, 0.28),
    maxWidth: textW,
  });
  ty -= 10;
  page.drawText(pdfText(`DAMAGED QTY: ${damagedQty}`), {
    x: textX,
    y: ty,
    size: 6.5,
    font: fontBold,
    color: rgb(0.7, 0.15, 0.15),
    maxWidth: textW,
  });
  ty -= 9;
  page.drawText(pdfText("Damaged → quarantine at putaway"), {
    x: textX,
    y: ty,
    size: 5,
    font,
    color: rgb(0.7, 0.15, 0.15),
    maxWidth: textW,
  });
  return ty - 10;
}

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
  const isLoose = !!carton.isLoose;
  const isClosed = isCrossdockClosedCarton(carton);
  const { damagedQty, showSplit } = manifestConditionQtys(carton);
  const hasDamaged = damagedQty > 0;

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
  const headerLabel = isLoose
    ? isMixed
      ? "OPEN RECEIVING · MIXED"
      : "OPEN RECEIVING"
    : isClosed
    ? "CROSS-DOCK · CLOSED"
    : isMixed
    ? "MIXED CARTON"
    : "CARTON";
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

  if (isClosed) {
    page.drawText(pdfText("CONTENTS NOT OPENED"), {
      x: textX,
      y: ty,
      size: innerW < 200 ? 8 : 9,
      font: fontBold,
      color: ink,
      maxWidth: textW,
    });
    ty -= 12;
    if (carton.productTitle?.includes("—")) {
      page.drawText(pdfText(carton.productTitle.slice(0, 48)), {
        x: textX,
        y: ty,
        size: 6.5,
        font,
        color: ink,
        maxWidth: textW,
      });
      ty -= 10;
    }
    if (carton.lot) {
      drawFieldRow(page, textX, ty - 10, "LOT", carton.lot, font, fontBold, textW, 7);
      ty -= 22;
    }
    page.drawText(pdfText("Scan CTN at putaway"), {
      x: textX,
      y: ty,
      size: 6.5,
      font,
      color: muted,
      maxWidth: textW,
    });
  } else if (isMixed && carton.lines && carton.lines.length > 0) {
    const skuCount = manifestSkuCount(carton);
    const lotLabel = resolveManifestLotLabel(carton);
    const totalUnits = carton.lines.reduce((sum, l) => sum + Math.max(0, l.quantity), 0);

    drawFieldRow(
      page,
      textX,
      ty - 10,
      "SKUS",
      String(skuCount),
      font,
      fontBold,
      textW,
      8
    );
    ty -= 22;

    drawFieldRow(
      page,
      textX,
      ty - 10,
      "UNITS",
      String(totalUnits),
      font,
      fontBold,
      textW,
      8
    );
    ty -= 22;

    if (lotLabel) {
      drawFieldRow(page, textX, ty - 10, "LOT", lotLabel, font, fontBold, textW, 6.5);
      ty -= 20;
    }

    ty = drawGoodDamagedQtyLines(page, textX, textW, ty, carton, font, fontBold);

    page.drawText(pdfText("SKU list on putaway / system"), {
      x: textX,
      y: ty,
      size: 5.5,
      font,
      color: muted,
      maxWidth: textW,
    });
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
    } else {
      const lotLabel = resolveManifestLotLabel(carton);
      if (lotLabel) {
        drawFieldRow(page, textX, ty - 10, "LOT", lotLabel, font, fontBold, textW, 7);
        ty -= 22;
      }
    }
    if (carton.expiry) {
      drawFieldRow(page, textX, ty - 10, "EXP", carton.expiry.slice(0, 10), font, fontBold, textW, 7);
      ty -= 22;
    }
    if (showSplit) {
      drawGoodDamagedQtyLines(page, textX, textW, ty, carton, font, fontBold);
    }
  }

  // Footer: total qty + damaged badge + brand
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
    const badgeText = pdfText("DAMAGED -> QUARANTINE");
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
    page.drawText(badgeText, {
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

  for (const carton of list) {
    const page = pdf.addPage(thermal4x6PageSize());
    const { x, yTop, w, h } = thermal4x6LabelBox();
    const payload = carton.barcode || cartonBarcodeFromDoc(carton);
    const png = await qrPngBytes(payload, 320);
    const img = await pdf.embedPng(png);
    drawCartonLabel(page, x, yTop, w, h, carton, font, fontBold, img);
  }

  return pdf.save();
}

export { downloadUint8ArrayAsFile } from "@/lib/warehouse-bin-label-pdf";
