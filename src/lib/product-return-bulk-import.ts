import type { InventoryItem } from "@/types";
import { downloadCSV } from "@/lib/csv-utils";
import {
  createEmptyReturnDraft,
  type ReturnDraft,
} from "@/lib/product-return-draft";

const SHARED_RETURN_CSV_HEADERS = [
  "How Products Coming",
  "Requested Quantity",
  "Remarks",
  "Pack Into Boxes",
  "Place On Pallet",
  "Ship To Address",
  "Shipping Name",
  "Shipping Address",
  "Shipping City",
  "Shipping State",
  "Shipping Zip Code",
  "Shipping Country",
  "Tracking Number",
  "Carrier",
] as const;

export const EXISTING_PRODUCT_RETURN_CSV_HEADERS = [
  "Product ID",
  "SKU",
  "Product Name",
  "Current Quantity",
  ...SHARED_RETURN_CSV_HEADERS,
] as const;

export const NEW_PRODUCT_RETURN_CSV_HEADERS = [
  "Product Name",
  "SKU",
  ...SHARED_RETURN_CSV_HEADERS,
] as const;

export type ExistingProductReturnCsvRow = Record<
  (typeof EXISTING_PRODUCT_RETURN_CSV_HEADERS)[number],
  string
>;

export type NewProductReturnCsvRow = Record<
  (typeof NEW_PRODUCT_RETURN_CSV_HEADERS)[number],
  string
>;

export type ProductReturnBulkImportKind = "existing" | "new";

export type ProductReturnBulkValidatedRow = {
  rowNumber: number;
  type: ProductReturnBulkImportKind;
  returnType: "combine" | "partial";
  productId?: string;
  productName: string;
  sku: string;
  newProductName?: string;
  newProductSku?: string;
  requestedQuantity: number;
  userRemarks: string;
  packIntoBoxes: boolean;
  placeOnPallet: boolean;
  shipToAddress: boolean;
  shippingName: string;
  shippingAddress: string;
  shippingCity: string;
  shippingState: string;
  shippingZipCode: string;
  shippingCountry: string;
  trackingNumber: string;
  carrier: string;
  currentQuantity?: number;
};

