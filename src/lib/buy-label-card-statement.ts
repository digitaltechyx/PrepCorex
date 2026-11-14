import { jsPDF } from "jspdf";
import { format } from "date-fns";
import type { LabelPurchase } from "@/types";
import { isWalletLabelPayment } from "@/lib/label-refund";

export type BuyLabelCardStatementRow = {
  id: string;
  dateLabel: string;
  cardLabel: string;
  cardKey: string;
  carrier: string;
  tracking: string;
  destination: string;
  amountCents: number;
  currency: string;
  statusLabel: string;
  paymentRef: string;
};

/**
 * PrepCorex marketing / hero theme: white + warm peach surfaces, orange accents,
 * charcoal type (matches prepcorex.com hero — not the indigo app primary).
 */
const PCX = {
  orange: [255, 106, 0] as [number, number, number], // #FF6A00
  orangeSoft: [255, 237, 213] as [number, number, number], // peach tint
  orangeMid: [249, 115, 22] as [number, number, number],
  ink: [28, 25, 23] as [number, number, number], // near-black charcoal
  muted: [120, 113, 108] as [number, number, number],
  line: [231, 229, 228] as [number, number, number],
  surface: [255, 255, 255] as [number, number, number],
  page: [255, 251, 247] as [number, number, number], // soft warm white
};

/** Site wordmark (same asset as web Logo component). Rasterized for jsPDF. */
export const PREPCOREX_STATEMENT_LOGO_SRC = "/PCX%20Testing-16.svg";

/** Fallback PNG if SVG rasterize fails. */
const PREPCOREX_STATEMENT_LOGO_PNG_FALLBACK = "/b-card/prepcorex-logo.png";

