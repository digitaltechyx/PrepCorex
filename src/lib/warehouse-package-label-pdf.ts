import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont, type PDFImage } from "pdf-lib";
import type { WarehouseCartonDoc } from "@/types";
import { encodePackageBarcode } from "@/lib/warehouse-carton-barcode";
import {
  manifestDamagedQty,
  manifestSkuCount,
  resolveManifestLotLabel,
  showsSkuManifest,
} from "@/lib/warehouse-label-manifest";
import {
  drawFieldRow,
  drawFramedLabel,
  ink,
  muted,
  packageAccent,
  packageAccentLight,
  pdfText,
  qrPngBytes,
  thermal4x6LabelBox,
  thermal4x6PageSize,
} from "@/lib/warehouse-handling-label-pdf-shared";

function drawClosedPackageLabel(
  page: PDFPage,
  xLeft: number,
  yTop: number,
  w: number,
  h: number,
  pkg: WarehouseCartonDoc,
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
    packageAccent,
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
    color: packageAccent,
  });
  page.drawText(pdfText("PACKAGE"), {
    x: innerX + 6,
    y: headerBottom + (headerH - 8) / 2,
    size: 8,
    font: fontBold,
    color: rgb(1, 1, 1),
  });
  page.drawText(pdfText("CROSS-DOCK · CLOSED"), {
    x: innerX + 58,
    y: headerBottom + (headerH - 6) / 2,
    size: 5.5,
    font,
    color: rgb(1, 1, 1),
    maxWidth: innerW - 70,
  });

  const bodyBottom = bottom + footerH;
  const bodyTop = bodyBottom + bodyH;
  const clientLine =
    pkg.receivedForClient?.trim() ||
    (pkg.clientId ? `Client ${pkg.clientId.slice(0, 8)}` : null);
  const lotLine = pkg.lot?.trim() || pkg.lines?.[0]?.lot?.trim() || null;
  let textBandH = 6 + 12;
  if (clientLine) textBandH += 10;
  if (lotLine) textBandH += 18;
  textBandH = Math.max(textBandH, 22);
  const qrBodyH = bodyH - textBandH;

  page.drawRectangle({
    x: innerX,
    y: bodyBottom,
    width: innerW,
    height: bodyH,
    color: packageAccentLight,
  });

  if (textBandH > 0) {
    const textTop = bodyTop - textBandH;
    page.drawRectangle({
      x: innerX,
      y: textTop,
      width: innerW,
      height: textBandH,
      color: rgb(1, 1, 1),
    });
    let ty = textTop + textBandH - 8;
    page.drawText(pdfText("CONTENTS NOT OPENED"), {
      x: innerX + 6,
      y: ty - 8,
      size: 6.5,
      font: fontBold,
      color: ink,
      maxWidth: innerW - 12,
    });
    ty -= 12;
    if (clientLine) {
      page.drawText(pdfText(String(clientLine).slice(0, 40)), {
        x: innerX + 6,
        y: ty - 6,
        size: 6,
        font,
        color: ink,
        maxWidth: innerW - 12,
      });
      ty -= 10;
    }
    if (lotLine) {
      drawFieldRow(page, innerX + 6, textTop + 4, "LOT", lotLine, font, fontBold, innerW - 12, 6.5);
    }
  }

  const qrPad = 8;
  const qrSide = Math.min(innerW - qrPad * 2, qrBodyH - qrPad * 2);
  const qx = innerX + (innerW - qrSide) / 2;
  const qy = bodyBottom + (qrBodyH - qrSide) / 2;
  page.drawRectangle({
    x: qx - 4,
    y: qy - 4,
    width: qrSide + 8,
    height: qrSide + 8,
    color: rgb(1, 1, 1),
  });
  page.drawImage(img, { x: qx, y: qy, width: qrSide, height: qrSide });

  drawPackageFooter(page, innerX, innerW, bottom, footerH, pkg, font, fontBold);
}

