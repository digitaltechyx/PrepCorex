import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont, type PDFImage } from "pdf-lib";
import QRCode from "qrcode";
import type { WarehouseBinDoc } from "@/types";
import { compareBinPaths, formatPathSegmentLabelCompact, parseBinPath } from "@/lib/warehouse-bin-path";

/** Level theme ΓÇö border, top accent block, LEVEL chip (reference sheet 1). */
const LEVEL_STYLES = [
  { accent: rgb(0.78, 0.58, 0.08) },
  { accent: rgb(0.52, 0.28, 0.82) },
  { accent: rgb(0.2, 0.45, 0.9) },
  { accent: rgb(0.05, 0.65, 0.45) },
  { accent: rgb(0.82, 0.14, 0.14) },
];

function levelIndex(level: string): number {
  const n = parseInt(String(level).replace(/\D/g, ""), 10);
  if (!Number.isFinite(n) || n < 1) return 0;
  return (n - 1) % LEVEL_STYLES.length;
}

async function qrPngBytes(payload: string, size = 128): Promise<Uint8Array> {
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
    throw new Error("QR label PDF must be generated in the browser.");
  }
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const white = rgb(1, 1, 1);
const ink = rgb(0.06, 0.09, 0.14);
const headerMuted = rgb(0.38, 0.4, 0.46);

/**
 * Reference design 1: thick level-colored border, white interior, top = half white (QR) + half accent,
 * bottom = white band with black values; LEVEL in theme-colored square with white type; QR side alternates by level.
 */