export type ProductReturnBulkRowError = {
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

function rowToCsvLine(
  headers: readonly string[],
  row: Record<string, string>
): string {
  return headers.map((h) => escapeCsvCell(row[h] ?? "")).join(",");
}

function parseBooleanCell(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  return v === "yes" || v === "y" || v === "true" || v === "1";
}

function parseReturnTypeCell(raw: string): "combine" | "partial" | null {
  const v = raw.trim().toLowerCase();
  if (!v) return "combine";
  if (v === "combine" || v.startsWith("combine")) return "combine";
  if (v === "partial" || v.startsWith("partial")) return "partial";
  return null;
}

function parseCarrierCell(raw: string): string {
  const v = raw.trim().toLowerCase();
  if (!v) return "usps";
  if (v === "usps" || v.includes("usps")) return "usps";
  if (v === "ups" || v.includes("ups")) return "ups";
  if (v === "fedex" || v.includes("fedex")) return "fedex";
  if (v === "dhl" || v.includes("dhl")) return "dhl";
  return v;
}

/** Same eligibility as the manual return form product picker. */
export function isProductReturnTemplateEligible(item: InventoryItem): boolean {
  const inventoryType = (item as InventoryItem & { inventoryType?: string }).inventoryType;
  const isExcludedType =
    inventoryType === "box" || inventoryType === "container" || inventoryType === "pallet";
  return item.status === "In Stock" && (item.quantity || 0) > 0 && !isExcludedType;
}

function emptySharedFields(): Record<(typeof SHARED_RETURN_CSV_HEADERS)[number], string> {
  return {
    "How Products Coming": "",
    "Requested Quantity": "",
    Remarks: "",
    "Pack Into Boxes": "",
    "Place On Pallet": "",
    "Ship To Address": "",
    "Shipping Name": "",
    "Shipping Address": "",
    "Shipping City": "",
    "Shipping State": "",
    "Shipping Zip Code": "",
    "Shipping Country": "",
    "Tracking Number": "",
    Carrier: "",
  };
}

export function downloadExistingProductReturnTemplate(inventory: InventoryItem[]): void {
  const eligible = inventory
    .filter(isProductReturnTemplateEligible)
    .sort((a, b) => String(a.productName || "").localeCompare(String(b.productName || "")));

  const lines = [
    EXISTING_PRODUCT_RETURN_CSV_HEADERS.join(","),
    ...eligible.map((item) => {
      const row: ExistingProductReturnCsvRow = {
        "Product ID": item.id,
        SKU: String(item.sku ?? "").trim(),
        "Product Name": item.productName,
        "Current Quantity": String(item.quantity ?? 0),
        ...emptySharedFields(),
      };
      return rowToCsvLine(EXISTING_PRODUCT_RETURN_CSV_HEADERS, row);
    }),
  ];

  downloadCSV("\uFEFF" + lines.join("\n"), "product-return-existing-template.csv");
}

export function downloadNewProductReturnTemplate(): void {
  const blankRow: NewProductReturnCsvRow = {
    "Product Name": "",
    SKU: "",
    ...emptySharedFields(),
  };

  const lines = [
    NEW_PRODUCT_RETURN_CSV_HEADERS.join(","),
    rowToCsvLine(NEW_PRODUCT_RETURN_CSV_HEADERS, blankRow),
    rowToCsvLine(NEW_PRODUCT_RETURN_CSV_HEADERS, blankRow),
    rowToCsvLine(NEW_PRODUCT_RETURN_CSV_HEADERS, blankRow),
  ];

  downloadCSV("\uFEFF" + lines.join("\n"), "product-return-new-template.csv");
}

function detectImportKind(headerCells: string[]): ProductReturnBulkImportKind | null {
  const normalized = new Set(headerCells.map(normHeader));
  if (normalized.has(normHeader("Product ID"))) return "existing";
  if (
    normalized.has(normHeader("Product Name")) &&
    !normalized.has(normHeader("Product ID"))
  ) {
    return "new";
  }
  return null;
}

export function parseProductReturnBulkCsv(text: string): {
  kind: ProductReturnBulkImportKind | null;
  existingRows: ExistingProductReturnCsvRow[];
  newRows: NewProductReturnCsvRow[];
  errors: string[];
} {
  const errors: string[] = [];
  const clean = text.replace(/^\uFEFF/, "").trim();
  if (!clean) {
    return { kind: null, existingRows: [], newRows: [], errors: ["File is empty."] };
  }

  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return {
      kind: null,
      existingRows: [],
      newRows: [],
      errors: ["CSV must include a header row and at least one data row."],
    };
  }

  const headerCells = parseCsvLine(lines[0]);
  const kind = detectImportKind(headerCells);
  if (!kind) {
    return {
      kind: null,
      existingRows: [],
      newRows: [],
      errors: [
        'Unrecognized template. Use "Existing product" template (with Product ID) or "New product" template.',
      ],
    };
  }

  const headers =
    kind === "existing" ? EXISTING_PRODUCT_RETURN_CSV_HEADERS : NEW_PRODUCT_RETURN_CSV_HEADERS;
  const headerIndex = new Map<string, number>();
  headerCells.forEach((cell, idx) => headerIndex.set(normHeader(cell), idx));

  for (const required of headers) {
    if (!headerIndex.has(normHeader(required))) {
      errors.push(`Missing required column: "${required}".`);
    }
  }
  if (errors.length > 0) {
    return { kind, existingRows: [], newRows: [], errors };
  }

  const existingRows: ExistingProductReturnCsvRow[] = [];
  const newRows: NewProductReturnCsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    if (kind === "existing") {
      const row = {} as ExistingProductReturnCsvRow;
      for (const header of EXISTING_PRODUCT_RETURN_CSV_HEADERS) {
        const idx = headerIndex.get(normHeader(header))!;
        row[header] = (cells[idx] ?? "").trim();
      }
      if (EXISTING_PRODUCT_RETURN_CSV_HEADERS.every((h) => !row[h])) continue;
      existingRows.push(row);
    } else {
      const row = {} as NewProductReturnCsvRow;
      for (const header of NEW_PRODUCT_RETURN_CSV_HEADERS) {
        const idx = headerIndex.get(normHeader(header))!;
        row[header] = (cells[idx] ?? "").trim();
      }
      if (NEW_PRODUCT_RETURN_CSV_HEADERS.every((h) => !row[h])) continue;
      newRows.push(row);
    }
  }

  if (existingRows.length === 0 && newRows.length === 0) {
    errors.push("No data rows found.");
  }

  return { kind, existingRows, newRows, errors };
}

