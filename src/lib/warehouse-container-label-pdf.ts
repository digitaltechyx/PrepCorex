import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { WarehouseCartonDoc } from "@/types";
import { encodeContainerBarcode } from "@/lib/warehouse-carton-barcode";
import {
  drawFieldRow,
  drawFramedLabel,
  ink,
  muted,
  pdfText,
  qrPngBytes,
  thermal4x6LabelBox,
  thermal4x6PageSize,
} from "@/lib/warehouse-handling-label-pdf-shared";

const accent = rgb(0.15, 0.35, 0.55);
const accentLight = rgb(0.93, 0.96, 0.99);
const borderW = 2;

export async function buildContainerLabelPdfBytes(
  containers: WarehouseCartonDoc[]
): Promise<Uint8Array> {
  const list = containers.filter((c) => c.isContainer && c.cartonCode);
  if (list.length === 0) throw new Error("No container labels to print.");

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  for (const container of list) {
    const page = doc.addPage(thermal4x6PageSize());
    const box = thermal4x6LabelBox();
    const { bottom, innerX, innerW, innerH } = drawFramedLabel(
      page,
      box.x,
      box.yTop,
      box.w,
      box.h,
      accent,
      borderW
    );

    const headerH = Math.min(22, innerH * 0.12);
    const footerH = Math.max(28, innerH * 0.14);
    const bodyH = innerH - headerH - footerH;
    const headerBottom = bottom + innerH - headerH;

    page.drawRectangle({
      x: innerX,
      y: headerBottom,
      width: innerW,
      height: headerH,
      color: accent,
    });
    page.drawText(pdfText("CONTAINER"), {
      x: innerX + 6,
      y: headerBottom + (headerH - 9) / 2,
      size: 9,
      font: fontBold,
      color: rgb(1, 1, 1),
    });
    const codeText = pdfText(container.cartonCode);
    const codeW = fontBold.widthOfTextAtSize(codeText, 8);
    page.drawText(codeText, {
      x: innerX + innerW - codeW - 6,
      y: headerBottom + (headerH - 8) / 2,
      size: 8,
      font: fontBold,
      color: rgb(1, 1, 1),
    });

    const bodyBottom = bottom + footerH;
    const halfW = innerW / 2;
    const qrPad = 5;
    const qrSide = Math.min(halfW - qrPad * 2, bodyH - qrPad * 2);
    const payload = container.barcode || encodeContainerBarcode(container.cartonCode);
    const img = await doc.embedPng(await qrPngBytes(payload));

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
      color: accentLight,
    });
    page.drawImage(img, {
      x: innerX + (halfW - qrSide) / 2,
      y: bodyBottom + (bodyH - qrSide) / 2,
      width: qrSide,
      height: qrSide,
    });

    const textX = innerX + halfW + 8;
    const textW = halfW - 14;
    let ty = bodyBottom + bodyH - 10;

    drawFieldRow(
      page,
      textX,
      ty - 10,
      "CARTONS",
      String(container.containerCartonCount ?? 0),
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
      "PALLETS",
      String(container.containerPalletCount ?? 0),
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
      "PACKAGES",
      String(container.containerPackageCount ?? 0),
      font,
      fontBold,
      textW,
      8
    );
    ty -= 22;

    if (container.lot) {
      drawFieldRow(
        page,
        textX,
        ty - 10,
        "LOT",
        container.lot.slice(0, 28),
        font,
        fontBold,
        textW,
        6.5
      );
      ty -= 20;
    }

    if (container.receivedForClient || container.clientId) {
      drawFieldRow(
        page,
        textX,
        ty - 10,
        "CLIENT",
        (container.receivedForClient || container.clientId || "").slice(0, 28),
        font,
        fontBold,
        textW,
        6.5
      );
      ty -= 20;
    }
    if (container.trackingNumber) {
      drawFieldRow(
        page,
        textX,
        ty - 10,
        "TRACK",
        container.trackingNumber.slice(0, 22),
        font,
        fontBold,
        textW,
        6
      );
      ty -= 18;
    }

    page.drawText(pdfText("Open-receive SKUs after client known"), {
      x: textX,
      y: Math.max(bodyBottom + 4, ty),
      size: 5,
      font,
      color: muted,
      maxWidth: textW,
    });

    page.drawRectangle({
      x: innerX,
      y: bottom,
      width: innerW,
      height: footerH,
      color: rgb(0.95, 0.97, 0.99),
    });
    page.drawText(pdfText("Scan CTR · container dock receive"), {
      x: innerX + 6,
      y: bottom + (footerH - 6) / 2,
      size: 6,
      font,
      color: ink,
    });
  }

  return doc.save();
}

export async function printContainerLabels(containers: WarehouseCartonDoc[]): Promise<void> {
  const bytes = await buildContainerLabelPdfBytes(containers);
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
}
