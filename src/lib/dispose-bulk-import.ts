import type { DisposeInventoryStockStatus, InventoryItem } from "@/types";
import { downloadCSV } from "@/lib/csv-utils";

export const DISPOSE_BULK_CSV_HEADERS = [
  "Product ID",
  "SKU",
  "Product Name",
  "Current Quantity",
  "Stock Status",
  "Expiry Date",
  "Dispose Quantity",
  "Reason",
] as const;

export type DisposeBulkCsvRow = Record<(typeof DISPOSE_BULK_CSV_HEADERS)[number], string>;

export type DisposeBulkValidatedRow = {
  rowNumber: number;
  productId: string;
  productName: string;
  sku: string;
  currentQuantity: number;
  stockStatus: DisposeInventoryStockStatus;
  expiryDate?: InventoryItem["expiryDate"];
  disposeQuantity: number;
  reason?: string;
};

export type DisposeBulkRowError = {
  rowNumber: number;
  message: string;
};

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function escapeCsvCell(v: string): string {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function formatExpiryForCsv(expiryDate: InventoryItem["expiryDate"] | undefined): string {
  if (!expiryDate) return "";
  if (typeof expiryDate === "string") {
    const d = new Date(expiryDate);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  }
  if (expiryDate instanceof Date) {
    return Number.isNaN(expiryDate.getTime()) ? "" : expiryDate.toISOString().slice(0, 10);
  }
  if (typeof expiryDate === "object" && expiryDate !== null && "seconds" in expiryDate) {
    const sec = Number((expiryDate as { seconds?: unknown }).seconds);
    return Number.isFinite(sec) ? new Date(sec * 1000).toISOString().slice(0, 10) : "";
  }
  return "";
}

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function expiryToMs(expiryDate: InventoryItem["expiryDate"] | undefined): number | null {
  if (!expiryDate) return null;
  if (typeof expiryDate === "string") {
    const d = new Date(`${expiryDate.trim().slice(0, 10)}T12:00:00`);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  if (expiryDate instanceof Date) {
    return Number.isNaN(expiryDate.getTime()) ? null : expiryDate.getTime();
  }
  if (typeof expiryDate === "object" && expiryDate !== null && "seconds" in expiryDate) {
    const sec = Number((expiryDate as { seconds?: unknown }).seconds);
    return Number.isFinite(sec) ? sec * 1000 : null;
  }
  return null;
}

/** Eligible for dispose template: any sellable row with quantity > 0 (in stock, low stock, expired). */
export function isDisposeTemplateEligible(item: InventoryItem): boolean {
  return Number(item.quantity) > 0;
}

export function getDisposeInventoryStockStatus(item: InventoryItem): DisposeInventoryStockStatus {
  const expiryMs = expiryToMs((item as InventoryItem & { expiryDate?: InventoryItem["expiryDate"] }).expiryDate);
  if (expiryMs !== null && expiryMs < startOfTodayMs()) {
    return "Expired";
  }
  const qty = Number(item.quantity) || 0;
  if (qty > 0 && qty <= 10) return "Low Stock";
  return "In Stock";
}

export function downloadDisposeBulkTemplate(inventory: InventoryItem[]): void {
  const eligible = inventory
    .filter(isDisposeTemplateEligible)
    .sort((a, b) => String(a.productName || "").localeCompare(String(b.productName || "")));

  const lines = [
    DISPOSE_BULK_CSV_HEADERS.join(","),
    ...eligible.map((item) => {
      const sku = String(item.sku ?? "").trim();
      const row: DisposeBulkCsvRow = {
        "Product ID": item.id,
        SKU: sku,
        "Product Name": item.productName,
        "Current Quantity": String(item.quantity),
        "Stock Status": getDisposeInventoryStockStatus(item),
        "Expiry Date": formatExpiryForCsv((item as InventoryItem & { expiryDate?: InventoryItem["expiryDate"] }).expiryDate),
        "Dispose Quantity": "",
        Reason: "",
      };
      return DISPOSE_BULK_CSV_HEADERS.map((h) => escapeCsvCell(row[h])).join(",");
    }),
  ];

  downloadCSV("\uFEFF" + lines.join("\n"), "dispose-inventory-template.csv");
}

export function parseDisposeBulkCsv(text: string): {
  rows: DisposeBulkCsvRow[];
  errors: string[];
} {
  const errors: string[] = [];
  const clean = text.replace(/^\uFEFF/, "").trim();
  if (!clean) return { rows: [], errors: ["File is empty."] };

  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { rows: [], errors: ["CSV must include a header row and at least one data row."] };
  }

  const headerCells = parseCsvLine(lines[0]);
  const headerIndex = new Map<string, number>();
  headerCells.forEach((cell, idx) => headerIndex.set(normHeader(cell), idx));

  for (const required of DISPOSE_BULK_CSV_HEADERS) {
    if (!headerIndex.has(normHeader(required))) {
      errors.push(`Missing required column: "${required}".`);
    }
  }
  if (errors.length > 0) return { rows: [], errors };

  const rows: DisposeBulkCsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const row = {} as DisposeBulkCsvRow;
    for (const header of DISPOSE_BULK_CSV_HEADERS) {
      const idx = headerIndex.get(normHeader(header))!;
      row[header] = (cells[idx] ?? "").trim();
    }
    if (DISPOSE_BULK_CSV_HEADERS.every((h) => !row[h])) continue;
    rows.push(row);
  }

  if (rows.length === 0) errors.push("No data rows found.");
  return { rows, errors };
}