function validateSharedFields(
  raw: Record<string, string>,
  rowNumber: number,
  errors: ProductReturnBulkRowError[],
  warnings: ProductReturnBulkRowError[]
): Omit<
  ProductReturnBulkValidatedRow,
  "rowNumber" | "type" | "productId" | "productName" | "sku" | "newProductName" | "newProductSku" | "currentQuantity"
> | null {
  const qtyRaw = raw["Requested Quantity"].trim();
  if (!qtyRaw) return null;

  const requestedQuantity = Number.parseInt(qtyRaw, 10);
  if (Number.isNaN(requestedQuantity) || requestedQuantity <= 0) {
    errors.push({
      rowNumber,
      message: "Requested Quantity must be a positive whole number.",
    });
    return null;
  }

  const returnType = parseReturnTypeCell(raw["How Products Coming"]);
  if (!returnType) {
    errors.push({
      rowNumber,
      message: 'How Products Coming must be "combine" or "partial".',
    });
    return null;
  }

  const shipToAddress = parseBooleanCell(raw["Ship To Address"]);
  const shippingName = raw["Shipping Name"].trim();
  const shippingAddress = raw["Shipping Address"].trim();
  const shippingCity = raw["Shipping City"].trim();
  const shippingState = raw["Shipping State"].trim();
  const shippingZipCode = raw["Shipping Zip Code"].trim();
  const shippingCountry = raw["Shipping Country"].trim();

  if (shipToAddress) {
    if (
      !shippingName ||
      !shippingAddress ||
      !shippingCity ||
      !shippingState ||
      !shippingZipCode ||
      !shippingCountry
    ) {
      errors.push({
        rowNumber,
        message: "Complete all shipping address fields when Ship To Address is yes.",
      });
      return null;
    }
  } else if (
    shippingName ||
    shippingAddress ||
    shippingCity ||
    shippingState ||
    shippingZipCode ||
    shippingCountry
  ) {
    warnings.push({
      rowNumber,
      message: "Shipping address fields were ignored because Ship To Address is not yes.",
    });
  }

  return {
    returnType,
    requestedQuantity,
    userRemarks: raw.Remarks.trim(),
    packIntoBoxes: parseBooleanCell(raw["Pack Into Boxes"]),
    placeOnPallet: parseBooleanCell(raw["Place On Pallet"]),
    shipToAddress,
    shippingName,
    shippingAddress,
    shippingCity,
    shippingState,
    shippingZipCode,
    shippingCountry,
    trackingNumber: raw["Tracking Number"].trim(),
    carrier: parseCarrierCell(raw.Carrier),
  };
}