function drawBinLabel(
  page: PDFPage,
  xLeft: number,
  yTop: number,
  w: number,
  h: number,
  bin: WarehouseBinDoc,
  font: PDFFont,
  fontBold: PDFFont,
  img: PDFImage
) {
  const outerPad = 1.5;
  const cardX = xLeft + outerPad;
  const cardW = w - outerPad * 2;
  const cardH = h - outerPad * 2;
  const cardBottom = yTop - h + outerPad;

  const parsed = parseBinPath(bin.path);
  const lvlIdx = levelIndex(bin.level);
  const style = LEVEL_STYLES[lvlIdx];

  const borderW = cardH < 90 ? 2.5 : 4;

  if (!parsed) {
    page.drawRectangle({
      x: cardX,
      y: cardBottom,
      width: cardW,
      height: cardH,
      color: style.accent,
    });
    page.drawRectangle({
      x: cardX + borderW,
      y: cardBottom + borderW,
      width: cardW - borderW * 2,
      height: cardH - borderW * 2,
      color: white,
    });
    const innerX = cardX + borderW + 3;
    const innerW = cardW - borderW * 2 - 6;
    const qrSide = Math.min(innerW * 0.45, cardH * 0.45);
    const qx = innerX;
    const qy = cardBottom + cardH - borderW - 6 - qrSide;
    page.drawImage(img, { x: qx, y: qy, width: qrSide, height: qrSide });
    page.drawText(bin.path, {
      x: innerX,
      y: cardBottom + borderW + 6,
      size: 7,
      font: fontBold,
      color: ink,
      maxWidth: innerW,
    });
    return;
  }

  const innerX = cardX + borderW;
  const innerY = cardBottom + borderW;
  const innerW = cardW - borderW * 2;
  const innerH = cardH - borderW * 2;

  // Thick frame (accent) + white face
  page.drawRectangle({
    x: cardX,
    y: cardBottom,
    width: cardW,
    height: cardH,
    color: style.accent,
  });
  page.drawRectangle({
    x: innerX,
    y: innerY,
    width: innerW,
    height: innerH,
    color: white,
  });

  const botH = Math.max(26, Math.min(34, innerH * 0.38));
  const topH = innerH - botH;
  const topBottom = innerY + botH;
  const halfW = innerW / 2;
  const qrOnLeft = lvlIdx % 2 === 0;

  const accentLeft = qrOnLeft ? innerX + halfW : innerX;
  page.drawRectangle({
    x: accentLeft,
    y: topBottom,
    width: halfW,
    height: topH,
    color: style.accent,
  });

  const qrHalfX = qrOnLeft ? innerX : innerX + halfW;
  const qrInset = 3;
  const qrSide = Math.min(halfW - qrInset * 2, topH - qrInset * 2);
  const qrX = qrHalfX + (halfW - qrSide) / 2;
  const qrY = topBottom + (topH - qrSide) / 2;
  page.drawRectangle({
    x: qrX - 1,
    y: qrY - 1,
    width: qrSide + 2,
    height: qrSide + 2,
    color: white,
    borderColor: rgb(0.88, 0.9, 0.93),
    borderWidth: 0.35,
  });
  page.drawImage(img, { x: qrX, y: qrY, width: qrSide, height: qrSide });

  /**
   * Display line: `NJ03 - A - 1 - A - 1 - A2` (spaces around hyphens). LEVEL stays in accent chip.
   * Header baselines stay inside the white band so glyphs are not painted over the top gold block.
   */
  const whD = parsed.warehouse;
  const areaD = formatPathSegmentLabelCompact(parsed.area);
  const rowD = formatPathSegmentLabelCompact(parsed.row);
  const bayD = formatPathSegmentLabelCompact(parsed.bay);
  const levelD = formatPathSegmentLabelCompact(parsed.level);
  const binD = parsed.pos;

  const looseSep = " - ";
  const valSize = innerH < 72 ? 10.5 : 12.5;
  const headerSize = innerH < 72 ? 4.5 : innerW < 200 ? 5 : 5.25;

  const piece = (txt: string) => fontBold.widthOfTextAtSize(txt, valSize);
  const wSep = piece(looseSep);

  const levelTw = fontBold.widthOfTextAtSize(levelD, valSize);
  /** Equal vertical padding around the level digit (Helvetica-bold caps Γëê these ratios). */
  const levelBoxPadX = 2.5;
  const gAsc = valSize * 0.72;
  const gDesc = valSize * 0.22;
  let vPad = 1.75;
  let levelBoxH = gAsc + gDesc + vPad * 2;
  const levelBoxW = levelTw + levelBoxPadX * 2;

  const levelHeader =
    levelBoxW < font.widthOfTextAtSize("LEVEL", headerSize) + 2 ? "LVL" : "LEVEL";

  const wWh = piece(whD);
  const wArea = piece(areaD);
  const wRow = piece(rowD);
  const wBay = piece(bayD);
  const wBin = piece(binD);

  const prefixStr = `${whD}${looseSep}${areaD}${looseSep}${rowD}${looseSep}${bayD}${looseSep}`;
  const suffixStr = `${looseSep}${binD}`;
  const wPrefix = piece(prefixStr);
  const wSuffix = piece(suffixStr);
  const totalW = wPrefix + levelBoxW + wSuffix;

  const bandTop = innerY + botH;
  /** Keep entire header cap height below gold / QR bottom edge (no overlap bleed). */
  const headerCap = headerSize * 0.9;
  const headerY = bandTop - headerCap - 2.25;
  /** ~2pt extra space between header baselines and value row (screen ΓÇ£pxΓÇ¥ Γëê pt in PDF). */
  const valueBelowHeaderGap = 11.5;
  const valBaseline = innerY + Math.max(8, headerY - innerY - valueBelowHeaderGap);

  let boxY = valBaseline - gDesc - vPad;
  const chipTopMax = headerY - 3;
  while (boxY + levelBoxH > chipTopMax && vPad > 0.55) {
    vPad -= 0.2;
    levelBoxH = gAsc + gDesc + vPad * 2;
    boxY = valBaseline - gDesc - vPad;
  }
  if (boxY + levelBoxH > chipTopMax) {
    boxY = chipTopMax - levelBoxH;
  }

  const startX = innerX + Math.max(2, (innerW - totalW) / 2);

  const zones: { label: string; centerX: number }[] = [];
  let x = startX;
  zones.push({ label: "WH", centerX: x + wWh / 2 });
  x += wWh + wSep;
  zones.push({ label: "AREA", centerX: x + wArea / 2 });
  x += wArea + wSep;
  zones.push({ label: "ROW", centerX: x + wRow / 2 });
  x += wRow + wSep;
  zones.push({ label: "BAY", centerX: x + wBay / 2 });
  x += wBay + wSep;

  page.drawText(prefixStr, {
    x: startX,
    y: valBaseline,
    size: valSize,
    font: fontBold,
    color: ink,
  });

  const levelBoxLeft = startX + wPrefix;
  zones.push({ label: levelHeader, centerX: levelBoxLeft + levelBoxW / 2 });
  page.drawRectangle({
    x: levelBoxLeft,
    y: boxY,
    width: levelBoxW,
    height: levelBoxH,
    color: style.accent,
  });
  const levelTextX = levelBoxLeft + (levelBoxW - levelTw) / 2;
  page.drawText(levelD, {
    x: levelTextX,
    y: valBaseline,
    size: valSize,
    font: fontBold,
    color: white,
  });

  page.drawText(suffixStr, {
    x: levelBoxLeft + levelBoxW,
    y: valBaseline,
    size: valSize,
    font: fontBold,
    color: ink,
  });

  zones.push({ label: "BIN", centerX: levelBoxLeft + levelBoxW + wSep + wBin / 2 });

  const innerRight = innerX + innerW;
  for (const z of zones) {
    const tw = font.widthOfTextAtSize(z.label, headerSize);
    const left = z.centerX - tw / 2;
    const xClamped = Math.max(innerX + 1, Math.min(left, innerRight - tw - 1));
    page.drawText(z.label, {
      x: xClamped,
      y: headerY,
      size: headerSize,
      font,
      color: headerMuted,
    });
  }
}