async function blobToDataUrl(blob: Blob): Promise<string | null> {
  return await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

/** Load PrepCorex logo as PNG data URL for the statement PDF header. */
export async function loadPrepcorexLogoDataUrl(): Promise<string | null> {
  try {
    if (typeof document !== "undefined") {
      const svgRes = await fetch(PREPCOREX_STATEMENT_LOGO_SRC);
      if (svgRes.ok) {
        const svgText = await svgRes.text();
        const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
        const objectUrl = URL.createObjectURL(svgBlob);
        try {
          const dataUrl = await new Promise<string | null>((resolve) => {
            const img = new Image();
            img.onload = () => {
              try {
                const w = Math.max(1, img.naturalWidth || 836);
                const h = Math.max(1, img.naturalHeight || 200);
                const canvas = document.createElement("canvas");
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext("2d");
                if (!ctx) {
                  resolve(null);
                  return;
                }
                ctx.clearRect(0, 0, w, h);
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL("image/png"));
              } catch {
                resolve(null);
              }
            };
            img.onerror = () => resolve(null);
            img.src = objectUrl;
          });
          if (dataUrl) return dataUrl;
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      }
    }

    const pngRes = await fetch(PREPCOREX_STATEMENT_LOGO_PNG_FALLBACK);
    if (!pngRes.ok) return null;
    return blobToDataUrl(await pngRes.blob());
  } catch {
    return null;
  }
}

function labelCreatedAtMs(label: LabelPurchase): number {
  if (!label.createdAt) return 0;
  try {
    if (typeof label.createdAt === "string") {
      const ms = new Date(label.createdAt).getTime();
      return Number.isFinite(ms) ? ms : 0;
    }
    if (typeof label.createdAt === "object" && "seconds" in label.createdAt) {
      return (label.createdAt as { seconds: number }).seconds * 1000;
    }
  } catch {
    return 0;
  }
  return 0;
}

function labelDateOnly(ms: number): Date | null {
  if (!ms) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function inDateRange(ms: number, startDate: string, endDate: string): boolean {
  if (!startDate && !endDate) return true;
  const day = labelDateOnly(ms);
  if (!day) return false;
  if (startDate) {
    const from = new Date(startDate);
    const fromOnly = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    if (day < fromOnly) return false;
  }
  if (endDate) {
    const to = new Date(endDate);
    const toOnly = new Date(to.getFullYear(), to.getMonth(), to.getDate());
    if (day > toOnly) return false;
  }
  return true;
}

function isSuccessfulCardCharge(label: LabelPurchase): boolean {
  if (isWalletLabelPayment(label)) return false;
  const pay = String(label.paymentStatus || "").toLowerCase();
  const status = String(label.status || "").toLowerCase();
  if (pay === "succeeded") return true;
  return (
    status === "payment_succeeded" ||
    status === "label_purchased" ||
    status === "completed" ||
    status === "label_failed"
  );
}

function statusLabelFor(label: LabelPurchase): string {
  const refund = String(label.refundStatus || "").toLowerCase();
  if (refund === "refunded") return "Refunded";
  if (refund === "requested") return "Refund pending";
  if (refund === "rejected") return "Refund declined";
  const status = String(label.status || "").toLowerCase();
  if (status === "label_failed") return "Paid · failed";
  if (status === "label_purchased" || status === "completed") return "Paid · issued";
  if (status === "payment_succeeded") return "Paid";
  return "Card charge";
}

function brandLabel(brand: string | null | undefined): string {
  const b = String(brand || "").trim().toLowerCase();
  if (!b || b === "card") return "Card";
  if (b === "amex" || b === "american_express") return "Amex";
  if (b === "mastercard") return "Mastercard";
  if (b === "visa") return "Visa";
  if (b === "discover") return "Discover";
  if (b === "diners" || b === "diners_club") return "Diners";
  if (b === "jcb") return "JCB";
  if (b === "unionpay") return "UnionPay";
  return b.charAt(0).toUpperCase() + b.slice(1);
}

export function formatChargedCardLabel(label: {
  cardBrand?: string | null;
  cardLast4?: string | null;
}): string {
  const last4 = String(label.cardLast4 || "").trim();
  const brand = brandLabel(label.cardBrand);
  if (last4 && last4 !== "????") return `${brand} **** ${last4}`;
  if (last4 === "????") return `${brand} **** ****`;
  return "Card unavailable";
}

function cardKeyFor(label: {
  cardBrand?: string | null;
  cardLast4?: string | null;
  stripePaymentMethodId?: string | null;
}): string {
  const last4 = String(label.cardLast4 || "").trim();
  const brand = String(label.cardBrand || "").trim().toLowerCase() || "card";
  if (last4 && last4 !== "????") return `${brand}:${last4}`;
  const pm = String(label.stripePaymentMethodId || "").trim();
  if (pm) return `pm:${pm}`;
  return "unknown";
}

function money(cents: number, currency = "USD"): string {
  const cur = (currency || "USD").toUpperCase();
  return `${cur} $${(Math.max(0, cents) / 100).toFixed(2)}`;
}

function ellipsizeToWidth(doc: jsPDF, text: string, maxWidth: number): string {
  let t = String(text || "");
  if (doc.getTextWidth(t) <= maxWidth) return t;
  while (t.length > 1 && doc.getTextWidth(`${t.slice(0, -1)}…`) > maxWidth) {
    t = t.slice(0, -1);
  }
  return t.length ? `${t}…` : "";
}

/** Card (Stripe) Buy Label charges only — excludes wallet. */
export function selectBuyLabelCardCharges(
  labels: LabelPurchase[],
  opts?: { startDate?: string; endDate?: string }
): BuyLabelCardStatementRow[] {
  const startDate = opts?.startDate || "";
  const endDate = opts?.endDate || "";

  return labels
    .filter((label) => isSuccessfulCardCharge(label))
    .filter((label) => inDateRange(labelCreatedAtMs(label), startDate, endDate))
    .sort((a, b) => labelCreatedAtMs(b) - labelCreatedAtMs(a))
    .map((label) => {
      const ms = labelCreatedAtMs(label);
      const carrier = [label.selectedRate?.provider, label.selectedRate?.serviceLevel]
        .filter(Boolean)
        .join(" · ");
      const dest = [label.toAddress?.city, label.toAddress?.state].filter(Boolean).join(", ");
      const pi = String(label.stripePaymentIntentId || "").trim();
      return {
        id: label.id,
        dateLabel: ms ? format(new Date(ms), "MMM d, yyyy") : "—",
        cardLabel: formatChargedCardLabel(label),
        cardKey: cardKeyFor(label),
        carrier: carrier || "—",
        tracking: String(label.trackingNumber || "").trim() || "—",
        destination: dest || "—",
        amountCents: Math.max(0, Math.floor(Number(label.paymentAmount) || 0)),
        currency: String(label.paymentCurrency || "USD").toUpperCase(),
        statusLabel: statusLabelFor(label),
        paymentRef: pi.startsWith("pi_") ? pi.slice(0, 20) : pi || "—",
      };
    });
}

export function summarizeSpendByCard(rows: BuyLabelCardStatementRow[]): Array<{
  cardLabel: string;
  count: number;
  amountCents: number;
  currency: string;
}> {
  const map = new Map<
    string,
    { cardLabel: string; count: number; amountCents: number; currency: string }
  >();
  for (const row of rows) {
    const cur = map.get(row.cardKey) || {
      cardLabel: row.cardLabel,
      count: 0,
      amountCents: 0,
      currency: row.currency,
    };
    cur.count += 1;
    cur.amountCents += row.amountCents;
    map.set(row.cardKey, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.amountCents - a.amountCents);
}

export function buildBuyLabelCardStatementPdf(input: {
  accountName: string;
  accountEmail?: string;
  startDate?: string;
  endDate?: string;
  rows: BuyLabelCardStatementRow[];
  /** data:image/png;base64,… PrepCorex logo */
  logoDataUrl?: string | null;
}): Uint8Array {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentW = pageW - margin * 2;
  let y = 0;

  const parseDayLabel = (iso: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").trim());
    if (!m) return iso;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return format(d, "MMM d, yyyy");
  };
  const periodLabel =
    input.startDate && input.endDate
      ? `${parseDayLabel(input.startDate)} – ${parseDayLabel(input.endDate)}`
      : input.startDate
        ? `From ${parseDayLabel(input.startDate)}`
        : input.endDate
          ? `Through ${parseDayLabel(input.endDate)}`
          : "All time";

  const charged = input.rows.reduce((sum, r) => sum + r.amountCents, 0);
  const refunded = input.rows
    .filter((r) => r.statusLabel === "Refunded")
    .reduce((sum, r) => sum + r.amountCents, 0);
  const currency = input.rows[0]?.currency || "USD";
  const byCard = summarizeSpendByCard(input.rows);

  const paintPageWash = () => {
    doc.setFillColor(...PCX.page);
    doc.rect(0, 0, pageW, pageH, "F");
  };

  const ensureSpace = (need: number) => {
    if (y + need <= pageH - 12) return false;
    doc.addPage();
    paintPageWash();
    y = margin;
    return true;
  };

  paintPageWash();

  // White header band + orange accent (hero theme)
  doc.setFillColor(...PCX.surface);
  doc.rect(0, 0, pageW, 32, "F");
  doc.setFillColor(...PCX.orange);
  doc.rect(0, 32, pageW, 2.2, "F");

  const logoH = 12;
  const logoW = 48;
  if (input.logoDataUrl) {
    try {
      const fmt = input.logoDataUrl.includes("image/jpeg") ? "JPEG" : "PNG";
      doc.addImage(input.logoDataUrl, fmt, margin, 6, logoW, logoH);
    } catch {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(...PCX.ink);
      doc.text("PrepCorex", margin, 14);
    }
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...PCX.ink);
    doc.text("PrepCorex", margin, 14);
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...PCX.ink);
  doc.text("Buy Labels  ·  Card Payment Statement", margin + (input.logoDataUrl ? logoW + 4 : 42), 12);
  doc.setTextColor(...PCX.ink);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(input.accountName || "Client account", margin, 28);
  doc.setFont("helvetica", "normal");

  doc.setFontSize(8);
  doc.setTextColor(...PCX.muted);
  const meta = [
    input.accountEmail || null,
    `Period ${periodLabel}`,
    `Generated ${format(new Date(), "MMM d, yyyy h:mm a")}`,
  ]
    .filter(Boolean)
    .join("   ·   ");
  doc.text(meta, pageW - margin, 28, { align: "right" });

  y = 40;

  // Summary cards
  const gap = 4;
  const boxW = (contentW - gap * 2) / 3;
  const drawStat = (x: number, label: string, value: string) => {
    doc.setFillColor(...PCX.surface);
    doc.setDrawColor(...PCX.line);
    doc.roundedRect(x, y, boxW, 15, 2, 2, "FD");
    doc.setFillColor(...PCX.orange);
    doc.rect(x, y, 1.8, 15, "F");
    doc.setFontSize(6.5);
    doc.setTextColor(...PCX.muted);
    doc.setFont("helvetica", "bold");
    doc.text(label.toUpperCase(), x + 5, y + 5.5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(...PCX.ink);
    doc.text(value, x + 5, y + 11.5);
  };
  drawStat(margin, "Card charges", String(input.rows.length));
  drawStat(margin + boxW + gap, "Total charged", money(charged, currency));
  drawStat(margin + (boxW + gap) * 2, "Refunded (listed)", money(refunded, currency));
  y += 19;

  doc.setFontSize(7);
  doc.setTextColor(...PCX.muted);
  doc.text(
    "Statement covers card charges only. For wallet purchases, please check your purchase history.",
    margin,
    y
  );
  y += 6;

  if (byCard.length > 0) {
    ensureSpace(8 + byCard.length * 5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...PCX.ink);
    doc.text("Spend by card", margin, y);
    doc.setFont("helvetica", "normal");
    y += 5;
    for (const row of byCard) {
      ensureSpace(5);
      doc.setFillColor(...PCX.orangeSoft);
      doc.roundedRect(margin, y - 3.2, contentW, 5, 1, 1, "F");
      doc.setFontSize(8);
      doc.setTextColor(...PCX.ink);
      doc.text(ellipsizeToWidth(doc, row.cardLabel, 70), margin + 2, y);
      doc.setTextColor(...PCX.muted);
      doc.text(`${row.count} charge${row.count === 1 ? "" : "s"}`, margin + 90, y);
      doc.setTextColor(...PCX.ink);
      doc.setFont("helvetica", "bold");
      doc.text(money(row.amountCents, row.currency), pageW - margin - 2, y, { align: "right" });
      doc.setFont("helvetica", "normal");
      y += 5.5;
    }
    y += 3;
  }

  if (input.rows.length === 0) {
    doc.setTextColor(...PCX.ink);
    doc.setFontSize(11);
    doc.text("No card charges found for this period.", margin, y + 6);
    return new Uint8Array(doc.output("arraybuffer"));
  }

  /**
   * Fixed column geometry (mm from left). Each cell is drawn only inside [x, x+w].
   * Amount + Status are right-aligned inside their own boxes so headers match values.
   */
  const tableLeft = margin;
  const tableRight = pageW - margin;
  const colDefs = [
    { key: "date", title: "Date", w: 26, align: "left" as const },
    { key: "card", title: "Card", w: 36, align: "left" as const },
    { key: "carrier", title: "Carrier", w: 50, align: "left" as const },
    { key: "dest", title: "Destination", w: 34, align: "left" as const },
    { key: "track", title: "Tracking", w: 40, align: "left" as const },
    { key: "amount", title: "Amount", w: 30, align: "right" as const },
    { key: "status", title: "Status", w: 28, align: "right" as const },
  ];
  // Normalize widths to exact content width
  const rawSum = colDefs.reduce((s, c) => s + c.w, 0);
  const scale = contentW / rawSum;
  let xCursor = tableLeft;
  const cols = colDefs.map((c) => {
    const w = c.w * scale;
    const col = { ...c, x: xCursor, w };
    xCursor += w;
    return col;
  });

  const cellPad = 1.2;
  const drawCell = (
    col: (typeof cols)[number],
    text: string,
    baseline: number,
    opts?: { bold?: boolean; color?: [number, number, number]; size?: number }
  ) => {
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    doc.setFontSize(opts?.size ?? 7.5);
    doc.setTextColor(...(opts?.color || PCX.ink));
    const maxW = Math.max(4, col.w - cellPad * 2);
    const t = ellipsizeToWidth(doc, text, maxW);
    if (col.align === "right") {
      doc.text(t, col.x + col.w - cellPad, baseline, { align: "right" });
    } else {
      doc.text(t, col.x + cellPad, baseline);
    }
  };

  const drawTableHeader = () => {
    doc.setFillColor(...PCX.orangeSoft);
    doc.rect(tableLeft, y - 4, contentW, 8, "F");
    doc.setDrawColor(...PCX.orange);
    doc.setLineWidth(0.3);
    doc.line(tableLeft, y + 4, tableRight, y + 4);
    for (const col of cols) {
      drawCell(col, col.title, y, { bold: true, color: PCX.ink, size: 7 });
    }
    y += 7;
  };

  drawTableHeader();

  for (let i = 0; i < input.rows.length; i++) {
    const row = input.rows[i];
    const rowH = 9.5;
    if (ensureSpace(rowH + 2)) {
      drawTableHeader();
    }

    if (i % 2 === 1) {
      doc.setFillColor(255, 255, 255);
      doc.rect(tableLeft, y - 3.5, contentW, rowH, "F");
    }

    drawCell(cols[0], row.dateLabel, y);
    drawCell(cols[1], row.cardLabel, y, { bold: true });
    drawCell(cols[2], row.carrier, y);
    drawCell(cols[3], row.destination, y);
    drawCell(cols[4], row.tracking, y);
    drawCell(cols[5], money(row.amountCents, row.currency), y, { bold: true });
    drawCell(cols[6], row.statusLabel, y, {
      color: row.statusLabel === "Refunded" ? ([185, 28, 28] as [number, number, number]) : PCX.muted,
    });

    y += 4;
    doc.setFontSize(6);
    doc.setTextColor(...PCX.muted);
    doc.setFont("helvetica", "normal");
    const ref = `Ref ${row.paymentRef}  ·  #${row.id.slice(0, 8)}`;
    const refCol = cols[2];
    const refMax = cols[2].w + cols[3].w + cols[4].w - cellPad * 2;
    doc.text(ellipsizeToWidth(doc, ref, refMax), refCol.x + cellPad, y);
    y += 5.2;
  }

  ensureSpace(14);
  y += 2;
  doc.setDrawColor(...PCX.line);
  doc.line(tableLeft, y, tableRight, y);
  y += 7;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...PCX.ink);
  doc.text(
    `Net listed charges: ${money(Math.max(0, charged - refunded), currency)}`,
    margin,
    y
  );
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...PCX.muted);
  doc.text("PrepCorex  ·  support@prepcorex.com", pageW - margin, y, { align: "right" });

  return new Uint8Array(doc.output("arraybuffer"));
}

export function downloadBuyLabelCardStatementPdf(
  bytes: Uint8Array,
  filename: string
): void {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