export function validateDisposeBulkRows(
  csvRows: DisposeBulkCsvRow[],
  context: {
    inventory: InventoryItem[];
    batchReason: string;
  }
): { valid: DisposeBulkValidatedRow[]; errors: DisposeBulkRowError[]; warnings: DisposeBulkRowError[] } {
  const errors: DisposeBulkRowError[] = [];
  const warnings: DisposeBulkRowError[] = [];
  const valid: DisposeBulkValidatedRow[] = [];

  const inventoryById = new Map<string, InventoryItem>();
  for (const item of context.inventory) {
    if (!isDisposeTemplateEligible(item)) continue;
    inventoryById.set(item.id, item);
  }

  const disposeDemandByProduct = new Map<string, number>();

  csvRows.forEach((raw, index) => {
    const rowNumber = index + 2;
    const disposeRaw = raw["Dispose Quantity"].trim();
    if (!disposeRaw) return;

    const disposeQuantity = Number.parseInt(disposeRaw, 10);
    if (Number.isNaN(disposeQuantity) || disposeQuantity <= 0) {
      errors.push({
        rowNumber,
        message: "Dispose Quantity must be a positive whole number when provided.",
      });
      return;
    }

    const productId = raw["Product ID"].trim();
    if (!productId) {
      errors.push({ rowNumber, message: "Product ID is required." });
      return;
    }

    const product = inventoryById.get(productId);
    if (!product) {
      errors.push({
        rowNumber,
        message: `Product "${raw["Product Name"].trim() || productId}" is not in stock or was removed.`,
      });
      return;
    }

    const csvCurrentQty = Number.parseInt(raw["Current Quantity"].trim(), 10);
    const liveQty = Number(product.quantity) || 0;
    if (Number.isFinite(csvCurrentQty) && csvCurrentQty !== liveQty) {
      warnings.push({
        rowNumber,
        message: `Current Quantity in file (${csvCurrentQty}) differs from live stock (${liveQty}). Using live quantity.`,
      });
    }

    const alreadyRequested = disposeDemandByProduct.get(productId) ?? 0;
    const totalRequested = alreadyRequested + disposeQuantity;
    if (totalRequested > liveQty) {
      errors.push({
        rowNumber,
        message: `Insufficient stock for "${product.productName}": requested ${totalRequested}, available ${liveQty}.`,
      });
      return;
    }
    disposeDemandByProduct.set(productId, totalRequested);

    const lineReason = raw.Reason.trim();
    const reason = lineReason || context.batchReason.trim() || undefined;
    if (!reason) {
      errors.push({
        rowNumber,
        message: "Provide a Reason on this row or a batch reason before submitting.",
      });
      return;
    }

    valid.push({
      rowNumber,
      productId: product.id,
      productName: product.productName,
      sku: String(product.sku ?? raw.SKU.trim()),
      currentQuantity: liveQty,
      stockStatus: getDisposeInventoryStockStatus(product),
      expiryDate: (product as InventoryItem & { expiryDate?: InventoryItem["expiryDate"] }).expiryDate,
      disposeQuantity,
      reason,
    });
  });

  if (valid.length === 0 && errors.length === 0) {
    errors.push("Add Dispose Quantity on at least one row before submitting.");
  }

  return { valid, errors, warnings };
}