export type BuildBinLabelsPdfOptions = {
  title: string;
  bins: WarehouseBinDoc[];
  activeOnly?: boolean;
};

/**
 * US Letter PDF ΓÇö landscape bin labels (~4├ù1.75 in proportion), 3 columns, as many rows as fit per page.
 */
export async function buildWarehouseBinLabelsPdf(options: BuildBinLabelsPdfOptions): Promise<Uint8Array> {
  const list = (options.bins || [])
    .filter((b) => {
      if (options.activeOnly && b.active === false) return false;
      return Boolean(b.path);
    })
    .sort((a, b) => compareBinPaths(a.path, b.path));
  if (list.length === 0) {
    throw new Error("No bins to print.");
  }

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pageW = 612;
  const pageH = 792;
  const margin = 24;
  const headerBand = 42;
  /** Landscape shelf label shape (~4" ├ù 1.75" at 72 dpi Γëê 288├ù126 pt). */
  const LABEL_ASPECT = 4 / 1.75;
  const gutter = 5;
  const cols = 3;

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

  const drawPageHeader = (p: PDFPage) => {
    p.drawText(options.title, {
      x: margin,
      y: pageH - margin - 14,
      size: 11,
      font: fontBold,
      color: rgb(0.06, 0.09, 0.16),
    });
    p.drawText("Bin labels ΓÇö QR = full path (Warehouse-Area-Row-Bay-Level-Bin)", {
      x: margin,
      y: pageH - margin - 28,
      size: 7,
      font,
      color: rgb(0.38, 0.42, 0.48),
    });
  };

  drawPageHeader(page);

  for (let i = 0; i < list.length; i++) {
    if (idxOnPage >= cols * rows) {
      page = pdf.addPage([pageW, pageH]);
      idxOnPage = 0;
      drawPageHeader(page);
    }
    const col = idxOnPage % cols;
    const row = Math.floor(idxOnPage / cols);
    const x0 = margin + col * (labelW + gutter);
    const yTop = row0Top - row * (labelH + gutter);

    const bin = list[i];
    const png = await qrPngBytes(bin.barcode || bin.path, 180);
    const img = await pdf.embedPng(png);

    drawBinLabel(page, x0, yTop, labelW - 0.5, labelH - 0.5, bin, font, fontBold, img);

    idxOnPage += 1;
  }

  return pdf.save();
}

export function downloadUint8ArrayAsFile(data: Uint8Array, filename: string) {
  const blob = new Blob([data as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
