/**
 * Sample A4 PDFs for PrepCorex barcode labels:
 * Page 1 — Bin QR sheet: one bay, 5 levels × N bins/level (default 3: B01, B02, B03).
 * Page 2 — Other QR types: product, carton/receiving, shipment (accent colors).
 *
 * Run: node scripts/generate-bin-label-sheet-pdf.mjs
 * Or:  npm run docs:bin-label-pdf
 *
 * Output: docs/BARCODE_SCANNING/barcode-label-sheets-sample.pdf
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "docs", "BARCODE_SCANNING", "barcode-label-sheets-sample.pdf");

/** Admin-configurable defaults (sample) */
const WAREHOUSE_CODE = "NJ03";
const AREA = "A";
const ROW = "R1";
const BAY = "BA1";
const LEVELS = 5;
const BIN_CODES = ["B01", "B02", "B03"];

/** Background + border per shelf level (L1 floor … L5 top) */
const LEVEL_THEME = [
  { fill: rgb(0.91, 0.95, 1), stroke: rgb(0.23, 0.51, 0.96), name: "L1" },
  { fill: rgb(0.85, 0.97, 0.91), stroke: rgb(0.06, 0.72, 0.51), name: "L2" },
  { fill: rgb(1, 0.96, 0.89), stroke: rgb(0.85, 0.47, 0.05), name: "L3" },
  { fill: rgb(0.93, 0.87, 1), stroke: rgb(0.49, 0.23, 0.93), name: "L4" },
  { fill: rgb(1, 0.89, 0.89), stroke: rgb(0.86, 0.15, 0.15), name: "L5" },
];

function binPath(level, binCode) {
  return `${WAREHOUSE_CODE}-${AREA}-${ROW}-${BAY}-L${level}-${binCode}`;
}

async function pngQr(text, size = 140) {
  const buf = await QRCode.toBuffer(text, {
    type: "png",
    width: size,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#0f172a", light: "#ffffff" },
  });
  return buf;
}

async function drawBayBinSheet(pdf, page, fontBold, font) {
  const pageW = page.getWidth();
  const pageH = page.getHeight();
  const margin = 40;

  const title = `Bin labels — Bay ${BAY} · Row ${ROW} · Area ${AREA} · ${WAREHOUSE_CODE}`;
  const subtitle = `${LEVELS} levels × ${BIN_CODES.length} bins/level (${BIN_CODES.join(", ")}) — configurable per warehouse in admin`;

  page.drawText(title, {
    x: margin,
    y: pageH - margin - 18,
    size: 14,
    font: fontBold,
    color: rgb(0.06, 0.09, 0.16),
  });
  page.drawText(subtitle, {
    x: margin,
    y: pageH - margin - 36,
    size: 9,
    font,
    color: rgb(0.33, 0.41, 0.51),
  });

  const cols = BIN_CODES.length;
  const rows = LEVELS;
  const gridTop = pageH - margin - 58;
  const gridBottom = margin + 28;
  const gridW = pageW - 2 * margin;
  const gridH = gridTop - gridBottom;
  const rowH = gridH / rows;
  const colW = gridW / cols;
  const pad = 6;

  for (let r = 0; r < rows; r++) {
    const level = LEVELS - r;
    const theme = LEVEL_THEME[level - 1] ?? LEVEL_THEME[r % LEVEL_THEME.length];
    const yTop = gridTop - r * rowH;

    for (let c = 0; c < cols; c++) {
      const binCode = BIN_CODES[c];
      const payload = binPath(level, binCode);
      const x0 = margin + c * colW + pad;
      const y0 = yTop - rowH + pad;
      const cellW = colW - 2 * pad;
      const cellH = rowH - 2 * pad;

      page.drawRectangle({
        x: x0,
        y: y0,
        width: cellW,
        height: cellH,
        color: theme.fill,
        borderColor: theme.stroke,
        borderWidth: 2,
      });

      const qrSize = Math.min(108, cellH - 46, cellW - 16);
      const qrBytes = await pngQr(payload, Math.round(qrSize * 2));
      const qrImg = await pdf.embedPng(qrBytes);
      const qrDim = qrSize;
      const qx = x0 + (cellW - qrDim) / 2;
      const qy = y0 + cellH - qrDim - 10;

      page.drawImage(qrImg, { x: qx, y: qy, width: qrDim, height: qrDim });

      page.drawText(`${theme.name} · Bin ${binCode}`, {
        x: x0 + 10,
        y: y0 + cellH - 20,
        size: 9,
        font: fontBold,
        color: rgb(0.2, 0.25, 0.33),
      });

      page.drawText("Scan bin QR · PrepCorex", {
        x: x0 + 10,
        y: y0 + 26,
        size: 6,
        font,
        color: rgb(0.45, 0.52, 0.61),
      });

      page.drawText(payload, {
        x: x0 + 10,
        y: y0 + 12,
        size: 8,
        font: fontBold,
        color: rgb(0.06, 0.09, 0.16),
      });
    }
  }

  page.drawText(
    "Rows = shelf levels top-to-bottom (highest level first). Columns = bins on that level (e.g. B01–B03).",
    {
      x: margin,
      y: margin + 8,
      size: 7,
      font,
      color: rgb(0.45, 0.52, 0.61),
    }
  );
}