function drawManifestPackageLabel(
  page: PDFPage,
  xLeft: number,
  yTop: number,
  w: number,
  h: number,
  pkg: WarehouseCartonDoc,
  font: PDFFont,
  fontBold: PDFFont,
  img: PDFImage
) {
  const borderW = 4;
  const hasDamaged = manifestDamagedQty(pkg) > 0;
  const { bottom, innerX, innerW, innerH } = drawFramedLabel(
    page,
    xLeft,
    yTop,
    w,
    h,
    packageAccent,
    borderW
  );

  const headerH = Math.min(18, innerH * 0.12);
  const footerH = Math.max(hasDamaged ? 40 : 28, innerH * 0.18);
  const bodyH = innerH - headerH - footerH;
  const headerBottom = bottom + innerH - headerH;
  const bodyBottom = bottom + footerH;

  page.drawRectangle({
    x: innerX,
    y: headerBottom,
    width: innerW,
    height: headerH,
    color: packageAccent,
  });
  const sub = pkg.isLoose ? "OPEN RECEIVING" : "MANIFEST";
  page.drawText(pdfText("PACKAGE"), {
    x: innerX + 6,
    y: headerBottom + (headerH - 7) / 2,
    size: 7,
    font: fontBold,
    color: rgb(1, 1, 1),
  });
  page.drawText(pdfText(sub), {
    x: innerX + 52,
    y: headerBottom + (headerH - 6) / 2,
    size: 5.5,
    font,
    color: rgb(1, 1, 1),
    maxWidth: innerW - 60,
  });
  const codeSize = 7.5;
  const codeText = pdfText(pkg.cartonCode);
  const codeW = fontBold.widthOfTextAtSize(codeText, codeSize);
  page.drawText(codeText, {
    x: innerX + innerW - codeW - 6,
    y: headerBottom + (headerH - codeSize) / 2,
    size: codeSize,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

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
    color: packageAccentLight,
  });
  const qx = innerX + (halfW - qrSide) / 2;
  const qy = bodyBottom + (bodyH - qrSide) / 2;
  page.drawImage(img, { x: qx, y: qy, width: qrSide, height: qrSide });

  const textX = innerX + halfW + 8;
  const textW = halfW - 14;
  let ty = bodyBottom + bodyH - 10;
  const skuCount = manifestSkuCount(pkg);
  const lotLabel = resolveManifestLotLabel(pkg);
  const damagedQty = manifestDamagedQty(pkg);

  drawFieldRow(page, textX, ty - 10, "SKUS", String(skuCount), font, fontBold, textW, 8);
  ty -= 22;
  if (lotLabel) {
    drawFieldRow(page, textX, ty - 10, "LOT", lotLabel, font, fontBold, textW, 6.5);
    ty -= 20;
  }
  if (damagedQty > 0) {
    page.drawText(pdfText(`DMG QTY: ${damagedQty}`), {
      x: textX,
      y: ty,
      size: 6,
      font: fontBold,
      color: rgb(0.7, 0.15, 0.15),
      maxWidth: textW,
    });
    ty -= 10;
  }

  const lines = pkg.lines ?? [];
  page.drawText(pdfText(`LINES (${lines.length})`), {
    x: textX,
    y: ty,
    size: 5,
    font,
    color: muted,
  });
  ty -= 9;
  const lineSize = 6;
  const lineHeight = lineSize + 2;
  const maxLines = Math.floor((ty - bodyBottom - 4) / lineHeight);
  for (const line of lines.slice(0, maxLines)) {
    const tag = line.condition === "damaged" ? " (DMG)" : "";
    page.drawText(pdfText(`${line.sku} x ${line.quantity}${tag}`), {
      x: textX,
      y: ty,
      size: lineSize,
      font: line.condition === "damaged" ? fontBold : font,
      color: line.condition === "damaged" ? rgb(0.7, 0.15, 0.15) : ink,
      maxWidth: textW,
    });
    ty -= lineHeight;
  }
  if (lines.length > maxLines) {
    page.drawText(pdfText(`+${lines.length - maxLines} more`), {
      x: textX,
      y: ty,
      size: 5,
      font,
      color: muted,
      maxWidth: textW,
    });
  }

  page.drawRectangle({
    x: innerX,
    y: bottom,
    width: innerW,
    height: footerH,
    color: rgb(0.97, 0.99, 0.98),
  });
  page.drawLine({
    start: { x: innerX, y: bottom + footerH },
    end: { x: innerX + innerW, y: bottom + footerH },
    thickness: 0.5,
    color: rgb(0.88, 0.9, 0.93),
  });
  page.drawText(pdfText("QTY"), {
    x: innerX + 8,
    y: bottom + footerH - 10,
    size: 5,
    font,
    color: muted,
  });
  page.drawText(pdfText(String(pkg.quantity)), {
    x: innerX + 8,
    y: bottom + (hasDamaged ? 18 : 6),
    size: 12,
    font: fontBold,
    color: packageAccent,
  });
  if (hasDamaged) {
    const badgeText = pdfText("DAMAGED -> QUARANTINE");
    const badgeSize = 5.5;
    const badgeW = fontBold.widthOfTextAtSize(badgeText, badgeSize) + 10;
    const bx = innerX + innerW / 2 - badgeW / 2;
    page.drawRectangle({
      x: bx,
      y: bottom + 4,
      width: badgeW,
      height: 11,
      color: rgb(0.85, 0.18, 0.18),
    });
    page.drawText(badgeText, {
      x: bx + 5,
      y: bottom + 6,
      size: badgeSize,
      font: fontBold,
      color: rgb(1, 1, 1),
    });
  }
}

