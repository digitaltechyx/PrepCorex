import type { QuoteInvoiceData, QuoteInvoiceItem } from "@/lib/quote-invoice-generator";
import { generateQuoteInvoicePdfBlob } from "@/lib/quote-invoice-generator";
import { parseCrmStyleInvoiceLine } from "@/lib/invoice-line-parse";

interface User {
  name: string;
  email: string;
  phone?: string;
  address?: string;
}

interface InvoiceData {
  invoiceNumber: string;
  date: string;
  dueDate?: string;
  orderNumber: string;
  soldTo: User;
  fbm: string;
  additionalServices?: {
    bubbleWrapFeet?: number;
    stickerRemovalItems?: number;
    warningLabels?: number;
    pricePerFoot?: number;
    pricePerItem?: number;
    pricePerLabel?: number;
    total?: number;
  };
  items: Array<{
    quantity: number;
    productName: string;
    shipDate?: string;
    packaging: string;
    shipTo: string;
    unitPrice: number;
    amount: number;
    sku?: string;
    description?: string;
    date?: string;
  }>;
  userId?: string;
  status?: "pending" | "paid";
  subtotal?: number;
  grandTotal?: number;
  grossTotal?: number;
  discountType?: "amount" | "percent";
  discountValue?: number;
  discountAmount?: number;
  lateFeeAmount?: number;
  lateFeeReason?: string;
  adminAdditionalCharges?: Array<{ id: string; name: string; amount: number }>;
  type?: string;
  isContainerHandling?: boolean;
  storageType?: string;
  /** Legal Terms & Conditions block (same as CRM). */
  terms?: string;
}

/** Same default Terms & Conditions as CRM invoice PDFs. */
export const DEFAULT_INVOICE_TERMS = [
  "Invoices must be paid in full before work begins unless written credit terms are approved by management.",
  "Unpaid invoices after the due time may incur a $19 late fee per invoice.",
  "Prep Services FBA may pause receiving, prep, storage, and shipments until payment is completed.",
  "All completed labor services are non-refundable.",
  "Client is responsible for product compliance, labeling accuracy, and marketplace requirements.",
  "Any billing concern must be reported within 5 business days of invoice receipt. Unauthorized chargebacks may result in service suspension.",
].join("\n");

const DEFAULT_COMPANY = {
  name: "Prep Services FBA",
  addressLine: "7000 Atrium Way C03",
  cityStateZip: "Mount Laurel, NJ, 08054",
  country: "United States",
  phone: "+1-347-661-3010",
  email: "info@prepservicesfba.com",
};

function formatInvoiceDate(raw: string | undefined): string {
  if (!raw) return "";
  const dueMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw).trim());
  if (dueMatch) {
    return `${dueMatch[3]}/${dueMatch[2]}/${dueMatch[1]}`;
  }
  try {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      const dd = String(d.getDate()).padStart(2, "0");
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const yyyy = d.getFullYear();
      return `${dd}/${mm}/${yyyy}`;
    }
  } catch {
    /* keep raw */
  }
  return raw;
}

function formatStorageDate(dateValue: string): string {
  if (dateValue.match(/^\d{4}-\d{2}$/)) {
    const [year, month] = dateValue.split("-");
    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const monthIndex = parseInt(month, 10) - 1;
    return `${monthNames[monthIndex] || month} ${year}`;
  }
  return dateValue;
}

function normalizeDetailLine(item: InvoiceData["items"][number], isStorage: boolean): QuoteInvoiceItem {
  const raw = String(item.productName || item.description || "").trim();
  const parsed = parseCrmStyleInvoiceLine(raw);

  const productName = parsed.productName || raw || "Item";
  // Prefer ship date embedded in CRM description; fall back to stored shipDate/date.
  let shipDate =
    parsed.shipDate ||
    String(item.shipDate || item.date || "").trim();

  if (isStorage) {
    shipDate = formatStorageDate(shipDate);
  }

  const sku = parsed.sku || String(item.sku || "").trim();
  const packaging =
    parsed.packaging || String(item.packaging || "").trim();

  const quantity = Number(item.quantity || 0);
  const unitPrice = Number(item.unitPrice || 0);
  const amount = Number(item.amount || 0);

  return {
    description: productName,
    productName,
    shipDate,
    sku,
    packaging,
    quantity,
    unitPrice,
    amount,
  };
}