async function drawOtherLabelSamples(pdf, page, fontBold, font) {
  const pageW = page.getWidth();
  const pageH = page.getHeight();
  const margin = 40;

  page.drawText("Other label types (sample accents)", {
    x: margin,
    y: pageH - margin - 18,
    size: 14,
    font: fontBold,
    color: rgb(0.06, 0.09, 0.16),
  });
  page.drawText("Product/carton/shipment use distinct border colors so workers spot label purpose quickly.", {
    x: margin,
    y: pageH - margin - 36,
    size: 9,
    font,
    color: rgb(0.33, 0.41, 0.51),
  });

  const samples = [
    {
      title: "Product label",
      subtitle: "SKU scan",
      payload: "SKU:ABC123-BLK-M",
      lines: ["Premium Hoodie · Black · M"],
      fill: rgb(0.94, 0.98, 0.97),
      stroke: rgb(0.09, 0.64, 0.58),
    },
    {
      title: "Carton / receiving label",
      subtitle: "Lot + expiry + qty",
      payload: "SKU=ABC123|LOT=L2405A|EXP=2027-08-31|QTY=24",
      lines: ["Inbound traceability"],
      fill: rgb(1, 0.96, 0.9),
      stroke: rgb(0.92, 0.45, 0.12),
    },
    {
      title: "Shipment / handling label (optional)",
      subtitle: "Staging & dispatch",
      payload: "SHIP=SHP-2026-00421|CTN=3/8",
      lines: ["Internal carton in shipment"],
      fill: rgb(0.94, 0.96, 1),
      stroke: rgb(0.39, 0.45, 0.72),
    },
  ];

  let yCursor = pageH - margin - 70;
  const cardH = 200;
  const gap = 14;

  for (const s of samples) {
    const x0 = margin;
    const y0 = yCursor - cardH;
    const w = pageW - 2 * margin;

    page.drawRectangle({
      x: x0,
      y: y0,
      width: w,
      height: cardH,
      color: s.fill,
      borderColor: s.stroke,
      borderWidth: 2.5,
    });

    const qrBytes = await pngQr(s.payload, 240);
    const qrImg = await pdf.embedPng(qrBytes);
    const qrDim = 132;
    page.drawImage(qrImg, { x: x0 + 18, y: y0 + cardH - qrDim - 18, width: qrDim, height: qrDim });

    const tx = x0 + 18 + qrDim + 22;
    let ty = y0 + cardH - 28;
    page.drawText(s.title, { x: tx, y: ty, size: 12, font: fontBold, color: rgb(0.06, 0.09, 0.16) });
    ty -= 16;
    page.drawText(s.subtitle, { x: tx, y: ty, size: 9, font, color: rgb(0.33, 0.41, 0.51) });
    ty -= 22;
    page.drawText(s.payload, { x: tx, y: ty, size: 8, font: fontBold, color: rgb(0.06, 0.09, 0.16) });
    ty -= 14;
    for (const line of s.lines) {
      page.drawText(line, { x: tx, y: ty, size: 8, font, color: rgb(0.45, 0.52, 0.61) });
      ty -= 12;
    }

    yCursor = y0 - gap;
  }

  page.drawText("Worker rule: Scan WHAT (product/carton) + Scan WHERE (bin) + Confirm QTY.", {
    x: margin,
    y: margin + 12,
    size: 8,
    font: fontBold,
    color: rgb(0.06, 0.09, 0.16),
  });
}

async function main() {
  const pdf = await PDFDocument.create();
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  const pageW = 595.28;
  const pageH = 841.89;

  const p1 = pdf.addPage([pageW, pageH]);
  await drawBayBinSheet(pdf, p1, fontBold, font);

  const p2 = pdf.addPage([pageW, pageH]);
  await drawOtherLabelSamples(pdf, p2, fontBold, font);

  const pdfBytes = await pdf.save();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, pdfBytes);
  console.log("Wrote", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
