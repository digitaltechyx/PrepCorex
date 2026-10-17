/**
 * Utility functions for CSV generation and download
 */

import { reconcileExpiryBatchesToOnHand } from "@/lib/inventory-expiry-batches";

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
    Array.isArray(item.expiryBatches) ? item.expiryBatches : [],
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

/**
 * Convert array of objects to CSV string
 */
export function arrayToCSV<T extends Record<string, any>>(
  data: T[],
  headers: (keyof T)[]
): string {
  if (data.length === 0) return '';
  
  // Create header row
  const headerRow = headers.join(',');
  
  // Create data rows
  const dataRows = data.map(row => 
    headers.map(header => {
      const value = row[header];
      // Escape commas and quotes in values
      if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    }).join(',')
  );
  
  return [headerRow, ...dataRows].join('\n');
}

/**
 * Download CSV file
 */
export function downloadCSV(csvContent: string, filename: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
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
