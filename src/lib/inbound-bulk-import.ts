import { Timestamp } from "firebase/firestore";
import type { InventoryItem, InventoryRequest } from "@/types";
import { downloadCSV } from "@/lib/csv-utils";

export const INBOUND_BULK_CSV_HEADERS = [
  "Inventory Type",
  "Product Sub Type",
  "Entry Mode",
  "Product Name",
  "SKU",
  "Color",
  "Size",
  "Quantity",
  "Container Size",
  "Retail Identifier",
  "Expiry Date",
  "Remarks",
  "Tracking Number",
  "Carrier",
] as const;

export type InboundBulkCsvRow = Record<(typeof INBOUND_BULK_CSV_HEADERS)[number], string>;

export type InboundBulkValidatedRow = {
  rowNumber: number;
  inventoryType: "product" | "box" | "pallet" | "container";
  productSubType?: "new" | "restock";
  productEntryMode?: "single" | "variants";
  productName: string;
  sku?: string;
  color?: string;
  size?: string;
  quantity: number;
  containerSize?: "20 feet" | "40 feet";
  retailIdentifier?: string;
  expiryDate?: Timestamp;
  remarks?: string;
  trackingNumber?: string;
  carrier?: string;
  productId?: string;
  imageUrls?: string[];
  parentProductName?: string;
  variantLabel?: string;
};

export type InboundBulkRowError = {
  rowNumber: number;
  message: string;
};

type RestockProduct = InventoryItem & { sku?: string; imageUrl?: string; imageUrls?: string[] };

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeInventoryType(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
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

/** Parse CSV text into row objects keyed by template headers. */
export function parseInboundBulkCsv(text: string): {
  rows: InboundBulkCsvRow[];
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
  const headerIndex = new Map<string, number>();
  headerCells.forEach((cell, idx) => {
    headerIndex.set(normHeader(cell), idx);
  });

  for (const required of INBOUND_BULK_CSV_HEADERS) {
    if (!headerIndex.has(normHeader(required))) {
      errors.push(`Missing required column: "${required}".`);
    }
  }
  if (errors.length > 0) return { rows: [], errors };

  const rows: InboundBulkCsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const row = {} as InboundBulkCsvRow;
    for (const header of INBOUND_BULK_CSV_HEADERS) {
      const idx = headerIndex.get(normHeader(header))!;
      row[header] = (cells[idx] ?? "").trim();
    }
    const allEmpty = INBOUND_BULK_CSV_HEADERS.every((h) => !row[h]);
    if (allEmpty) continue;
    rows.push(row);
  }

  if (rows.length === 0) {
    errors.push("No data rows found.");
  }

  return { rows, errors };
}

export function buildVariantSku(baseSku: string, color: string, size: string): string {
  const sanitize = (v: string) =>
    v
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "-")
      .replace(/[^A-Z0-9-]/g, "");
  return `${sanitize(baseSku)}-${sanitize(color)}-${sanitize(size)}`;
}

export function generateStorageUnitId(
  inventoryType: "box" | "pallet" | "container",
  ownerName: string,
  existingIds: Set<string>
): string {
  const nameParts = ownerName.trim() ? ownerName.trim().split(/\s+/) : [];
  const firstName = nameParts[0] || "U";
  const lastName = nameParts[nameParts.length - 1] || "X";
  const initials = `${firstName.charAt(0).toUpperCase()}${lastName.charAt(0).toUpperCase()}`;
  const typePrefix = inventoryType.toUpperCase();
  let attempts = 0;
  let newId: string;
  do {
    const randomNumber = Math.floor(1000 + Math.random() * 9000);
    newId = `${initials}-${typePrefix}-${randomNumber}`;
    attempts++;
  } while (existingIds.has(newId) && attempts < 100);
  if (attempts >= 100) {
    newId = `${initials}-${typePrefix}-${Date.now().toString().slice(-4)}`;
  }
  existingIds.add(newId);
  return newId;
}

