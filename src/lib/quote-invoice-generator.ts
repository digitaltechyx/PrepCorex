import jsPDF from "jspdf";
import { quotationInvoiceLogoSrc } from "@/lib/quotation-invoice-logo";

interface QuoteInvoiceParty {
  name: string;
  email?: string;
  phone?: string;
  addressLine?: string;
  cityStateZip?: string;
  country?: string;
}

export interface QuoteInvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  /** When set (with lineTable "detail"), shown in PRODUCT / DATE / SKU / PACK columns. */
  productName?: string;
  shipDate?: string;
  sku?: string;
  packaging?: string;
  /** Clickable PrepCorex order deep link (PRODUCT / Item Description). */
  descriptionUrl?: string;
}

export interface QuoteInvoiceData {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string;
  company: QuoteInvoiceParty;
  soldTo: QuoteInvoiceParty;
  items: QuoteInvoiceItem[];
  subtotal: number;
  salesTax: number;
  shippingCost: number;
  discount?: number;
  lateFee?: number;
  total: number;
  terms?: string;
  invoiceNote?: string;
  fobPoint?: string;
  shippingTerms?: string;
  shippedVia?: string;
  /**
   * `detail` = QUANTITY / PRODUCT / DATE / SKU / PACK / UNIT PRICE / AMOUNT
   * (PrepCorex warehouse invoices). Default `simple` keeps CRM Item Description layout.
   */
  lineTable?: "simple" | "detail";
}

function logoFormatForPdf(src: string): "PNG" | "JPEG" {
  const path = decodeURIComponent(src.split("?")[0] || "");
  const lower = path.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "JPEG";
  return "PNG";
}

const loadLogo = async (src: string): Promise<HTMLImageElement | null> => {
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = src;
    await new Promise((resolve) => {
      img.onload = () => resolve(null);
      img.onerror = () => resolve(null);
      setTimeout(() => resolve(null), 1200);
    });
    return img;
  } catch {
    return null;
  }
};