function drawPackageFooter(
  page: PDFPage,
  innerX: number,
  innerW: number,
  bottom: number,
  footerH: number,
  pkg: WarehouseCartonDoc,
  font: PDFFont,
  fontBold: PDFFont
) {
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
  const codeText = pdfText(pkg.cartonCode);
  const codeW = fontBold.widthOfTextAtSize(codeText, codeSize);
  page.drawText(codeText, {
    x: innerX + (innerW - codeW) / 2,
    y: bottom + footerH - codeSize - 10,
    size: codeSize,
    font: fontBold,
    color: ink,
  });
  page.drawText(pdfText("Scan PKG at putaway"), {
    x: innerX + 6,
    y: bottom + 6,
    size: 5,
    font,
    color: muted,
    maxWidth: innerW - 12,
  });
}

function drawPackageLabel(
  page: PDFPage,
  xLeft: number,
  yTop: number,
  w: number,
  h: number,
  pkg: WarehouseCartonDoc,
  font: PDFFont,
  fontBold: PDFFont,
  img: PDFImage
) {
  if (showsSkuManifest(pkg)) {
    drawManifestPackageLabel(page, xLeft, yTop, w, h, pkg, font, fontBold, img);
  } else {
    drawClosedPackageLabel(page, xLeft, yTop, w, h, pkg, font, fontBold, img);
  }
}

export async function buildWarehousePackageLabelsPdf(options: {
  title: string;
  packages: WarehouseCartonDoc[];
}): Promise<Uint8Array> {
  const list = [...options.packages].filter((p) => p.cartonCode && p.isPackage);
  if (list.length === 0) throw new Error("No packages to print.");

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  for (const pkg of list) {
    const page = pdf.addPage(thermal4x6PageSize());
    const { x, yTop, w, h } = thermal4x6LabelBox();
    const payload = pkg.barcode || encodePackageBarcode(pkg.cartonCode);
    const png = await qrPngBytes(payload, 320);
    const img = await pdf.embedPng(png);
    drawPackageLabel(page, x, yTop, w, h, pkg, font, fontBold, img);
  }

  return pdf.save();
}

export { downloadUint8ArrayAsFile } from "@/lib/warehouse-bin-label-pdf";