function mapInvoiceDataToQuote(data: InvoiceData): QuoteInvoiceData {
  if (!data.invoiceNumber || !data.date || !data.items || data.items.length === 0) {
    throw new Error("Missing required invoice data: invoiceNumber, date, or items");
  }

  const isStorageInvoice = data.type === "storage";
  const items: QuoteInvoiceItem[] = data.items.map((item) =>
    normalizeDetailLine(item, isStorageInvoice)
  );

  const descriptionHay = items.map((i) => i.productName || i.description).join("\n").toLowerCase();
  const hasDesc = (label: string) => descriptionHay.includes(label.toLowerCase());

  const add = data.additionalServices;
  if (add) {
    if (
      !hasDesc("bubble wrap") &&
      (add.bubbleWrapFeet || 0) > 0 &&
      (add.pricePerFoot || 0) > 0
    ) {
      const qty = add.bubbleWrapFeet || 0;
      const price = add.pricePerFoot || 0;
      items.push({
        description: "Bubble Wrap",
        productName: "Bubble Wrap",
        packaging: "Service",
        quantity: qty,
        unitPrice: price,
        amount: qty * price,
      });
    }
    if (
      !hasDesc("sticker removal") &&
      (add.stickerRemovalItems || 0) > 0 &&
      (add.pricePerItem || 0) > 0
    ) {
      const qty = add.stickerRemovalItems || 0;
      const price = add.pricePerItem || 0;
      items.push({
        description: "Sticker Removal",
        productName: "Sticker Removal",
        packaging: "Service",
        quantity: qty,
        unitPrice: price,
        amount: qty * price,
      });
    }
    if (
      !hasDesc("warning label") &&
      (add.warningLabels || 0) > 0 &&
      (add.pricePerLabel || 0) > 0
    ) {
      const qty = add.warningLabels || 0;
      const price = add.pricePerLabel || 0;
      items.push({
        description: "Warning Labels",
        productName: "Warning Labels",
        packaging: "Service",
        quantity: qty,
        unitPrice: price,
        amount: qty * price,
      });
    }
  }

  for (const charge of data.adminAdditionalCharges ?? []) {
    const amount = Number(charge.amount) || 0;
    if (Math.abs(amount) < 0.0001) continue;
    const name = String(charge.name || "Additional charge");
    if (hasDesc(name)) continue;
    items.push({
      description: name,
      productName: name,
      packaging: "Service",
      quantity: 1,
      unitPrice: amount,
      amount,
    });
  }

  const itemsSubtotal = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);

  const storedDiscountAmount =
    typeof data.discountAmount === "number" ? data.discountAmount : undefined;
  const discountType = data.discountType;
  const discountValue = typeof data.discountValue === "number" ? data.discountValue : undefined;

  let discountAmount = 0;
  if (typeof storedDiscountAmount === "number") {
    discountAmount = storedDiscountAmount;
  } else if (discountType === "percent" && typeof discountValue === "number") {
    discountAmount = itemsSubtotal * (discountValue / 100);
  } else if (discountType === "amount" && typeof discountValue === "number") {
    discountAmount = discountValue;
  }
  discountAmount = Math.max(0, Math.min(itemsSubtotal, discountAmount || 0));
  const lateFeeAmount = Math.max(0, Number(data.lateFeeAmount || 0));

  const finalTotal =
    typeof data.grandTotal === "number"
      ? data.grandTotal
      : Math.max(0, itemsSubtotal - discountAmount + lateFeeAmount);

  const soldToName = String(data.soldTo?.name || "").trim() || "Customer";
  const soldToAddress = String(data.soldTo?.address || "").trim();

  return {
    invoiceNumber: data.invoiceNumber,
    invoiceDate: formatInvoiceDate(data.date),
    dueDate: data.dueDate ? formatInvoiceDate(data.dueDate) : undefined,
    company: { ...DEFAULT_COMPANY },
    soldTo: {
      name: soldToName,
      email: data.soldTo?.email || undefined,
      phone: data.soldTo?.phone || undefined,
      addressLine: soldToAddress || undefined,
    },
    items,
    subtotal: typeof data.subtotal === "number" ? data.subtotal : itemsSubtotal,
    salesTax: 0,
    shippingCost: 0,
    discount: discountAmount > 0 ? discountAmount : undefined,
    lateFee: lateFeeAmount > 0 ? lateFeeAmount : undefined,
    total: finalTotal,
    lineTable: "detail",
    terms: String(data.terms || "").trim() || DEFAULT_INVOICE_TERMS,
    invoiceNote:
      "Please make all payments to Prep Services FBA LLC. All prices are F.O.B. NJ Sales Tax 6.625% — Excluded.",
    fobPoint: "NEW JERSEY",
    shippingTerms: "NET",
    shippedVia: "Standard",
  };
}

function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function generateInvoicePDF(data: InvoiceData): Promise<void> {
  try {
    const blob = await generateInvoicePDFBlob(data);
    triggerBlobDownload(blob, `Invoice-${data.invoiceNumber}.pdf`);
  } catch (error) {
    console.error("Error generating invoice PDF:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    throw new Error(`Failed to generate PDF: ${errorMessage}`);
  }
}

export async function generateInvoicePDFBlob(data: InvoiceData): Promise<Blob> {
  return generateQuoteInvoicePdfBlob(mapInvoiceDataToQuote(data));
}

export { generateInvoiceNumber } from "./invoice-utils";
