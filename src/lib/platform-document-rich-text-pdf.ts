import type jsPDF from "jspdf";
import { parse } from "node-html-parser";

export type RichTextRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
};

export function isRichTextContent(value: string): boolean {
  return /<[a-z][\s\S]*>/i.test(value);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseCssSize(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const match = value.trim().match(/^([\d.]+)(px|pt)?$/i);
  if (!match) return fallback;
  const num = Number(match[1]);
  if (!Number.isFinite(num)) return fallback;
  const unit = (match[2] || "pt").toLowerCase();
  return unit === "px" ? Math.round(num * 0.75) : Math.round(num);
}

function parseColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) return trimmed;
  const rgb = trimmed.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  if (rgb) {
    const r = Number(rgb[1]).toString(16).padStart(2, "0");
    const g = Number(rgb[2]).toString(16).padStart(2, "0");
    const b = Number(rgb[3]).toString(16).padStart(2, "0");
    return `#${r}${g}${b}`;
  }
  return undefined;
}

function mapFontFamily(value: string | undefined): string {
  const family = (value || "").toLowerCase();
  if (family.includes("courier") || family.includes("mono")) return "courier";
  if (
    family.includes("times") ||
    family.includes("georgia") ||
    family.includes("serif")
  ) {
    return "times";
  }
  return "helvetica";
}

function mergeStyles(
  base: Omit<RichTextRun, "text">,
  patch: Partial<Omit<RichTextRun, "text">>
): Omit<RichTextRun, "text"> {
  return {
    bold: patch.bold ?? base.bold,
    italic: patch.italic ?? base.italic,
    underline: patch.underline ?? base.underline,
    fontSize: patch.fontSize ?? base.fontSize,
    fontFamily: patch.fontFamily ?? base.fontFamily,
    color: patch.color ?? base.color,
  };
}

function styleFromElement(
  el: { getAttribute: (name: string) => string | undefined; tagName?: string },
  base: Omit<RichTextRun, "text">
): Omit<RichTextRun, "text"> {
  const style = el.getAttribute("style") || "";
  const patch: Partial<Omit<RichTextRun, "text">> = {};
  const tag = (el.tagName || "").toLowerCase();

  if (tag === "strong" || tag === "b") patch.bold = true;
  if (tag === "em" || tag === "i") patch.italic = true;
  if (tag === "u") patch.underline = true;

  for (const part of style.split(";")) {
    const [rawKey, rawValue] = part.split(":");
    if (!rawKey || !rawValue) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rawValue.trim();
    if (key === "font-weight" && (value === "bold" || Number(value) >= 600)) patch.bold = true;
    if (key === "font-style" && value === "italic") patch.italic = true;
    if (key === "text-decoration" && value.includes("underline")) patch.underline = true;
    if (key === "font-size") patch.fontSize = parseCssSize(value, base.fontSize || 9);
    if (key === "font-family") patch.fontFamily = mapFontFamily(value);
    if (key === "color") patch.color = parseColor(value);
  }

  return mergeStyles(base, patch);
}

function collectRuns(
  node: ReturnType<typeof parse>,
  base: Omit<RichTextRun, "text">,
  runs: RichTextRun[]
) {
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      const text = decodeEntities(child.rawText.replace(/\s+/g, " "));
      if (text.trim()) runs.push({ ...base, text });
      continue;
    }
    if (child.nodeType !== 1) continue;

    const el = child as unknown as {
      tagName?: string;
      getAttribute: (name: string) => string | undefined;
      childNodes: typeof node.childNodes;
    };
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "br") {
      runs.push({ ...base, text: "\n" });
      continue;
    }

    const nextBase = styleFromElement(el, base);
    collectRuns(el as unknown as ReturnType<typeof parse>, nextBase, runs);
  }
}

export function htmlToRichTextRuns(html: string, defaultFontSize = 9): RichTextRun[] {
  const root = parse(html, { lowerCaseTagName: true });
  const runs: RichTextRun[] = [];
  const base = {
    fontSize: defaultFontSize,
    fontFamily: "helvetica",
  };

  for (const child of root.childNodes) {
    if (child.nodeType === 3) {
      const text = decodeEntities(child.rawText.replace(/\s+/g, " "));
      if (text.trim()) runs.push({ ...base, text });
      continue;
    }
    if (child.nodeType !== 1) continue;
    const el = child as unknown as {
      tagName?: string;
      getAttribute: (name: string) => string | undefined;
      childNodes: typeof root.childNodes;
    };
    const tag = (el.tagName || "").toLowerCase();
    const blockBase = styleFromElement(el, base);
    collectRuns(el as unknown as ReturnType<typeof parse>, blockBase, runs);
    if (["p", "div", "li", "h1", "h2", "h3", "h4"].includes(tag)) {
      runs.push({ ...base, text: "\n" });
    }
  }

  return runs.filter((run) => run.text.length > 0);
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  const full =
    normalized.length === 3
      ? normalized
          .split("")
          .map((c) => c + c)
          .join("")
      : normalized.slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return [r, g, b];
}

export function applyRunStyle(pdf: jsPDF, run: RichTextRun) {
  const family = mapFontFamily(run.fontFamily);
  const style =
    run.bold && run.italic
      ? "bolditalic"
      : run.bold
        ? "bold"
        : run.italic
          ? "italic"
          : "normal";
  pdf.setFont(family, style);
  pdf.setFontSize(run.fontSize || 9);
  if (run.color) {
    pdf.setTextColor(...hexToRgb(run.color));
  } else {
    pdf.setTextColor(0, 0, 0);
  }
}

export type RichTextLayoutContext = {
  pdf: jsPDF;
  x: number;
  y: number;
  maxWidth: number;
  lineHeightFactor?: number;
};

export function drawRichTextRuns(
  ctx: RichTextLayoutContext,
  runs: RichTextRun[]
): { y: number } {
  const { pdf, x, maxWidth } = ctx;
  let y = ctx.y;
  let cursorX = x;
  const defaultSize = runs[0]?.fontSize || 9;

  const newLine = (size = defaultSize) => {
    cursorX = x;
    y += size * (ctx.lineHeightFactor ?? 0.42);
  };

  for (const run of runs) {
    if (run.text === "\n") {
      newLine(run.fontSize || defaultSize);
      continue;
    }

    applyRunStyle(pdf, run);
    const fontSize = run.fontSize || defaultSize;
    const parts = run.text.split(/(\s+)/);

    for (const part of parts) {
      if (!part) continue;
      const width = pdf.getTextWidth(part);
      if (cursorX + width > x + maxWidth && cursorX > x) {
        newLine(fontSize);
      }
      pdf.text(part, cursorX, y);
      if (run.underline && part.trim()) {
        pdf.setDrawColor(0, 0, 0);
        pdf.line(cursorX, y + 0.8, cursorX + width, y + 0.8);
      }
      cursorX += width;
    }
  }

  return { y: y + defaultSize * (ctx.lineHeightFactor ?? 0.42) + 2 };
}
