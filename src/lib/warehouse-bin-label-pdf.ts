import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont, type PDFImage } from "pdf-lib";
import QRCode from "qrcode";
import type { WarehouseBinDoc } from "@/types";
import { compareBinPaths, formatPathSegmentLabelCompact, parseBinPath } from "@/lib/warehouse-bin-path";

/** Helvetica in pdf-lib uses WinAnsi; replace unsupported characters before drawText. */
export function sanitizePdfWinAnsi(text: string): string {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2013\u2014\u2015]/g, "-")
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2026]/g, "...")
    .replace(/[\u00A0]/g, " ")
    .replace(/[^\t\n\r\x20-\x7E\xA0-\xFF]/g, "?");
}

function pdfText(text: string): string {
  return sanitizePdfWinAnsi(text);
}

type PdfRgb = ReturnType<typeof rgb>;

/** Bottom (level 1) to top: green, yellow, blue, purple; top level always red. */
const LEVEL_GREEN = rgb(0.06, 0.62, 0.38);
const LEVEL_YELLOW = rgb(0.93, 0.78, 0.1);
const LEVEL_BLUE = rgb(0.18, 0.42, 0.88);
const LEVEL_PURPLE = rgb(0.48, 0.22, 0.78);
const LEVEL_RED = rgb(0.82, 0.12, 0.12);

/** Extra hues for level 5..(max-1) when max > 5 (no black/white). */
const OVERFLOW_LEVEL_COLORS: PdfRgb[] = [
  rgb(0.95, 0.45, 0.12),
  rgb(0.12, 0.72, 0.68),
  rgb(0.88, 0.28, 0.58),
  rgb(0.55, 0.72, 0.22),
  rgb(0.72, 0.38, 0.18),
  rgb(0.28, 0.58, 0.92),
  rgb(0.62, 0.32, 0.82),
];

export function parseLevelNumber(level: string): number {
  const n = parseInt(String(level).replace(/\D/g, ""), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

export function bayLevelKey(bin: Pick<WarehouseBinDoc, "area" | "row" | "bay">): string {
  return `${bin.area}|${bin.row}|${bin.bay}`;
}

export function buildMaxLevelByBay(bins: WarehouseBinDoc[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const b of bins) {
    const key = bayLevelKey(b);
    const n = parseLevelNumber(b.level);
    map.set(key, Math.max(map.get(key) ?? 0, n));
  }
  return map;
}

function overflowLevelColor(levelNum: number, bayKey: string): PdfRgb {
  let h = 2166136261;
  const seed = `${bayKey}#${levelNum}`;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return OVERFLOW_LEVEL_COLORS[Math.abs(h) % OVERFLOW_LEVEL_COLORS.length];
}

/**
 * Label accent by shelf height (level 1 = bottom).
 * Levels 1-4: green, yellow, blue, purple. Top level in bay: always red.
 * If max > 5, middle levels (5 .. max-1) use a stable random color (not black/white).
 */
export function getLevelAccentColor(levelNum: number, maxLevelInBay: number, bayKey: string): PdfRgb {
  const max = Math.max(1, maxLevelInBay);
  const level = Math.min(Math.max(1, levelNum), max);
  if (level === max) return LEVEL_RED;
  switch (level) {
    case 1:
      return LEVEL_GREEN;
    case 2:
      return LEVEL_YELLOW;
    case 3:
      return LEVEL_BLUE;
    case 4:
      return LEVEL_PURPLE;
    default:
      return overflowLevelColor(level, bayKey);
  }
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
  maxLevelInBay: number,
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
  const levelNum = parseLevelNumber(bin.level);
  const accent = getLevelAccentColor(levelNum, maxLevelInBay, bayLevelKey(bin));

  const borderW = cardH < 90 ? 2.5 : 4;

  if (!parsed) {
    page.drawRectangle({
      x: cardX,
      y: cardBottom,
      width: cardW,
      height: cardH,
      color: accent,
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
    page.drawText(pdfText(bin.path), {
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
    color: accent,
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
  const qrOnLeft = (levelNum - 1) % 2 === 0;

  const accentLeft = qrOnLeft ? innerX + halfW : innerX;
  page.drawRectangle({
    x: accentLeft,
    y: topBottom,
    width: halfW,
    height: topH,
    color: accent,
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
  const whD = pdfText(parsed.warehouse);
  const areaD = pdfText(formatPathSegmentLabelCompact(parsed.area));
  const rowD = pdfText(formatPathSegmentLabelCompact(parsed.row));
  const bayD = pdfText(formatPathSegmentLabelCompact(parsed.bay));
  const levelD = pdfText(formatPathSegmentLabelCompact(parsed.level));
  const binD = pdfText(parsed.pos);

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

  page.drawText(pdfText(prefixStr), {
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
    color: accent,
  });
  const levelTextX = levelBoxLeft + (levelBoxW - levelTw) / 2;
  page.drawText(levelD, {
    x: levelTextX,
    y: valBaseline,
    size: valSize,
    font: fontBold,
    color: white,
  });

  page.drawText(pdfText(suffixStr), {
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
    page.drawText(pdfText(z.label), {
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
  /** When set, used to find top level per bay (so filtered prints still color vs full rack height). */
  binsForLevelContext?: WarehouseBinDoc[];
  activeOnly?: boolean;
};

/**
 * US Letter PDF - landscape bin labels (~4x1.75 in proportion), 3 columns, as many rows as fit per page.
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

  const levelContext = options.binsForLevelContext?.length ? options.binsForLevelContext : list;
  const maxLevelByBay = buildMaxLevelByBay(levelContext);

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pageW = 612;
  const pageH = 792;
  const margin = 24;
  const headerBand = 42;
  /** Landscape shelf label shape (~4" x 1.75" at 72 dpi ~ 288x126 pt). */
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
    p.drawText(pdfText(options.title), {
      x: margin,
      y: pageH - margin - 14,
      size: 11,
      font: fontBold,
      color: rgb(0.06, 0.09, 0.16),
    });
    p.drawText("Bin labels - QR = full path (Warehouse-Area-Row-Bay-Level-Bin)", {
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
    const maxLevelInBay = maxLevelByBay.get(bayLevelKey(bin)) ?? parseLevelNumber(bin.level);
    const png = await qrPngBytes(bin.barcode || bin.path, 180);
    const img = await pdf.embedPng(png);

    drawBinLabel(page, x0, yTop, labelW - 0.5, labelH - 0.5, bin, maxLevelInBay, font, fontBold, img);

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
