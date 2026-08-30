import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "docs", "TIKTOK_APP_REVIEW_SUBMISSION.md");
const outputPath = path.join(root, "docs", "TIKTOK_APP_REVIEW_PRD.pdf");
const source = await fs.readFile(sourcePath, "utf8");

const startMarker = "## Product Requirements and Design Document";
const endMarker = "## Final pre-submission checklist";
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker);
if (start < 0 || end < 0 || end <= start) {
  throw new Error("Could not find the PRD section in the submission guide.");
}

const markdown = source.slice(start, end).trim();
const pdf = await PDFDocument.create();
pdf.setTitle("PrepCorex TikTok Shop Product Requirements and Design Document");
pdf.setAuthor("PrepCorex");
pdf.setSubject("TikTok Shop app review");
pdf.setKeywords(["PrepCorex", "TikTok Shop", "OMS", "WMS", "app review"]);

const regular = await pdf.embedFont(StandardFonts.Helvetica);
const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
const pageSize = [595.28, 841.89];
const margin = 54;
const contentWidth = pageSize[0] - margin * 2;
let page;
let y;

function addPage() {
  page = pdf.addPage(pageSize);
  y = pageSize[1] - margin;
  page.drawText("PrepCorex | TikTok Shop App Review", {
    x: margin,
    y: 24,
    size: 8,
    font: regular,
    color: rgb(0.45, 0.45, 0.45),
  });
}

function cleanInline(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`(.*?)`/g, "$1")
    .replace(/^>\s?/, "")
    .replace(/→/g, "to")
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}

function wrap(text, font, size, maxWidth) {
  const words = cleanInline(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function ensureSpace(height) {
  if (y - height < margin) addPage();
}

function drawBlock(text, { font = regular, size = 10, indent = 0, gap = 6 } = {}) {
  const lines = wrap(text, font, size, contentWidth - indent);
  const lineHeight = size * 1.42;
  ensureSpace(lines.length * lineHeight + gap);
  for (const line of lines) {
    page.drawText(line, {
      x: margin + indent,
      y,
      size,
      font,
      color: rgb(0.12, 0.12, 0.12),
    });
    y -= lineHeight;
  }
  y -= gap;
}

addPage();
for (const rawLine of markdown.split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line) {
    y -= 3;
    continue;
  }
  if (line.startsWith("## ")) {
    drawBlock(line.slice(3), { font: bold, size: 18, gap: 14 });
  } else if (line.startsWith("### ")) {
    drawBlock(line.slice(4), { font: bold, size: 13, gap: 8 });
  } else if (/^\d+\.\s/.test(line)) {
    drawBlock(line, { size: 10, indent: 12, gap: 4 });
  } else if (line.startsWith("- ")) {
    drawBlock(`• ${line.slice(2)}`, { size: 10, indent: 12, gap: 4 });
  } else {
    drawBlock(line, { size: 10, gap: 6 });
  }
}

const bytes = await pdf.save();
await fs.writeFile(outputPath, bytes);
console.log(`Created ${path.relative(root, outputPath)}`);
