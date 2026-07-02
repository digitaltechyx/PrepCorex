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

export type RichTextTable = {
  rows: string[][];
  hasHeaderRow: boolean;
};

export type RichTextSegment =
  | { type: "runs"; runs: RichTextRun[] }
  | { type: "table"; table: RichTextTable };

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

type HtmlElement = {
  tagName?: string;
  getAttribute: (name: string) => string | undefined;
  childNodes: HtmlNode[];
};

type HtmlNode = {
  nodeType: number;
  rawText: string;
  tagName?: string;
  getAttribute?: (name: string) => string | undefined;
  childNodes?: HtmlNode[];
};

function styleFromElement(
  el: HtmlElement,
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

function normalizeInlineText(text: string): string {
  return decodeEntities(text.replace(/\s+/g, " "));
}

function appendInlineRuns(
  nodes: HtmlNode[],
  base: Omit<RichTextRun, "text">,
  runs: RichTextRun[]
) {
  for (const child of nodes) {
    if (child.nodeType === 3) {
      const text = normalizeInlineText(child.rawText);
      if (text.trim()) runs.push({ ...base, text });
      continue;
    }
    if (child.nodeType !== 1) continue;

    const el = child as HtmlElement;
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "br") {
      runs.push({ ...base, text: "\n" });
      continue;
    }

    const nextBase = styleFromElement(el, base);
    if (tag === "ul" || tag === "ol") {
      appendListRuns(el, nextBase, runs, 0);
      continue;
    }

    appendInlineRuns(el.childNodes, nextBase, runs);
  }
}

function appendListRuns(
  listEl: HtmlElement,
  base: Omit<RichTextRun, "text">,
  runs: RichTextRun[],
  depth: number
) {
  const listType = (listEl.tagName || "ul").toLowerCase() === "ol" ? "ol" : "ul";
  const startAttr = Number(listEl.getAttribute("start"));
  let index = Number.isFinite(startAttr) && startAttr > 0 ? startAttr - 1 : 0;
  const indent = "    ".repeat(depth);

  for (const child of listEl.childNodes) {
    if (child.nodeType !== 1) continue;
    const el = child as HtmlElement;
    const tag = (el.tagName || "").toLowerCase();
    if (tag !== "li") continue;

    index += 1;
    const prefix = listType === "ol" ? `${indent}${index}. ` : `${indent}• `;
    runs.push({ ...base, text: prefix });

    for (const liChild of el.childNodes) {
      if (liChild.nodeType === 3) {
        const text = normalizeInlineText(liChild.rawText);
        if (text.trim()) runs.push({ ...base, text });
        continue;
      }
      if (liChild.nodeType !== 1) continue;

      const liEl = liChild as HtmlElement;
      const liTag = (liEl.tagName || "").toLowerCase();
      const liBase = styleFromElement(liEl, base);

      if (liTag === "ul" || liTag === "ol") {
        runs.push({ ...base, text: "\n" });
        appendListRuns(liEl, liBase, runs, depth + 1);
        continue;
      }
      if (liTag === "p" || liTag === "div") {
        appendInlineRuns(liEl.childNodes, liBase, runs);
        continue;
      }
      if (liTag === "br") {
        runs.push({ ...base, text: "\n" });
        continue;
      }

      appendInlineRuns([liChild], liBase, runs);
    }

    runs.push({ ...base, text: "\n" });
  }

  if (depth === 0) {
    runs.push({ ...base, text: "\n" });
  }
}

function appendBlockRuns(
  nodes: HtmlNode[],
  base: Omit<RichTextRun, "text">,
  runs: RichTextRun[]
) {
  for (const child of nodes) {
    if (child.nodeType === 3) {
      const text = normalizeInlineText(child.rawText);
      if (text.trim()) runs.push({ ...base, text });
      continue;
    }
    if (child.nodeType !== 1) continue;

    const el = child as HtmlElement;
    const tag = (el.tagName || "").toLowerCase();
    const blockBase = styleFromElement(el, base);

    if (tag === "ul" || tag === "ol") {
      appendListRuns(el, blockBase, runs, 0);
      continue;
    }

    if (tag === "table") {
      runs.push({ ...base, text: "\n" });
      continue;
    }

    if (tag === "br") {
      runs.push({ ...base, text: "\n" });
      continue;
    }

    if (tag === "p" || tag === "div" || tag === "blockquote") {
      appendInlineRuns(el.childNodes, blockBase, runs);
      runs.push({ ...base, text: "\n" });
      continue;
    }

    if (["h1", "h2", "h3", "h4"].includes(tag)) {
      appendInlineRuns(el.childNodes, { ...blockBase, bold: true }, runs);
      runs.push({ ...base, text: "\n" });
      continue;
    }

    appendInlineRuns([child], blockBase, runs);
  }
}

