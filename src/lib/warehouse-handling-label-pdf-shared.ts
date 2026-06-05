import type { PDFPage, PDFFont, PDFImage } from "pdf-lib";
import { rgb, type RGB } from "pdf-lib";
import QRCode from "qrcode";
import { sanitizePdfWinAnsi } from "@/lib/warehouse-bin-label-pdf";

export function pdfText(text: string): string {
  return sanitizePdfWinAnsi(text);
}

export const ink = rgb(0.06, 0.09, 0.14);
export const white = rgb(1, 1, 1);
export const muted = rgb(0.38, 0.42, 0.48);
/** Carton / receiving — docs label-types-preview orange */
export const cartonAccent = rgb(0.92, 0.35, 0.05);
export const cartonAccentLight = rgb(0.99, 0.94, 0.88);

/** Pallet / handling — indigo */
export const palletAccent = rgb(0.39, 0.4, 0.95);
export const palletAccentLight = rgb(0.94, 0.93, 0.99);

/** Package / polybag — emerald */
export const packageAccent = rgb(0.02, 0.59, 0.41);
export const packageAccentLight = rgb(0.92, 0.98, 0.95);

export async function qrPngBytes(payload: string, size = 200): Promise<Uint8Array> {
  const dataUrl = await QRCode.toDataURL(payload, {
    width: size,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#0f172a", light: "#ffffff" },
  });
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("Invalid QR data URL");
  const base64 = dataUrl.slice(comma + 1);
  if (typeof atob !== "function") {
    throw new Error("Label PDF must be generated in the browser.");
  }
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Rounded-ish chip (pdf-lib has no radius on drawRectangle — small rect is fine). */
export function drawTypeChip(
  page: PDFPage,
  x: number,
  y: number,
  label: string,
  accent: RGB,
  fontBold: PDFFont,
  fontSize = 7
) {
  const text = pdfText(label);
  const padX = 5;
  const padY = 3;
  const w = fontBold.widthOfTextAtSize(text, fontSize) + padX * 2;
  const h = fontSize + padY * 2;
  page.drawRectangle({ x, y, width: w, height: h, color: accent });
  page.drawText(text, {
    x: x + padX,
    y: y + padY,
    size: fontSize,
    font: fontBold,
    color: white,
  });
  return { width: w, height: h };
}

export function drawFieldRow(
  page: PDFPage,
  x: number,
  y: number,
  label: string,
  value: string,
  font: PDFFont,
  fontBold: PDFFont,
  maxW: number,
  valueSize = 8
) {
  page.drawText(pdfText(label), {
    x,
    y: y + valueSize + 2,
    size: 5,
    font,
    color: muted,
    maxWidth: maxW,
  });
  page.drawText(pdfText(value), {
    x,
    y,
    size: valueSize,
    font: fontBold,
    color: ink,
    maxWidth: maxW,
  });
}

export function drawFramedLabel(
  page: PDFPage,
  xLeft: number,
  yTop: number,
  w: number,
  h: number,
  accent: RGB,
  borderW: number
) {
  const bottom = yTop - h;
  page.drawRectangle({ x: xLeft, y: bottom, width: w, height: h, color: accent });
  page.drawRectangle({
    x: xLeft + borderW,
    y: bottom + borderW,
    width: w - borderW * 2,
    height: h - borderW * 2,
    color: white,
  });
  return {
    bottom: bottom + borderW,
    innerX: xLeft + borderW,
    innerY: bottom + borderW,
    innerW: w - borderW * 2,
    innerH: h - borderW * 2,
  };
}

/** 4×6" thermal label (portrait). 72 pt per inch — one label per PDF page. */
export const THERMAL_4X6_PT = {
  width: 4 * 72,
  height: 6 * 72,
  margin: 4,
} as const;

export function thermal4x6PageSize(): [number, number] {
  return [THERMAL_4X6_PT.width, THERMAL_4X6_PT.height];
}

/** Printable area inside the 4×6 page (small margin avoids printer clipping). */
export function thermal4x6LabelBox(): { x: number; yTop: number; w: number; h: number } {
  const { width, height, margin } = THERMAL_4X6_PT;
  return {
    x: margin,
    yTop: height - margin,
    w: width - margin * 2,
    h: height - margin * 2,
  };
}