export function validateExistingProductReturnRows(
  csvRows: ExistingProductReturnCsvRow[],
  context: { inventory: InventoryItem[] }
): {
  valid: ProductReturnBulkValidatedRow[];
  errors: ProductReturnBulkRowError[];
  warnings: ProductReturnBulkRowError[];
} {
  const errors: ProductReturnBulkRowError[] = [];
  const warnings: ProductReturnBulkRowError[] = [];
  const valid: ProductReturnBulkValidatedRow[] = [];

  const inventoryById = new Map<string, InventoryItem>();
  for (const item of context.inventory) {
    if (!isProductReturnTemplateEligible(item)) continue;
    inventoryById.set(item.id, item);
  }

  csvRows.forEach((raw, index) => {
    const rowNumber = index + 2;
    const shared = validateSharedFields(raw, rowNumber, errors, warnings);
    if (!shared) return;

    const productId = raw["Product ID"].trim();
    if (!productId) {
      errors.push({ rowNumber, message: "Product ID is required." });
      return;
    }

    const product = inventoryById.get(productId);
    if (!product) {
      errors.push({
        rowNumber,
        message: `Product "${raw["Product Name"].trim() || productId}" is not eligible for return or was removed.`,
      });
      return;
    }

    const csvCurrentQty = Number.parseInt(raw["Current Quantity"].trim(), 10);
    const liveQty = Number(product.quantity) || 0;
    if (Number.isFinite(csvCurrentQty) && csvCurrentQty !== liveQty) {
      warnings.push({
        rowNumber,
        message: `Current Quantity in file (${csvCurrentQty}) differs from live stock (${liveQty}).`,
      });
    }

    valid.push({
      rowNumber,
      type: "existing",
      productId: product.id,
      productName: product.productName,
      sku: String(product.sku ?? raw.SKU.trim()),
      currentQuantity: liveQty,
      ...shared,
    });
  });

  if (valid.length === 0 && errors.length === 0) {
    errors.push("Add Requested Quantity on at least one row before submitting.");
  }

  return { valid, errors, warnings };
}

export function validateNewProductReturnRows(
  csvRows: NewProductReturnCsvRow[]
): {
  valid: ProductReturnBulkValidatedRow[];
  errors: ProductReturnBulkRowError[];
  warnings: ProductReturnBulkRowError[];
} {
  const errors: ProductReturnBulkRowError[] = [];
  const warnings: ProductReturnBulkRowError[] = [];
  const valid: ProductReturnBulkValidatedRow[] = [];

  csvRows.forEach((raw, index) => {
    const rowNumber = index + 2;
    const productName = raw["Product Name"].trim();
    const qtyRaw = raw["Requested Quantity"].trim();

    if (!productName && !qtyRaw) return;

    if (!productName) {
      errors.push({ rowNumber, message: "Product Name is required." });
      return;
    }

    const shared = validateSharedFields(raw, rowNumber, errors, warnings);
    if (!shared) return;

    valid.push({
      rowNumber,
      type: "new",
      productName,
      sku: raw.SKU.trim(),
      newProductName: productName,
      newProductSku: raw.SKU.trim(),
      ...shared,
    });
  });

  if (valid.length === 0 && errors.length === 0) {
    errors.push("Add Product Name and Requested Quantity on at least one row before submitting.");
  }

  return { valid, errors, warnings };
}

export function validatedRowToReturnDraft(row: ProductReturnBulkValidatedRow): ReturnDraft {
  const draft = createEmptyReturnDraft();
  draft.type = row.type;
  draft.returnType = row.returnType;

  if (row.type === "existing") {
    draft.productId = row.productId ?? "";
    draft.productName = row.productName;
    draft.sku = row.sku;
  } else {
    draft.newProductName = row.newProductName ?? row.productName;
    draft.newProductSku = row.newProductSku ?? row.sku;
  }

  draft.requestedQuantity = row.requestedQuantity;
  draft.userRemarks = row.userRemarks;
  draft.packIntoBoxes = row.packIntoBoxes;
  draft.placeOnPallet = row.placeOnPallet;
  draft.shipToAddress = row.shipToAddress;
  draft.shippingName = row.shippingName;
  draft.shippingAddress = row.shippingAddress;
  draft.shippingCity = row.shippingCity;
  draft.shippingState = row.shippingState;
  draft.shippingZipCode = row.shippingZipCode;
  draft.shippingCountry = row.shippingCountry;
  draft.tracking = {
    trackingNumber: row.trackingNumber,
    carrier: row.carrier,
  };

  return draft;
}