export function htmlToRichTextRuns(html: string, defaultFontSize = 9): RichTextRun[] {
  const segments = htmlToRichTextSegments(html, defaultFontSize);
  const runs: RichTextRun[] = [];
  for (const segment of segments) {
    if (segment.type === "runs") {
      runs.push(...segment.runs);
    } else {
      runs.push({ fontSize: defaultFontSize, fontFamily: "helvetica", text: "\n" });
    }
  }
  return runs.filter((run) => run.text.length > 0);
}

function extractCellText(cell: HtmlElement, defaultFontSize: number): string {
  const runs: RichTextRun[] = [];
  appendInlineRuns(cell.childNodes as HtmlNode[], {
    fontSize: defaultFontSize,
    fontFamily: "helvetica",
  }, runs);
  return runs
    .map((run) => (run.text === "\n" ? " " : run.text))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHtmlTable(tableEl: HtmlElement, defaultFontSize: number): RichTextTable {
  const rows: string[][] = [];
  let hasHeaderRow = false;
  const rowElements: HtmlElement[] = [];

  for (const section of tableEl.childNodes) {
    if (section.nodeType !== 1) continue;
    const sectionEl = section as HtmlElement;
    const sectionTag = (sectionEl.tagName || "").toLowerCase();

    if (sectionTag === "thead") {
      hasHeaderRow = true;
      for (const tr of sectionEl.childNodes) {
        if (tr.nodeType === 1 && (tr as HtmlElement).tagName?.toLowerCase() === "tr") {
          rowElements.push(tr as HtmlElement);
        }
      }
      continue;
    }

    if (sectionTag === "tbody") {
      for (const tr of sectionEl.childNodes) {
        if (tr.nodeType === 1 && (tr as HtmlElement).tagName?.toLowerCase() === "tr") {
          rowElements.push(tr as HtmlElement);
        }
      }
      continue;
    }

    if (sectionTag === "tr") {
      rowElements.push(sectionEl);
    }
  }

  for (const tr of rowElements) {
    const cells: string[] = [];
    let rowHasHeader = false;
    for (const cellNode of tr.childNodes) {
      if (cellNode.nodeType !== 1) continue;
      const cell = cellNode as HtmlElement;
      const cellTag = (cell.tagName || "").toLowerCase();
      if (cellTag !== "td" && cellTag !== "th") continue;
      if (cellTag === "th") rowHasHeader = true;
      cells.push(extractCellText(cell, defaultFontSize));
    }
    if (!cells.length) continue;
    if (rows.length === 0 && rowHasHeader) hasHeaderRow = true;
    rows.push(cells);
  }

  const colCount = Math.max(1, ...rows.map((row) => row.length));
  return {
    rows: rows.map((row) => {
      const padded = [...row];
      while (padded.length < colCount) padded.push("");
      return padded;
    }),
    hasHeaderRow,
  };
}

function walkHtmlForSegments(
  nodes: HtmlNode[],
  base: Omit<RichTextRun, "text">,
  segments: RichTextSegment[],
  pendingRuns: RichTextRun[]
): RichTextRun[] {
  let currentRuns = pendingRuns;

  const flushRuns = () => {
    const filtered = currentRuns.filter((run) => run.text.length > 0);
    if (filtered.length) segments.push({ type: "runs", runs: filtered });
    currentRuns = [];
  };

  for (const child of nodes) {
    if (child.nodeType === 3) {
      const text = normalizeInlineText(child.rawText);
      if (text.trim()) currentRuns.push({ ...base, text });
      continue;
    }
    if (child.nodeType !== 1) continue;

    const el = child as HtmlElement;
    const tag = (el.tagName || "").toLowerCase();

    if (tag === "table") {
      flushRuns();
      segments.push({ type: "table", table: parseHtmlTable(el, base.fontSize || 9) });
      continue;
    }

    if (tag === "div" || tag === "blockquote") {
      currentRuns = walkHtmlForSegments(el.childNodes as HtmlNode[], base, segments, currentRuns);
      currentRuns.push({ ...base, text: "\n" });
      continue;
    }

    const blockRuns: RichTextRun[] = [];
    appendBlockRuns([child], base, blockRuns);
    currentRuns.push(...blockRuns);
  }

  return currentRuns;
}

export function htmlToRichTextSegments(html: string, defaultFontSize = 9): RichTextSegment[] {
  const root = parse(html, { lowerCaseTagName: true });
  const base = {
    fontSize: defaultFontSize,
    fontFamily: "helvetica",
  };
  const segments: RichTextSegment[] = [];
  const pending = walkHtmlForSegments(root.childNodes as HtmlNode[], base, segments, []);
  const filtered = pending.filter((run) => run.text.length > 0);
  if (filtered.length) segments.push({ type: "runs", runs: filtered });
  return segments;
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