export async function generateQuoteInvoicePdfBlob(data: QuoteInvoiceData): Promise<Blob> {
  if (!data.invoiceNumber || !data.invoiceDate || data.items.length === 0) {
    throw new Error("Missing required invoice data.");
  }

  const doc = new jsPDF("p", "mm", "a4");
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const bottomMargin = 20;
  const contentMaxY = pageHeight - bottomMargin;
  let y = margin;

  const logo = await loadLogo(quotationInvoiceLogoSrc);
  let logoHeight = 0;
  if (logo && logo.naturalWidth > 0 && logo.naturalHeight > 0) {
    const maxW = 48;
    const maxH = 14;
    const ratio = logo.naturalWidth / logo.naturalHeight;
    let logoW = maxW;
    let logoH = logoW / ratio;
    if (logoH > maxH) {
      logoH = maxH;
      logoW = logoH * ratio;
    }
    doc.addImage(logo, logoFormatForPdf(quotationInvoiceLogoSrc), margin, y, logoW, logoH);
    logoHeight = logoH;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("INVOICE", pageWidth - margin, y + 4, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Invoice #: ${data.invoiceNumber}`, pageWidth - margin, y + 12, { align: "right" });
  doc.text(`Date: ${data.invoiceDate}`, pageWidth - margin, y + 18, { align: "right" });
  if (data.dueDate) {
    doc.text(`Due Date: ${data.dueDate}`, pageWidth - margin, y + 24, { align: "right" });
    y += Math.max(logoHeight + 6, 32);
  } else {
    y += Math.max(logoHeight + 6, 26);
  }
  doc.setDrawColor(232, 193, 132);
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  const sectionGap = 6;
  const colWidth = (pageWidth - margin * 2 - sectionGap) / 2;

  const boxPaddingX = 4;
  const boxPaddingY = 4;
  const lineHeight = 4.5;

  const leftLines = [
    data.company.name,
    data.company.addressLine || "",
    data.company.cityStateZip || "",
    data.company.country || "",
    data.company.phone ? `Phone: ${data.company.phone}` : "",
    data.company.email ? `Email: ${data.company.email}` : "",
  ].filter(Boolean);
  const rightLines = [
    data.soldTo.name,
    data.soldTo.addressLine || "",
    data.soldTo.cityStateZip || "",
    data.soldTo.country || "",
    data.soldTo.phone ? `Phone: ${data.soldTo.phone}` : "",
    data.soldTo.email ? `Email: ${data.soldTo.email}` : "",
  ].filter(Boolean);

  const contentLines = Math.max(leftLines.length, rightLines.length);
  const boxHeight = boxPaddingY * 2 + 5 + contentLines * lineHeight;

  doc.setDrawColor(232, 193, 132);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, y - 2, colWidth, boxHeight, 2, 2);
  doc.roundedRect(margin + colWidth + sectionGap, y - 2, colWidth, boxHeight, 2, 2);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Company Details", margin + boxPaddingX, y + 3);
  doc.text("Sold To", margin + colWidth + sectionGap + boxPaddingX, y + 3);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  let textY = y + 3 + lineHeight;
  for (let i = 0; i < contentLines; i += 1) {
    if (leftLines[i]) doc.text(leftLines[i], margin + boxPaddingX, textY);
    if (rightLines[i]) doc.text(rightLines[i], margin + colWidth + sectionGap + boxPaddingX, textY);
    textY += lineHeight;
  }

  y += boxHeight + 4;
  const noteText =
    (data.invoiceNote || "").trim() ||
    "Please make all payments to Prep Services FBA LLC. All prices are F.O.B.";
  const fobPoint = (data.fobPoint || "").trim() || "NEW JERSEY";
  const shippingTerms = (data.shippingTerms || "").trim() || "NET";
  const shippedVia = (data.shippedVia || "").trim() || "Standard";

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  const noteLines = doc.splitTextToSize(`NOTE: ${noteText}`, pageWidth - margin * 2) as string[];
  doc.text(noteLines, margin, y);
  y += noteLines.length * 4.5 + 2;
  doc.setFont("helvetica", "normal");
  doc.text("FOB POINT:", margin, y);
  doc.text(fobPoint, margin + 32, y);
  y += 4.5;
  doc.text("TERMS:", margin, y);
  doc.text(shippingTerms, margin + 32, y);
  y += 4.5;
  doc.text("SHIPPED VIA:", margin, y);
  doc.text(shippedVia, margin + 32, y);
  y += 6;
  const useDetailTable = data.lineTable === "detail";

  if (useDetailTable) {
    const tableRight = pageWidth - margin;
    const colQty = margin;
    const colProduct = margin + 18;
    const colAmount = tableRight;
    const colUnitPrice = colAmount - 22;
    const colPack = colUnitPrice - 28;
    const colSku = colPack - 24;
    const colDate = colSku - 24;
    const productWidth = Math.max(20, colDate - colProduct - 2);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("QUANTITY", colQty, y);
    doc.text("PRODUCT", colProduct, y);
    doc.text("DATE", colDate, y);
    doc.text("SKU", colSku, y);
    doc.text("PACK", colPack, y);
    doc.text("UNIT PRICE", colUnitPrice, y, { align: "right" });
    doc.text("AMOUNT", colAmount, y, { align: "right" });
    y += 3;
    doc.line(margin, y, pageWidth - margin, y);
    y += 5;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    data.items.forEach((item) => {
      if (y > contentMaxY) {
        doc.addPage();
        y = margin;
      }
      const product = String(item.productName || item.description || "—").trim() || "—";
      const productLines = doc.splitTextToSize(product, productWidth) as string[];
      const shipDate = String(item.shipDate || "").trim();
      const sku = String(item.sku || "").trim();
      const pack = String(item.packaging || "").trim();

      doc.text(String(item.quantity), colQty, y);
      const productFirst = productLines[0] ?? "—";
      const productLink = String(item.descriptionUrl || "").trim();
      if (productLink) {
        doc.setTextColor(37, 99, 235);
        doc.textWithLink(productFirst, colProduct, y, { url: productLink });
        doc.setTextColor(0, 0, 0);
      } else {
        doc.text(productFirst, colProduct, y);
      }
      doc.text(shipDate.substring(0, 12), colDate, y);
      doc.text(sku.substring(0, 12), colSku, y);
      doc.text(pack.substring(0, 12), colPack, y);
      doc.text(`$${item.unitPrice.toFixed(2)}`, colUnitPrice, y, { align: "right" });
      doc.text(`$${item.amount.toFixed(2)}`, colAmount, y, { align: "right" });
      y += 4.5;
      productLines.slice(1).forEach((line: string) => {
        if (y > contentMaxY) {
          doc.addPage();
          y = margin;
        }
        doc.text(line, colProduct, y);
        y += 4.5;
      });
      y += 1.5;
    });
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text("Item Description", margin, y);
    doc.text("Qty", margin + 92, y);
    doc.text("Unit Price", margin + 120, y);
    doc.text("Amount", pageWidth - margin, y, { align: "right" });
    y += 3;
    doc.line(margin, y, pageWidth - margin, y);
    y += 5;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const descriptionWidth = 86;
    data.items.forEach((item) => {
      if (y > contentMaxY) {
        doc.addPage();
        y = margin;
      }
      const desc = item.description || "—";
      const lines = doc.splitTextToSize(desc, descriptionWidth);
      const firstLine = lines[0] ?? "—";
      const linkUrl = String(item.descriptionUrl || "").trim();
      if (linkUrl) {
        doc.setTextColor(37, 99, 235);
        doc.textWithLink(firstLine, margin, y, { url: linkUrl });
        doc.setTextColor(0, 0, 0);
      } else {
        doc.text(firstLine, margin, y);
      }
      doc.text(String(item.quantity), margin + 92, y);
      doc.text(`$${item.unitPrice.toFixed(2)}`, margin + 120, y);
      doc.text(`$${item.amount.toFixed(2)}`, pageWidth - margin, y, { align: "right" });
      y += 5;
      lines.slice(1).forEach((line: string) => {
        if (y > contentMaxY) {
          doc.addPage();
          y = margin;
        }
        doc.text(line, margin, y);
        y += 5;
      });
      y += 2;
    });
  }

  y += 4;
  doc.setFont("helvetica", "bold");
  doc.text(`Subtotal: $${data.subtotal.toFixed(2)}`, pageWidth - margin, y, { align: "right" });
  y += 5;
  doc.text(`Sales Tax: $${data.salesTax.toFixed(2)}`, pageWidth - margin, y, { align: "right" });
  y += 5;
  doc.text(`Shipping: $${data.shippingCost.toFixed(2)}`, pageWidth - margin, y, { align: "right" });
  y += 5;
  if (data.discount != null && data.discount > 0) {
    doc.text(`Discount: -$${data.discount.toFixed(2)}`, pageWidth - margin, y, { align: "right" });
    y += 5;
  }
  if (data.lateFee != null && data.lateFee > 0) {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(220, 38, 38);
    doc.text(`Late Fee: $${data.lateFee.toFixed(2)}`, pageWidth - margin, y, { align: "right" });
    doc.setTextColor(0, 0, 0);
    y += 5;
  }
  y += data.discount != null && data.discount > 0 ? 1 : data.lateFee != null && data.lateFee > 0 ? 1 : 6;
  doc.setFont("helvetica", "bold");
  doc.text(`Grand Total: $${data.total.toFixed(2)}`, pageWidth - margin, y, { align: "right" });

  if (data.terms) {
    y += 10;
    if (y > contentMaxY) {
      doc.addPage();
      y = margin;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Terms & Conditions", margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const bullet = "• ";
    const termWidth = pageWidth - margin * 2;
    const rawLines = data.terms.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    rawLines.forEach((line: string) => {
      const bulletLine = bullet + line.replace(/^\d+\.\s*/, "");
      const wrapped = doc.splitTextToSize(bulletLine, termWidth);
      wrapped.forEach((textLine: string) => {
        if (y > contentMaxY) {
          doc.addPage();
          y = margin;
        }
        doc.text(textLine, margin, y);
        y += 4;
      });
      y += 2;
    });
  }

  y += 10;
  if (y > contentMaxY) {
    doc.addPage();
    y = margin;
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(180, 83, 9);
  doc.text("We appreciate the opportunity to do business with you.", pageWidth / 2, y, {
    align: "center",
  });
  doc.setTextColor(0, 0, 0);

  return doc.output("blob");
}