function parseExpiry(raw: string): Timestamp | undefined | "invalid" {
  if (!raw.trim()) return undefined;
  const d = new Date(`${raw.trim()}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "invalid";
  return Timestamp.fromDate(d);
}

function extractImageUrls(item: Partial<InventoryItem> & { imageUrl?: string; imageUrls?: string[] }) {
  if (Array.isArray(item.imageUrls) && item.imageUrls.length > 0) return item.imageUrls;
  if (item.imageUrl && typeof item.imageUrl === "string") return [item.imageUrl];
  return [];
}

function isRestockEligible(item: InventoryItem): boolean {
  const inventoryType = (item as InventoryItem & { inventoryType?: string }).inventoryType;
  if (inventoryType === "box" || inventoryType === "container" || inventoryType === "pallet") {
    return false;
  }
  return item.status === "In Stock" || item.status === "Out of Stock";
}

function normalizeContainerSize(raw: string): "20 feet" | "40 feet" | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v === "20 feet" || v === "20ft" || v === "20") return "20 feet";
  if (v === "40 feet" || v === "40ft" || v === "40") return "40 feet";
  return null;
}

export function validateInboundBulkRows(
  csvRows: InboundBulkCsvRow[],
  context: {
    ownerName: string;
    inventory: InventoryItem[];
    requests: InventoryRequest[];
    existingStorageNames: Set<string>;
  }
): { valid: InboundBulkValidatedRow[]; errors: InboundBulkRowError[] } {
  const errors: InboundBulkRowError[] = [];
  const valid: InboundBulkValidatedRow[] = [];

  const inventoryBySku = new Map<string, RestockProduct>();
  for (const item of context.inventory) {
    const sku = String((item as RestockProduct).sku ?? "").trim();
    if (sku) inventoryBySku.set(sku.toLowerCase(), item as RestockProduct);
  }

  const pendingSkus = new Set<string>();
  const pendingRetailIds = new Set<string>();
  for (const req of context.requests) {
    if ((req.status ?? "pending") !== "pending") continue;
    const sku = String(req.sku ?? "").trim();
    if (sku) pendingSkus.add(sku.toLowerCase());
    const rid = String(req.retailIdentifier ?? "").trim();
    if (rid) pendingRetailIds.add(rid.toLowerCase());
  }

  const inventorySkus = new Set<string>();
  const inventoryRetailIds = new Set<string>();
  for (const item of context.inventory) {
    const sku = String((item as RestockProduct).sku ?? "").trim();
    if (sku) inventorySkus.add(sku.toLowerCase());
    const rid = String((item as InventoryItem & { retailIdentifier?: string }).retailIdentifier ?? "").trim();
    if (rid) inventoryRetailIds.add(rid.toLowerCase());
  }

  const usedSkusInFile = new Set<string>();
  const usedRetailInFile = new Set<string>();
  const usedStorageNames = new Set(context.existingStorageNames);

  csvRows.forEach((raw, index) => {
    const rowNumber = index + 2;
    const inventoryTypeRaw = normalizeInventoryType(raw["Inventory Type"]);
    const inventoryType =
      inventoryTypeRaw === "product" ||
      inventoryTypeRaw === "box" ||
      inventoryTypeRaw === "pallet" ||
      inventoryTypeRaw === "container"
        ? inventoryTypeRaw
        : null;

    if (!inventoryType) {
      errors.push({
        rowNumber,
        message: `Invalid Inventory Type "${raw["Inventory Type"]}". Use product, box, pallet, or container.`,
      });
      return;
    }

    const qtyRaw = raw["Quantity"].trim();
    const quantity = Number.parseInt(qtyRaw, 10);
    if (!qtyRaw || Number.isNaN(quantity) || quantity <= 0) {
      errors.push({ rowNumber, message: "Quantity must be a positive whole number." });
      return;
    }

    const remarks = raw["Remarks"].trim() || undefined;
    const retailIdentifier = raw["Retail Identifier"].trim() || undefined;
    const trackingNumber = raw["Tracking Number"].trim() || undefined;
    const carrier = raw["Carrier"].trim() || undefined;

    if (inventoryType === "product") {
      const subTypeRaw = raw["Product Sub Type"].trim().toLowerCase();
      if (subTypeRaw !== "new" && subTypeRaw !== "restock") {
        errors.push({
          rowNumber,
          message: 'Product Sub Type must be "new" or "restock" for product rows.',
        });
        return;
      }

      if (subTypeRaw === "restock") {
        const sku = raw["SKU"].trim();
        if (!sku) {
          errors.push({ rowNumber, message: "SKU is required for restock rows." });
          return;
        }
        const product = inventoryBySku.get(sku.toLowerCase());
        if (!product || !isRestockEligible(product)) {
          errors.push({
            rowNumber,
            message: `No restock-eligible product found for SKU "${sku}".`,
          });
          return;
        }
        const imageUrls = extractImageUrls(product);
        valid.push({
          rowNumber,
          inventoryType: "product",
          productSubType: "restock",
          productName: product.productName,
          sku,
          quantity,
          productId: product.id,
          imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
          remarks,
          trackingNumber,
          carrier,
        });
        return;
      }

      // new product
      const entryModeRaw = (raw["Entry Mode"].trim().toLowerCase() || "single") as string;
      if (entryModeRaw !== "single" && entryModeRaw !== "variants") {
        errors.push({
          rowNumber,
          message: 'Entry Mode must be "single" or "variants" for new products.',
        });
        return;
      }

      const productName = raw["Product Name"].trim();
      if (!productName) {
        errors.push({ rowNumber, message: "Product Name is required for new products." });
        return;
      }

      const expiryParsed = parseExpiry(raw["Expiry Date"]);
      if (expiryParsed === "invalid") {
        errors.push({ rowNumber, message: "Expiry Date must be YYYY-MM-DD when provided." });
        return;
      }

      if (entryModeRaw === "single") {
        const sku = raw["SKU"].trim();
        if (!sku) {
          errors.push({ rowNumber, message: "SKU is required for new single products." });
          return;
        }
        const skuKey = sku.toLowerCase();
        if (inventorySkus.has(skuKey)) {
          errors.push({ rowNumber, message: `SKU "${sku}" already exists in your inventory.` });
          return;
        }
        if (pendingSkus.has(skuKey)) {
          errors.push({ rowNumber, message: `SKU "${sku}" is already in a pending request.` });
          return;
        }
        if (usedSkusInFile.has(skuKey)) {
          errors.push({ rowNumber, message: `Duplicate SKU "${sku}" in this file.` });
          return;
        }
        usedSkusInFile.add(skuKey);

        if (retailIdentifier) {
          const ridKey = retailIdentifier.toLowerCase();
          if (inventoryRetailIds.has(ridKey)) {
            errors.push({
              rowNumber,
              message: `Identifier "${retailIdentifier}" already exists in inventory.`,
            });
            return;
          }
          if (pendingRetailIds.has(ridKey)) {
            errors.push({
              rowNumber,
              message: `Identifier "${retailIdentifier}" is already in a pending request.`,
            });
            return;
          }
          if (usedRetailInFile.has(ridKey)) {
            errors.push({
              rowNumber,
              message: `Duplicate identifier "${retailIdentifier}" in this file.`,
            });
            return;
          }
          usedRetailInFile.add(ridKey);
        }

        valid.push({
          rowNumber,
          inventoryType: "product",
          productSubType: "new",
          productEntryMode: "single",
          productName,
          sku,
          quantity,
          retailIdentifier,
          expiryDate: expiryParsed,
          remarks,
          trackingNumber,
          carrier,
        });
        return;
      }

      // variants
      const color = raw["Color"].trim();
      const size = raw["Size"].trim();
      if (!color || !size) {
        errors.push({ rowNumber, message: "Color and Size are required for variant rows." });
        return;
      }

      const baseSku = raw["SKU"].trim();
      if (!baseSku) {
        errors.push({ rowNumber, message: "SKU (base SKU) is required for variant rows." });
        return;
      }
      const finalSku = buildVariantSku(baseSku, color, size);
      const skuKey = finalSku.toLowerCase();
      if (inventorySkus.has(skuKey)) {
        errors.push({ rowNumber, message: `SKU "${finalSku}" already exists in your inventory.` });
        return;
      }
      if (pendingSkus.has(skuKey)) {
        errors.push({ rowNumber, message: `SKU "${finalSku}" is already in a pending request.` });
        return;
      }
      if (usedSkusInFile.has(skuKey)) {
        errors.push({ rowNumber, message: `Duplicate SKU "${finalSku}" in this file.` });
        return;
      }
      usedSkusInFile.add(skuKey);

      if (retailIdentifier) {
        const ridKey = retailIdentifier.toLowerCase();
        if (inventoryRetailIds.has(ridKey) || pendingRetailIds.has(ridKey) || usedRetailInFile.has(ridKey)) {
          errors.push({
            rowNumber,
            message: `Identifier "${retailIdentifier}" is already used.`,
          });
          return;
        }
        usedRetailInFile.add(ridKey);
      }

      valid.push({
        rowNumber,
        inventoryType: "product",
        productSubType: "new",
        productEntryMode: "variants",
        productName,
        parentProductName: productName,
        sku: finalSku,
        color,
        size,
        variantLabel: `${color} / ${size}`,
        quantity,
        retailIdentifier,
        expiryDate: expiryParsed,
        remarks,
        trackingNumber,
        carrier,
      });
      return;
    }

    // box / pallet / container
    if (inventoryType === "container") {
      const containerSize = normalizeContainerSize(raw["Container Size"]);
      if (!containerSize) {
        errors.push({
          rowNumber,
          message: 'Container Size is required (use "20 feet" or "40 feet").',
        });
        return;
      }
      let productName = raw["Product Name"].trim();
      if (productName) {
        if (usedStorageNames.has(productName)) {
          errors.push({ rowNumber, message: `Container ID "${productName}" already exists.` });
          return;
        }
        usedStorageNames.add(productName);
      } else {
        productName = generateStorageUnitId("container", context.ownerName, usedStorageNames);
      }
      valid.push({
        rowNumber,
        inventoryType: "container",
        productName,
        quantity,
        containerSize,
        remarks,
        trackingNumber,
        carrier,
      });
      return;
    }

    let productName = raw["Product Name"].trim();
    if (productName) {
      if (usedStorageNames.has(productName)) {
        errors.push({ rowNumber, message: `${inventoryType} ID "${productName}" already exists.` });
        return;
      }
      usedStorageNames.add(productName);
    } else {
      productName = generateStorageUnitId(inventoryType, context.ownerName, usedStorageNames);
    }
    valid.push({
      rowNumber,
      inventoryType,
      productName,
      quantity,
      remarks,
      trackingNumber,
      carrier,
    });
  });

  return { valid, errors };
}

export function inboundBulkRowToFirestoreDoc(
  row: InboundBulkValidatedRow,
  context: { ownerId: string; ownerName: string; addDate: Timestamp; requestedAt: Timestamp }
): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    userId: context.ownerId,
    userName: context.ownerName || "Unknown User",
    inventoryType: row.inventoryType,
    productName: row.productName,
    quantity: row.quantity,
    requestedQuantity: row.quantity,
    addDate: context.addDate,
    status: "pending",
    requestedBy: context.ownerId,
    requestedAt: context.requestedAt,
  };

  if (row.inventoryType === "product") {
    if (row.productSubType) doc.productSubType = row.productSubType;
    if (row.productId) doc.productId = row.productId;
    if (row.productEntryMode) doc.productEntryMode = row.productEntryMode;
    if (row.sku) doc.sku = row.sku;
    if (row.color) doc.color = row.color;
    if (row.size) doc.size = row.size;
    if (row.variantLabel) doc.variantLabel = row.variantLabel;
    if (row.parentProductName) doc.parentProductName = row.parentProductName;
    if (row.retailIdentifier) doc.retailIdentifier = row.retailIdentifier;
    if (row.expiryDate) doc.expiryDate = row.expiryDate;
  }

  if (row.inventoryType === "container" && row.containerSize) {
    doc.containerSize = row.containerSize;
  }

  if (row.remarks) doc.remarks = row.remarks;

  if (row.imageUrls && row.imageUrls.length > 0) {
    doc.imageUrls = row.imageUrls;
    doc.imageUrl = row.imageUrls[0];
  }

  return doc;
}

export function downloadInboundBulkTemplate(): void {
  const examples: InboundBulkCsvRow[] = [
    {
      "Inventory Type": "product",
      "Product Sub Type": "new",
      "Entry Mode": "single",
      "Product Name": "Example Product",
      SKU: "SKU-001",
      Color: "",
      Size: "",
      Quantity: "10",
      "Container Size": "",
      "Retail Identifier": "",
      "Expiry Date": "",
      Remarks: "Single new product",
      "Tracking Number": "",
      Carrier: "",
    },
    {
      "Inventory Type": "product",
      "Product Sub Type": "new",
      "Entry Mode": "single",
      "Product Name": "Example Product B",
      SKU: "SKU-002",
      Color: "",
      Size: "",
      Quantity: "5",
      "Container Size": "",
      "Retail Identifier": "",
      "Expiry Date": "",
      Remarks: "Same shipment as row above — repeat tracking on each row",
      "Tracking Number": "9400111899223344556677",
      Carrier: "USPS",
    },
    {
      "Inventory Type": "product",
      "Product Sub Type": "new",
      "Entry Mode": "variants",
      "Product Name": "Example Product",
      SKU: "SKU-BASE",
      Color: "Red",
      Size: "M",
      Quantity: "5",
      "Container Size": "",
      "Retail Identifier": "",
      "Expiry Date": "2026-12-31",
      Remarks: "One row per variant",
      "Tracking Number": "",
      Carrier: "",
    },
    {
      "Inventory Type": "product",
      "Product Sub Type": "restock",
      "Entry Mode": "",
      "Product Name": "",
      SKU: "YOUR-EXISTING-SKU",
      Color: "",
      Size: "",
      Quantity: "20",
      "Container Size": "",
      "Retail Identifier": "",
      "Expiry Date": "",
      Remarks: "Restock by SKU",
      "Tracking Number": "",
      Carrier: "",
    },
    {
      "Inventory Type": "box",
      "Product Sub Type": "",
      "Entry Mode": "",
      "Product Name": "",
      SKU: "",
      Color: "",
      Size: "",
      Quantity: "1",
      "Container Size": "",
      "Retail Identifier": "",
      "Expiry Date": "",
      Remarks: "Box (ID auto-generated if name empty)",
      "Tracking Number": "",
      Carrier: "",
    },
    {
      "Inventory Type": "pallet",
      "Product Sub Type": "",
      "Entry Mode": "",
      "Product Name": "",
      SKU: "",
      Color: "",
      Size: "",
      Quantity: "1",
      "Container Size": "",
      "Retail Identifier": "",
      "Expiry Date": "",
      Remarks: "Pallet (ID auto-generated if name empty)",
      "Tracking Number": "",
      Carrier: "",
    },
    {
      "Inventory Type": "container",
      "Product Sub Type": "",
      "Entry Mode": "",
      "Product Name": "",
      SKU: "",
      Color: "",
      Size: "",
      Quantity: "1",
      "Container Size": "20 feet",
      "Retail Identifier": "",
      "Expiry Date": "",
      Remarks: "Container handling",
      "Tracking Number": "",
      Carrier: "",
    },
  ];

  const escape = (v: string) => {
    if (v.includes(",") || v.includes('"') || v.includes("\n")) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };

  const lines = [
    INBOUND_BULK_CSV_HEADERS.join(","),
    ...examples.map((row) => INBOUND_BULK_CSV_HEADERS.map((h) => escape(row[h])).join(",")),
  ];
  downloadCSV("\uFEFF" + lines.join("\n"), "inbound-inventory-template.csv");
}

export function collectExistingStorageNames(
  inventory: InventoryItem[],
  requests: InventoryRequest[]
): Set<string> {
  const names = new Set<string>();
  for (const item of inventory) {
    const t = (item as InventoryItem & { inventoryType?: string }).inventoryType;
    if (t === "box" || t === "pallet" || t === "container") {
      const name = String(item.productName ?? "").trim();
      if (name) names.add(name);
    }
  }
  for (const req of requests) {
    if (req.inventoryType === "box" || req.inventoryType === "pallet" || req.inventoryType === "container") {
      const name = String(req.productName ?? "").trim();
      if (name) names.add(name);
    }
  }
  return names;
}
