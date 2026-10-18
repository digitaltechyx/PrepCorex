/**
 * Utility functions for CSV generation and download
 */

import {
  reconcileExpiryBatchesToOnHand,
  type ExpiryBatch,
} from "@/lib/inventory-expiry-batches";

export interface InventoryCSVRow {
  'Product Name': string;
  'SKU': string;
  'Quantity': number;
  'Status': string;
  'Expiry Lots': string;
  'Date Added': string;
}

/** Warehouse inventory CSV columns (excludes marketplace / Other Resources rows). */
export const INVENTORY_CSV_HEADERS: (keyof InventoryCSVRow)[] = [
  "Product Name",
  "SKU",
  "Quantity",
  "Status",
  "Expiry Lots",
  "Date Added",
];

/** Single-sheet inventory export: one product row, full history in one cell. */
export interface InventoryWithHistoryCSVRow extends InventoryCSVRow {
  History: string;
}

export const INVENTORY_WITH_HISTORY_CSV_HEADERS: (keyof InventoryWithHistoryCSVRow)[] = [
  "Product Name",
  "SKU",
  "Quantity",
  "Status",
  "Expiry Lots",
  "Date Added",
  "History",
];

/**
 * Format FEFO expiry lots for CSV, e.g. "2026-10-31 (135); 2026-11-01 (10)".
 * Falls back to a single expiryDate when batches are missing.
 */
export function formatInventoryExpiryLotsForCsv(item: {
  quantity?: unknown;
  expiryDate?: unknown;
  expiryBatches?: Array<{ expiry?: string; quantity?: number }> | null;
}): string {
  const onHand = Math.max(0, Math.floor(Number(item.quantity) || 0));
  const { batches } = reconcileExpiryBatchesToOnHand(
    Array.isArray(item.expiryBatches) ? (item.expiryBatches as ExpiryBatch[]) : [],
    onHand,
    item.expiryDate,
    "fefo"
  );
  if (batches.length === 0) return "";
  return batches
    .map((b) => `${b.expiry} (${Math.max(0, Math.floor(Number(b.quantity) || 0))})`)
    .join("; ");
}

export interface ShippedCSVRow {
  'Product Name': string;
  'Shipped Quantity': number;
  'Pack Of': number;
  'Date Shipped': string;
  'Remarks': string;
}

/** RFC 4180 / Excel-safe field quoting (always quote strings). */
export function csvEscapeField(value: unknown): string {
  const s = value == null ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Excel-advanced multiline cell without raw newlines in the CSV file.
 * Opens as a formula that joins lines with CHAR(10) so Wrap Text shows history
 * while keeping one physical CSV row per product (avoids broken columns).
 */
export function excelMultilineCsvFormula(lines: string[]): string {
  const parts = lines
    .map((line) => String(line ?? "").replace(/\r\n/g, " ").replace(/[\r\n]+/g, " ").trim())
    .filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `=${parts.map((line) => `"${line.replace(/"/g, '""')}"`).join("&CHAR(10)&")}`;
}

/**
 * Convert array of objects to CSV string (CRLF, always-quoted fields for Excel).
 */
export function arrayToCSV<T extends Record<string, any>>(
  data: T[],
  headers: (keyof T)[]
): string {
  if (data.length === 0) return "";

  const headerRow = headers.map((h) => csvEscapeField(String(h))).join(",");
  const dataRows = data.map((row) =>
    headers.map((header) => csvEscapeField(row[header])).join(",")
  );

  return [headerRow, ...dataRows].join("\r\n");
}

/**
 * Download CSV file (UTF-8 BOM so Excel keeps Unicode + formulas).
 */
export function downloadCSV(csvContent: string, filename: string): void {
  const withBom = csvContent.startsWith("\uFEFF") ? csvContent : `\uFEFF${csvContent}`;
  const blob = new Blob([withBom], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");

  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

/**
 * Format date for CSV export
 */
export function formatDateForCSV(date: any): string {
  if (!date) return 'N/A';
  
  try {
    let dateObj: Date;
    
    // Handle Firestore timestamp
    if (date && typeof date === 'object' && date.seconds) {
      dateObj = new Date(date.seconds * 1000);
    }
    // Handle regular Date object
    else if (date instanceof Date) {
      dateObj = date;
    }
    // Handle string or number
    else {
      dateObj = new Date(date);
    }
    
    // Check if the date is valid
    if (isNaN(dateObj.getTime())) {
      return 'N/A';
    }
    
    return dateObj.toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (error) {
    return 'N/A';
  }
}
