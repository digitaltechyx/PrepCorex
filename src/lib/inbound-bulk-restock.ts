import type { InventoryItem } from "@/types";
import { downloadCSV } from "@/lib/csv-utils";
import type { InboundBulkRowError, InboundBulkValidatedRow } from "@/lib/inbound-bulk-import";

export const RESTOCK_BULK_CSV_HEADERS = [
  "SKU",
  "Product Name",
  "Quantity",
  "Remarks",
  "Tracking Number",
  "Carrier",
] as const;

export type RestockBulkCsvRow = Record<(typeof RESTOCK_BULK_CSV_HEADERS)[number], string>;

type RestockProduct = InventoryItem & { sku?: string; imageUrl?: string; imageUrls?: string[] };

/** Same eligibility as manual restock dropdown in Add Inventory Request. */
export function isRestockEligibleProduct(item: InventoryItem): boolean {
  const inventoryType = (item as InventoryItem & { inventoryType?: string }).inventoryType;
  if (inventoryType === "box" || inventoryType === "container" || inventoryType === "pallet") {
    return false;
  }
  return item.status === "In Stock" || item.status === "Out of Stock";
}

export function filterRestockEligibleProducts(inventory: InventoryItem[]): RestockProduct[] {
  return inventory.filter(isRestockEligibleProduct) as RestockProduct[];
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

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

function extractImageUrls(item: Partial<InventoryItem> & { imageUrl?: string; imageUrls?: string[] }) {
  if (Array.isArray(item.imageUrls) && item.imageUrls.length > 0) return item.imageUrls;
  if (item.imageUrl && typeof item.imageUrl === "string") return [item.imageUrl];
  return [];
}

export function downloadRestockBulkTemplate(inventory: InventoryItem[]): void {
  const products = filterRestockEligibleProducts(inventory)
    .filter((item) => String(item.sku ?? "").trim())
    .sort((a, b) => String(a.sku).localeCompare(String(b.sku), undefined, { sensitivity: "base" }));

  const rows: RestockBulkCsvRow[] = products.map((item) => ({
    SKU: String(item.sku).trim(),
    "Product Name": item.productName ?? "",
    Quantity: "",
    Remarks: "",
    "Tracking Number": "",
    Carrier: "",
  }));

  if (rows.length === 0) {
    rows.push({
      SKU: "YOUR-SKU",
      "Product Name": "Example product (replace with your catalog row)",
      Quantity: "10",
      Remarks: "",
      "Tracking Number": "",
      Carrier: "",
    });
  }

  const header = RESTOCK_BULK_CSV_HEADERS.join(",");
  const body = rows
    .map((row) =>
      RESTOCK_BULK_CSV_HEADERS.map((h) => {
        const v = row[h] ?? "";
        if (v.includes(",") || v.includes('"') || v.includes("\n")) {
          return `"${v.replace(/"/g, '""')}"`;
        }
        return v;
      }).join(",")
    )
    .join("\n");

  downloadCSV(`\uFEFF${header}\n${body}`, "inbound-restock-bulk-template.csv");
}

export function parseRestockBulkCsv(text: string): {
  rows: RestockBulkCsvRow[];
  errors: string[];
} {
  const errors: string[] = [];
  const clean = text.replace(/^\uFEFF/, "").trim();
  if (!clean) {
    return { rows: [], errors: ["File is empty."] };
  }

  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { rows: [], errors: ["CSV must include a header row and at least one data row."] };
  }

  const headerCells = parseCsvLine(lines[0]);
  const headerMap = new Map<string, number>();
  headerCells.forEach((h, i) => headerMap.set(normHeader(h), i));

  const required = ["sku", "quantity"];
  for (const req of required) {
    if (!headerMap.has(req)) {
      errors.push(`Missing required column: ${req === "sku" ? "SKU" : "Quantity"}.`);
    }
  }
  if (errors.length > 0) return { rows: [], errors };

  const rows: RestockBulkCsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const get = (name: string) => {
      const idx = headerMap.get(normHeader(name));
      return idx === undefined ? "" : (cells[idx] ?? "");
    };
    rows.push({
      SKU: get("SKU"),
      "Product Name": get("Product Name"),
      Quantity: get("Quantity"),
      Remarks: get("Remarks"),
      "Tracking Number": get("Tracking Number"),
      Carrier: get("Carrier"),
    });
  }

  return { rows, errors };
}

export function validateRestockBulkRows(
  csvRows: RestockBulkCsvRow[],
  inventory: InventoryItem[]
): { valid: InboundBulkValidatedRow[]; errors: InboundBulkRowError[]; skippedEmpty: number } {
  const errors: InboundBulkRowError[] = [];
  const valid: InboundBulkValidatedRow[] = [];
  let skippedEmpty = 0;

  const inventoryBySku = new Map<string, RestockProduct>();
  for (const item of filterRestockEligibleProducts(inventory)) {
    const sku = String(item.sku ?? "").trim();
    if (sku) inventoryBySku.set(sku.toLowerCase(), item);
  }

  const usedSkusInFile = new Set<string>();

  csvRows.forEach((raw, index) => {
    const rowNumber = index + 2;
    const sku = raw.SKU.trim();
    const qtyRaw = raw.Quantity.trim();

    if (!qtyRaw) {
      skippedEmpty += 1;
      return;
    }

    const quantity = Number.parseInt(qtyRaw, 10);
    if (Number.isNaN(quantity) || quantity <= 0) {
      errors.push({
        rowNumber,
        message: "Quantity must be a positive whole number when provided.",
      });
      return;
    }

    if (!sku) {
      errors.push({ rowNumber, message: "SKU is required when Quantity is filled." });
      return;
    }

    const skuKey = sku.toLowerCase();
    if (usedSkusInFile.has(skuKey)) {
      errors.push({ rowNumber, message: `Duplicate SKU "${sku}" in file.` });
      return;
    }
    usedSkusInFile.add(skuKey);

    const product = inventoryBySku.get(skuKey);
    if (!product) {
      errors.push({
        rowNumber,
        message: `No restock-eligible product found for SKU "${sku}". Use the downloaded template SKUs only.`,
      });
      return;
    }

    const imageUrls = extractImageUrls(product);
    const remarks = raw.Remarks.trim();
    const trackingNumber = raw["Tracking Number"].trim();
    const carrier = raw.Carrier.trim();

    valid.push({
      rowNumber,
      inventoryType: "product",
      productSubType: "restock",
      productName: product.productName,
      sku,
      quantity,
      productId: product.id,
      imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
      remarks: remarks || undefined,
      trackingNumber: trackingNumber || undefined,
      carrier: carrier || undefined,
    });
  });

  return { valid, errors, skippedEmpty };
}
