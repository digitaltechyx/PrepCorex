import ExcelJS from "exceljs";
import { Timestamp } from "firebase/firestore";
import type { ServiceType, UserPricing, UserProductPrepRate, InventoryItem } from "@/types";
import { DTC_FBM_SERVICE, normalizeStoredServiceType } from "@/types";
import { downloadCSV } from "@/lib/csv-utils";
import { downloadExcelBuffer } from "@/lib/inventory-export-xlsx";
import { isIntegrationInventorySource } from "@/lib/integration-inventory-sources";
import { FBA_SERVICE } from "@/lib/fba-shipment-workflow";
import { resolvePrepUnitPrice } from "@/lib/pricing-utils";

/** Optional FBA pack add-on config (legacy CSV pricing hook). */
export type FbaPackAddOnConfig = Record<string, unknown>;

/** Max separate lots a Choose-lots line can pick via dropdowns. */
export const OUTBOUND_LOT_PICK_SLOTS = 3 as const;

/** Columns that map 1:1 to the product outbound create-shipment form. */
export const OUTBOUND_BULK_CSV_HEADERS = [
  "Product ID",
  "SKU",
  "Product Name",
  "Stock Type",
  "Available Quantity",
  "Available Lots",
  "Quantity",
  "Pack Of",
  "Line Units",
  "Remaining Quantity",
  "Service",
  "Shipping Date",
  "Shipment Preference",
  "Product Type",
  "Lot Selection",
  "Lot 1",
  "Lot 1 Qty",
  "Lot 2",
  "Lot 2 Qty",
  "Lot 3",
  "Lot 3 Qty",
  "Remarks",
] as const;

/** Legacy header aliases accepted on upload (older CSV templates). */
const HEADER_ALIASES: Record<string, (typeof OUTBOUND_BULK_CSV_HEADERS)[number]> = {
  "current quantity": "Available Quantity",
  "available qty": "Available Quantity",
  "available quantity": "Available Quantity",
  "available lots": "Available Lots",
  "expiry lots": "Available Lots",
  "lots": "Available Lots",
  "stock type": "Stock Type",
  "inventory type": "Stock Type",
  "qty": "Quantity",
  "pack of": "Pack Of",
  "pack": "Pack Of",
  "line units": "Line Units",
  "units": "Line Units",
  "remaining quantity": "Remaining Quantity",
  "remaining qty": "Remaining Quantity",
  "remaining": "Remaining Quantity",
  "service": "Service",
  "shipping date": "Shipping Date",
  "ship date": "Shipping Date",
  "date": "Shipping Date",
  "shipment preference": "Shipment Preference",
  "preference": "Shipment Preference",
  "spd / ltl": "Shipment Preference",
  "product type": "Product Type",
  "type": "Product Type",
  "lot selection": "Lot Selection",
  "batch": "Lot Selection",
  "stock rotation": "Lot Selection",
  "rotation": "Lot Selection",
  "lot 1": "Lot 1",
  "lot1": "Lot 1",
  "lot 1 qty": "Lot 1 Qty",
  "lot1 qty": "Lot 1 Qty",
  "lot 2": "Lot 2",
  "lot2": "Lot 2",
  "lot 2 qty": "Lot 2 Qty",
  "lot2 qty": "Lot 2 Qty",
  "lot 3": "Lot 3",
  "lot3": "Lot 3",
  "lot 3 qty": "Lot 3 Qty",
  "lot3 qty": "Lot 3 Qty",
  /** Legacy free-text column — still accepted on upload if present. */
  "lot allocations": "Lot 1",
  "choose lots": "Lot 1",
  "manual lots": "Lot 1",
  "remarks": "Remarks",
  "product id": "Product ID",
  "sku": "SKU",
  "product name": "Product Name",
};

/** Same service picker as create-shipment form. */
export const OUTBOUND_SERVICE_OPTIONS = [
  "FBA/WFS/TFS",
  "DTC/FBM",
  "Carton Forwarding",
  "Pallet Forwarding",
] as const;

export type OutboundBulkService = (typeof OUTBOUND_SERVICE_OPTIONS)[number];

export const OUTBOUND_PREFERENCE_OPTIONS = ["SPD", "LTL"] as const;
export const OUTBOUND_PRODUCT_TYPE_OPTIONS = ["Standard", "Custom"] as const;

/** Labels match the create-shipment lot dropdown. */
export const OUTBOUND_LOT_SELECTION_OPTIONS = [
  "Auto (FEFO if expiry)",
  "FEFO — first expire",
  "FIFO — first received",
  "Choose lots…",
] as const;

export type OutboundBulkLotPolicy = "auto" | "fefo" | "fifo" | "manual";

export type OutboundBulkLotAllocation = {
  expiry: string;
  quantity: number;
  lot?: string | null;
};

export type OutboundBulkCsvRow = Record<(typeof OUTBOUND_BULK_CSV_HEADERS)[number], string>;

export type OutboundBulkValidatedRow = {
  rowNumber: number;
  service: OutboundBulkService;
  shipmentType: "product" | "box" | "pallet";
  shippingDate: Date;
  shipmentPreference: "box" | "pallet";
  productType: "Standard" | "Custom";
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  packOf: number;
  unitPrice: number;
  totalPrice: number;
  stockRotationPolicy: OutboundBulkLotPolicy;
  lotAllocations?: OutboundBulkLotAllocation[];
  remarks?: string;
};

/** One outbound request (= one form shipment group) with one or more pack lines. */
export type OutboundBulkRequestGroup = {
  service: OutboundBulkService;
  shipmentType: "product" | "box" | "pallet";
  shippingDate: Date;
  shipmentPreference: "box" | "pallet";
  remarks?: string;
  lines: OutboundBulkValidatedRow[];
};

export type OutboundBulkRowError = {
  rowNumber: number;
  message: string;
};

const SHEET_NAME = "Outbound";
const LISTS_SHEET = "Lists";
const INSTRUCTIONS_SHEET = "Instructions";
/** Extra blank rows so the client can paste duplicate product pack lines. */
const EXTRA_PACK_LINE_ROWS = 40;

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

function resolveHeader(raw: string): (typeof OUTBOUND_BULK_CSV_HEADERS)[number] | null {
  const n = normHeader(raw);
  if (HEADER_ALIASES[n]) return HEADER_ALIASES[n];
  const exact = OUTBOUND_BULK_CSV_HEADERS.find((h) => normHeader(h) === n);
  return exact ?? null;
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

function emptyRow(): OutboundBulkCsvRow {
  return {
    "Product ID": "",
    SKU: "",
    "Product Name": "",
    "Stock Type": "",
    "Available Quantity": "",
    "Available Lots": "",
    Quantity: "",
    "Pack Of": "",
    "Line Units": "",
    "Remaining Quantity": "",
    Service: "",
    "Shipping Date": "",
    "Shipment Preference": "",
    "Product Type": "",
    "Lot Selection": "",
    "Lot 1": "",
    "Lot 1 Qty": "",
    "Lot 2": "",
    "Lot 2 Qty": "",
    "Lot 3": "",
    "Lot 3 Qty": "",
    Remarks: "",
  };
}

function inventoryStockType(item: InventoryItem): "product" | "box" | "pallet" | "container" | string {
  return String((item as InventoryItem & { inventoryType?: string }).inventoryType ?? "product")
    .trim()
    .toLowerCase();
}

type ProductLotOption = { expiry: string; quantity: number; label: string };

function productLotOptions(item: InventoryItem): ProductLotOption[] {
  const batches = Array.isArray(item.expiryBatches) ? item.expiryBatches : [];
  const byExpiry = new Map<string, number>();
  for (const b of batches) {
    const expiry = String(b?.expiry ?? "").trim();
    const qty = Math.max(0, Math.floor(Number(b?.quantity) || 0));
    if (!expiry || qty <= 0) continue;
    // Normalize to YYYY-MM-DD when possible
    const parsed = parseShippingDate(expiry);
    const key = parsed === "invalid" ? expiry : formatDateYmd(parsed);
    byExpiry.set(key, (byExpiry.get(key) ?? 0) + qty);
  }
  return Array.from(byExpiry.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([expiry, quantity]) => ({
      expiry,
      quantity,
      label: `${expiry} (avail ${quantity})`,
    }));
}

function formatAvailableLots(item: InventoryItem): string {
  return productLotOptions(item)
    .map((l) => `${l.expiry} (${l.quantity})`)
    .join("; ");
}

/** Extract expiry from dropdown label "YYYY-MM-DD (avail N)" or a bare date. */
export function parseLotDropdownValue(raw: string): string | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  const withAvail = text.match(/^(\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})\s*\(/);
  const bare = text.match(/^(\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})\s*$/);
  const m = withAvail || bare;
  if (!m) return null;
  const expiryDate = parseShippingDate(m[1].replace(/[\/.]/g, "-"));
  if (expiryDate === "invalid") return null;
  return formatDateYmd(expiryDate);
}

/** Parse legacy "YYYY-MM-DD:qty; …" free-text (older templates). */
export function parseLotAllocationsCell(raw: string): {
  allocations: OutboundBulkLotAllocation[];
  error?: string;
} {
  const text = String(raw || "").trim();
  if (!text) return { allocations: [] };

  // If it looks like a single dropdown label without qty, ignore here
  if (parseLotDropdownValue(text) && !/[:=]\s*\d/.test(text) && !text.includes(";")) {
    return { allocations: [] };
  }

  const chunks = text
    .split(/[;\n|]+/)
    .map((c) => c.trim())
    .filter(Boolean);
  const allocations: OutboundBulkLotAllocation[] = [];

  for (const chunk of chunks) {
    const m = chunk.match(/^(\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})\s*[:=\-]\s*(\d+)\s*$/);
    if (!m) {
      return {
        allocations: [],
        error: `Invalid lot allocation "${chunk}". Pick a lot from the Lot dropdown and enter Qty.`,
      };
    }
    const expiryDate = parseShippingDate(m[1].replace(/[\/.]/g, "-"));
    if (expiryDate === "invalid") {
      return { allocations: [], error: `Invalid lot expiry date in "${chunk}".` };
    }
    const quantity = Number.parseInt(m[2], 10);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { allocations: [], error: `Lot quantity must be a positive whole number in "${chunk}".` };
    }
    allocations.push({ expiry: formatDateYmd(expiryDate), quantity });
  }

  return { allocations };
}

/** Build allocations from Lot 1–3 dropdown + qty columns (preferred). */
export function allocationsFromLotPickColumns(raw: OutboundBulkCsvRow): {
  allocations: OutboundBulkLotAllocation[];
  error?: string;
} {
  const merged = new Map<string, number>();

  for (let n = 1; n <= OUTBOUND_LOT_PICK_SLOTS; n++) {
    const lotKey = `Lot ${n}` as keyof OutboundBulkCsvRow;
    const qtyKey = `Lot ${n} Qty` as keyof OutboundBulkCsvRow;
    const lotRaw = String(raw[lotKey] ?? "").trim();
    const qtyRaw = String(raw[qtyKey] ?? "").trim();
    if (!lotRaw && !qtyRaw) continue;

    // Legacy: entire free-text blob pasted into Lot 1
    if (n === 1 && /[:=]\s*\d/.test(lotRaw) && lotRaw.includes(";")) {
      return parseLotAllocationsCell(lotRaw);
    }
    if (n === 1 && /[:=]\s*\d/.test(lotRaw) && !qtyRaw) {
      return parseLotAllocationsCell(lotRaw);
    }

    const expiry = parseLotDropdownValue(lotRaw);
    if (!expiry) {
      return {
        allocations: [],
        error: `Lot ${n}: pick a lot from the dropdown (or use YYYY-MM-DD).`,
      };
    }
    if (!qtyRaw) {
      return {
        allocations: [],
        error: `Lot ${n}: enter Qty after choosing the lot.`,
      };
    }
    const quantity = Number.parseInt(qtyRaw, 10);
    if (Number.isNaN(quantity) || quantity <= 0) {
      return {
        allocations: [],
        error: `Lot ${n} Qty must be a positive whole number.`,
      };
    }
    merged.set(expiry, (merged.get(expiry) ?? 0) + quantity);
  }

  const allocations = Array.from(merged.entries()).map(([expiry, quantity]) => ({
    expiry,
    quantity,
  }));
  return { allocations };
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value == null || value === "") return "";
  if (value instanceof Date) {
    return formatDateYmd(value);
  }
  if (typeof value === "number") {
    // Excel date serials are typically > 25000 for modern dates
    if (value > 20000 && value < 100000 && Number.isFinite(value)) {
      const d = excelSerialToDate(value);
      if (d) return formatDateYmd(d);
    }
    return String(value);
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    const obj = value as { text?: string; result?: unknown; richText?: Array<{ text?: string }> };
    if (typeof obj.result === "string" || typeof obj.result === "number") {
      return cellToString(obj.result as ExcelJS.CellValue);
    }
    if (obj.result instanceof Date) return formatDateYmd(obj.result);
    if (typeof obj.text === "string") return obj.text.trim();
    if (Array.isArray(obj.richText)) {
      return obj.richText.map((p) => p.text ?? "").join("").trim();
    }
  }
  return String(value).trim();
}

function formatDateYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Excel 1900 date system serial → local noon Date. */
function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial < 1) return null;
  // Excel epoch 1899-12-30 (accounts for 1900 leap-year bug)
  const utc = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
  const d = new Date(utc);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0);
}

function parseYmdParts(y: number, m: number, d: number): Date | "invalid" {
  if (m < 1 || m > 12 || d < 1 || d > 31) return "invalid";
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  if (
    Number.isNaN(dt.getTime()) ||
    dt.getFullYear() !== y ||
    dt.getMonth() !== m - 1 ||
    dt.getDate() !== d
  ) {
    return "invalid";
  }
  return dt;
}

/**
 * Flexible shipping-date parser for Excel date cells, serials, and common strings:
 * YYYY-MM-DD, YYYY/MM/DD, MM/DD/YYYY, DD/MM/YYYY (when unambiguous), "Mar 15 2026", etc.
 */
export function parseShippingDate(raw: string | Date | number | null | undefined): Date | "invalid" {
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return "invalid";
    return new Date(raw.getFullYear(), raw.getMonth(), raw.getDate(), 12, 0, 0);
  }
  if (typeof raw === "number") {
    const d = excelSerialToDate(raw);
    return d ?? "invalid";
  }
  if (raw == null) return "invalid";
  const s = String(raw).trim();
  if (!s) return "invalid";

  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 20000 && n < 100000) {
      const d = excelSerialToDate(n);
      if (d) return d;
    }
  }

  const iso = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (iso) {
    return parseYmdParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const slash = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (slash) {
    let a = Number(slash[1]);
    let b = Number(slash[2]);
    let y = Number(slash[3]);
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    // Ambiguous: if first > 12 treat as DD/MM; if second > 12 treat as MM/DD; else prefer MM/DD (US)
    if (a > 12 && b <= 12) {
      return parseYmdParts(y, b, a);
    }
    if (b > 12 && a <= 12) {
      return parseYmdParts(y, a, b);
    }
    return parseYmdParts(y, a, b);
  }

  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 12, 0, 0);
  }
  // Fallback: force noon local for YYYY-MM-DD without timezone shift
  const forced = new Date(`${s}T12:00:00`);
  if (!Number.isNaN(forced.getTime())) return forced;
  return "invalid";
}

export function parseOutboundBulkCsv(text: string): {
  rows: OutboundBulkCsvRow[];
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
  const headerIndex = new Map<(typeof OUTBOUND_BULK_CSV_HEADERS)[number], number>();
  headerCells.forEach((cell, idx) => {
    const resolved = resolveHeader(cell);
    if (resolved) headerIndex.set(resolved, idx);
  });

  const required: Array<(typeof OUTBOUND_BULK_CSV_HEADERS)[number]> = [
    "Product ID",
    "SKU",
    "Product Name",
    "Quantity",
    "Service",
    "Shipping Date",
    "Shipment Preference",
  ];
  for (const req of required) {
    if (!headerIndex.has(req)) {
      // Allow missing Product ID if SKU present and vice versa — validated per row
      if (req === "Product ID" || req === "SKU" || req === "Product Name") continue;
      errors.push(`Missing required column: "${req}".`);
    }
  }
  if (!headerIndex.has("Product ID") && !headerIndex.has("SKU")) {
    errors.push('Missing required column: "Product ID" or "SKU".');
  }
  if (errors.length > 0) return { rows: [], errors };

  const rows: OutboundBulkCsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const row = emptyRow();
    for (const header of OUTBOUND_BULK_CSV_HEADERS) {
      const idx = headerIndex.get(header);
      if (idx == null) continue;
      row[header] = (cells[idx] ?? "").trim();
    }
    if (OUTBOUND_BULK_CSV_HEADERS.every((h) => !row[h])) continue;
    rows.push(row);
  }

  if (rows.length === 0) errors.push("No data rows found.");
  return { rows, errors };
}

export async function parseOutboundBulkXlsx(buffer: ArrayBuffer): Promise<{
  rows: OutboundBulkCsvRow[];
  errors: string[];
}> {
  const errors: string[] = [];
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet =
      workbook.getWorksheet(SHEET_NAME) ||
      workbook.worksheets.find((ws) => normHeader(ws.name) !== "lists" && normHeader(ws.name) !== "instructions") ||
      workbook.worksheets[0];
    if (!sheet) return { rows: [], errors: ["Workbook has no sheets."] };

    const headerRow = sheet.getRow(1);
    const headerIndex = new Map<(typeof OUTBOUND_BULK_CSV_HEADERS)[number], number>();
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const resolved = resolveHeader(cellToString(cell.value));
      if (resolved) headerIndex.set(resolved, colNumber);
    });

    const required: Array<(typeof OUTBOUND_BULK_CSV_HEADERS)[number]> = [
      "Quantity",
      "Service",
      "Shipping Date",
      "Shipment Preference",
    ];
    for (const req of required) {
      if (!headerIndex.has(req)) {
        errors.push(`Missing required column: "${req}".`);
      }
    }
    if (!headerIndex.has("Product ID") && !headerIndex.has("SKU")) {
      errors.push('Missing required column: "Product ID" or "SKU".');
    }
    if (errors.length > 0) return { rows: [], errors };

    const rows: OutboundBulkCsvRow[] = [];
    const lastRow = Math.max(sheet.rowCount, 2);
    for (let r = 2; r <= lastRow; r++) {
      const excelRow = sheet.getRow(r);
      const row = emptyRow();
      let any = false;
      for (const header of OUTBOUND_BULK_CSV_HEADERS) {
        const col = headerIndex.get(header);
        if (col == null) continue;
        const cell = excelRow.getCell(col);
        let text = "";
        if (header === "Shipping Date") {
          const v = cell.value;
          if (v instanceof Date) {
            text = formatDateYmd(v);
          } else if (typeof v === "number") {
            const d = excelSerialToDate(v);
            text = d ? formatDateYmd(d) : String(v);
          } else if (v && typeof v === "object" && "result" in (v as object)) {
            text = cellToString((v as { result: ExcelJS.CellValue }).result);
          } else {
            text = cellToString(v);
          }
        } else {
          text = cellToString(cell.value);
        }
        row[header] = text;
        if (text) any = true;
      }
      if (!any) continue;
      // Skip pure instruction / leftover formula rows with no product identity and no qty
      if (!row["Product ID"] && !row.SKU && !row.Quantity) continue;
      rows.push(row);
    }

    if (rows.length === 0) errors.push("No data rows found.");
    return { rows, errors };
  } catch {
    return { rows: [], errors: ["Could not read Excel file. Save as .xlsx and try again."] };
  }
}

export async function parseOutboundBulkFile(file: File): Promise<{
  rows: OutboundBulkCsvRow[];
  errors: string[];
}> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) {
    const buffer = await file.arrayBuffer();
    return parseOutboundBulkXlsx(buffer);
  }
  if (name.endsWith(".csv") || file.type.includes("csv") || file.type === "text/plain") {
    const text = await file.text();
    return parseOutboundBulkCsv(text);
  }
  return {
    rows: [],
    errors: ["Unsupported file type. Upload the .xlsx template (or a .csv export)."],
  };
}

function normalizeService(raw: string): OutboundBulkService | null {
  const v = raw.trim();
  const upper = v.toUpperCase().replace(/\s+/g, " ");
  if (upper === "FBA/WFS/TFS" || upper === "FBA" || upper === "WFS" || upper === "TFS") {
    return "FBA/WFS/TFS";
  }
  if (upper === "FBM" || upper === "DTC/FBM" || v === "DTC/FBM") {
    return DTC_FBM_SERVICE;
  }
  if (
    upper === "CARTON FORWARDING" ||
    upper === "BOX FORWARDING" ||
    upper === "CARTON" ||
    upper === "XARTON FORWARDING"
  ) {
    return "Carton Forwarding";
  }
  if (upper === "PALLET FORWARDING" || upper === "PALLET" || upper === "LTL FORWARDING") {
    return "Pallet Forwarding";
  }
  const stored = normalizeStoredServiceType(v);
  return stored;
}

function shipmentTypeForService(service: OutboundBulkService): "product" | "box" | "pallet" {
  if (service === "Carton Forwarding") return "box";
  if (service === "Pallet Forwarding") return "pallet";
  return "product";
}

function normalizeLotSelection(raw: string): OutboundBulkLotPolicy | null {
  const v = raw.trim().toLowerCase();
  if (!v) return "auto";
  if (v === "auto" || v.startsWith("auto ") || v.includes("fefo if expiry")) return "auto";
  if (v === "fefo" || v.includes("first expire")) return "fefo";
  if (v === "fifo" || v.includes("first received")) return "fifo";
  if (v === "manual" || v.includes("choose lot") || v.includes("choose lots")) return "manual";
  return null;
}

function lotSelectionLabel(policy: OutboundBulkLotPolicy): string {
  switch (policy) {
    case "fefo":
      return "FEFO — first expire";
    case "fifo":
      return "FIFO — first received";
    case "manual":
      return "Choose lots…";
    default:
      return "Auto (FEFO if expiry)";
  }
}

function normalizePreference(raw: string): "box" | "pallet" | null {
  const v = raw.trim().toLowerCase();
  if (v === "box" || v === "carton" || v === "spd" || v === "small parcel") return "box";
  if (v === "pallet" || v === "ltl") return "pallet";
  return null;
}

function normalizeProductType(raw: string): "Standard" | "Custom" | null {
  const v = raw.trim().toLowerCase();
  if (!v) return "Standard";
  if (v === "standard") return "Standard";
  if (v === "custom") return "Custom";
  return null;
}

/**
 * Warehouse stock eligible for the outbound template.
 * Includes products (FBA/DTC), boxes (Carton Forwarding), and pallets (Pallet Forwarding).
 * Excludes marketplace Other resources, containers, merged-away rows, and zero qty.
 */
export function isOutboundTemplateEligible(item: InventoryItem): boolean {
  if (isIntegrationInventorySource((item as InventoryItem & { source?: string }).source)) {
    return false;
  }
  if (item.mergedIntoInventoryId) {
    return false;
  }
  const inventoryType = inventoryStockType(item);
  if (inventoryType === "container") {
    return false;
  }
  if (
    inventoryType &&
    inventoryType !== "product" &&
    inventoryType !== "box" &&
    inventoryType !== "pallet"
  ) {
    return false;
  }
  return Number(item.quantity) > 0;
}

export function computeOutboundLinePricing(
  pricingRules: UserPricing[],
  service: ServiceType | OutboundBulkService,
  quantity: number,
  packOf: number,
  packConfig?: FbaPackAddOnConfig,
  options?: {
    productId?: string;
    productPrepRates?: UserProductPrepRate[];
  }
): { unitPrice: number; totalPrice: number } {
  if (service === "Carton Forwarding" || service === "Pallet Forwarding") {
    void packOf;
    void packConfig;
    return { unitPrice: 0, totalPrice: 0 };
  }
  const calculated = resolvePrepUnitPrice({
    pricingRules,
    productPrepRates: options?.productPrepRates,
    productId: options?.productId,
    service: service as ServiceType,
    productType: "Standard",
    totalUnits: quantity,
  });
  const unitPrice = calculated?.rate ?? 0;
  if (unitPrice <= 0 || quantity <= 0) {
    return { unitPrice: 0, totalPrice: 0 };
  }
  const baseTotal = unitPrice * quantity;
  void packOf;
  void packConfig;
  return {
    unitPrice,
    totalPrice: parseFloat(baseTotal.toFixed(2)),
  };
}

export function validateOutboundBulkRows(
  csvRows: OutboundBulkCsvRow[],
  context: {
    inventory: InventoryItem[];
    pricingRules: UserPricing[];
    productPrepRates?: UserProductPrepRate[];
    packConfig?: FbaPackAddOnConfig;
  }
): { valid: OutboundBulkValidatedRow[]; errors: OutboundBulkRowError[]; warnings: OutboundBulkRowError[] } {
  const errors: OutboundBulkRowError[] = [];
  const warnings: OutboundBulkRowError[] = [];
  const valid: OutboundBulkValidatedRow[] = [];

  const inventoryById = new Map<string, InventoryItem>();
  const inventoryBySku = new Map<string, InventoryItem>();
  for (const item of context.inventory) {
    if (!isOutboundTemplateEligible(item)) continue;
    inventoryById.set(item.id, item);
    const sku = String(item.sku ?? "").trim();
    if (sku) inventoryBySku.set(sku.toLowerCase(), item);
  }

  const shipDemandByProduct = new Map<string, number>();

  csvRows.forEach((raw, index) => {
    const rowNumber = index + 2;
    const quantityRaw = raw.Quantity.trim();
    if (!quantityRaw) return;

    let quantity = Number.parseInt(quantityRaw, 10);
    if (Number.isNaN(quantity) || quantity <= 0) {
      errors.push({ rowNumber, message: "Quantity must be a positive whole number when provided." });
      return;
    }

    const productId = raw["Product ID"].trim();
    const sku = raw.SKU.trim();
    let product: InventoryItem | undefined;
    if (productId) {
      product = inventoryById.get(productId);
    }
    if (!product && sku) {
      product = inventoryBySku.get(sku.toLowerCase());
    }
    if (!product) {
      errors.push({
        rowNumber,
        message: `Product "${raw["Product Name"].trim() || productId || sku}" is not shippable or was removed.`,
      });
      return;
    }

    const availableRaw = (raw["Available Quantity"] || "").trim();
    const csvCurrentQty = availableRaw ? Number.parseInt(availableRaw, 10) : NaN;
    const liveQty = Number(product.quantity) || 0;
    if (Number.isFinite(csvCurrentQty) && csvCurrentQty !== liveQty) {
      warnings.push({
        rowNumber,
        message: `Available Quantity in file (${csvCurrentQty}) differs from live stock (${liveQty}). Using live quantity.`,
      });
    }

    const service = normalizeService(raw.Service);
    if (!service) {
      errors.push({
        rowNumber,
        message:
          'Service must be "FBA/WFS/TFS", "DTC/FBM", "Carton Forwarding", or "Pallet Forwarding" (use the dropdown).',
      });
      return;
    }

    const shipmentType = shipmentTypeForService(service);
    const stockType = inventoryStockType(product);
    if (shipmentType === "product" && stockType !== "product") {
      errors.push({
        rowNumber,
        message: `"${product.productName}" is ${stockType} stock — use Carton/Pallet Forwarding, or pick a product row for ${service}.`,
      });
      return;
    }
    if (shipmentType === "box" && stockType !== "box") {
      errors.push({
        rowNumber,
        message: `Carton Forwarding requires box inventory. "${product.productName}" is ${stockType || "product"}.`,
      });
      return;
    }
    if (shipmentType === "pallet" && stockType !== "pallet") {
      errors.push({
        rowNumber,
        message: `Pallet Forwarding requires pallet inventory. "${product.productName}" is ${stockType || "product"}.`,
      });
      return;
    }

    const shippingDate = parseShippingDate(raw["Shipping Date"]);
    if (shippingDate === "invalid") {
      errors.push({
        rowNumber,
        message:
          "Shipping Date is invalid. Use the date picker, or formats like YYYY-MM-DD, MM/DD/YYYY, or DD/MM/YYYY.",
      });
      return;
    }

    const shipmentPreference = normalizePreference(raw["Shipment Preference"]);
    if (!shipmentPreference) {
      errors.push({
        rowNumber,
        message: 'Shipment Preference must be "SPD" or "LTL" (use the dropdown).',
      });
      return;
    }

    const productType = normalizeProductType(raw["Product Type"]);
    if (!productType) {
      errors.push({
        rowNumber,
        message: 'Product Type must be "Standard" or "Custom" (use the dropdown).',
      });
      return;
    }

    const stockRotationPolicy = normalizeLotSelection(raw["Lot Selection"] || "");
    if (!stockRotationPolicy) {
      errors.push({
        rowNumber,
        message:
          'Lot Selection must be Auto (FEFO if expiry), FEFO — first expire, FIFO — first received, or Choose lots…',
      });
      return;
    }

    const packOfRaw = raw["Pack Of"].trim();
    let packOf = packOfRaw ? Number.parseInt(packOfRaw, 10) : 1;
    if (Number.isNaN(packOf) || packOf <= 0) {
      errors.push({ rowNumber, message: "Pack Of must be a positive whole number when provided." });
      return;
    }

    let lotAllocations: OutboundBulkLotAllocation[] | undefined;
    if (stockRotationPolicy === "manual") {
      const parsedLots = allocationsFromLotPickColumns(raw);
      if (parsedLots.error) {
        errors.push({ rowNumber, message: parsedLots.error });
        return;
      }
      if (parsedLots.allocations.length === 0) {
        errors.push({
          rowNumber,
          message:
            'Lot Selection is "Choose lots…" — pick lots from the Lot 1/2/3 dropdowns and enter each Lot Qty.',
        });
        return;
      }

      const availableByExpiry = new Map<string, number>();
      for (const b of product.expiryBatches || []) {
        const expiry = String(b?.expiry ?? "").trim();
        const qty = Math.max(0, Math.floor(Number(b?.quantity) || 0));
        if (!expiry || qty <= 0) continue;
        availableByExpiry.set(expiry, (availableByExpiry.get(expiry) ?? 0) + qty);
      }

      for (const alloc of parsedLots.allocations) {
        const avail = availableByExpiry.get(alloc.expiry) ?? 0;
        if (alloc.quantity > avail) {
          errors.push({
            rowNumber,
            message: `Lot ${alloc.expiry}: requested ${alloc.quantity}, available ${avail}.`,
          });
          return;
        }
      }

      const allocUnits = parsedLots.allocations.reduce((n, a) => n + a.quantity, 0);
      // Match form behavior: manual lots drive line units (qty × packOf).
      if (quantity * packOf !== allocUnits) {
        quantity = allocUnits;
        packOf = 1;
        warnings.push({
          rowNumber,
          message: `Choose lots total ${allocUnits} units — Quantity/Pack Of adjusted to match (qty ${allocUnits}, pack 1).`,
        });
      }
      lotAllocations = parsedLots.allocations;
    }

    const totalUnits = quantity * packOf;
    const alreadyRequested = shipDemandByProduct.get(product.id) ?? 0;
    const cumulativeUnits = alreadyRequested + totalUnits;
    if (cumulativeUnits > liveQty) {
      errors.push({
        rowNumber,
        message: `Insufficient stock for "${product.productName}": requested ${cumulativeUnits} units across pack lines, available ${liveQty}.`,
      });
      return;
    }
    shipDemandByProduct.set(product.id, cumulativeUnits);

    const { unitPrice, totalPrice } = computeOutboundLinePricing(
      context.pricingRules,
      service,
      quantity,
      packOf,
      context.packConfig,
      {
        productId: product.id,
        productPrepRates: context.productPrepRates,
      }
    );

    if (
      shipmentType === "product" &&
      productType !== "Custom" &&
      unitPrice <= 0
    ) {
      warnings.push({
        rowNumber,
        message: `No prep rate found for "${product.productName}" / ${service}. Line may need admin pricing.`,
      });
    }

    valid.push({
      rowNumber,
      service,
      shipmentType,
      shippingDate,
      shipmentPreference,
      productType,
      productId: product.id,
      productName: product.productName,
      sku: String(product.sku ?? sku),
      quantity,
      packOf,
      unitPrice,
      totalPrice,
      stockRotationPolicy,
      lotAllocations,
      remarks: raw.Remarks.trim() || undefined,
    });
  });

  if (valid.length === 0 && errors.length === 0) {
    errors.push({
      rowNumber: 0,
      message: "Add Quantity on at least one row for products you want to ship.",
    });
  }

  return { valid, errors, warnings };
}

/**
 * Group pack lines into outbound requests the same way the form uses shipment groups:
 * same Service + Shipping Date + Shipment Preference + Remarks → one request with many pack lines.
 * Duplicate product rows in the same group become multiple pack lines on that request.
 */
export function groupOutboundBulkRows(valid: OutboundBulkValidatedRow[]): OutboundBulkRequestGroup[] {
  const groups = new Map<string, OutboundBulkRequestGroup>();
  for (const row of valid) {
    const day = formatDateYmd(row.shippingDate);
    const key = [
      row.service,
      row.shipmentType,
      day,
      row.shipmentPreference,
      (row.remarks || "").trim().toLowerCase(),
    ].join("|");
    let group = groups.get(key);
    if (!group) {
      group = {
        service: row.service,
        shipmentType: row.shipmentType,
        shippingDate: row.shippingDate,
        shipmentPreference: row.shipmentPreference,
        remarks: row.remarks,
        lines: [],
      };
      groups.set(key, group);
    }
    group.lines.push(row);
  }
  return Array.from(groups.values());
}

export function outboundBulkGroupToFirestoreDoc(
  group: OutboundBulkRequestGroup,
  context: {
    ownerId: string;
    ownerDisplayName: string;
    requestedAt: Timestamp;
  }
): Record<string, unknown> {
  const productTypes = new Set(group.lines.map((l) => l.productType));
  const productType = productTypes.size === 1 ? group.lines[0].productType : "Standard";

  const doc: Record<string, unknown> = {
    userId: context.ownerId,
    userName: context.ownerDisplayName,
    date: Timestamp.fromDate(group.shippingDate),
    remarks: group.remarks,
    shipmentType: group.shipmentType,
    shipmentPreference: group.shipmentPreference,
    service: group.service,
    labelUrl: "",
    status: "pending",
    requestedBy: context.ownerId,
    requestedAt: context.requestedAt,
    shipments: group.lines.map((row) => {
      const line: Record<string, unknown> = {
        productId: row.productId,
        quantity: row.quantity,
        packOf: row.packOf,
        unitPrice: row.unitPrice,
      };
      if (group.shipmentType === "product") {
        line.productType = row.productType;
      }
      if (row.stockRotationPolicy && row.stockRotationPolicy !== "auto") {
        line.stockRotationPolicy = row.stockRotationPolicy;
      }
      if (row.stockRotationPolicy === "manual" && row.lotAllocations?.length) {
        line.stockRotationPolicy = "manual";
        line.lotAllocations = row.lotAllocations;
      }
      return line;
    }),
  };

  if (group.shipmentType === "product") {
    doc.productType = productType;
  }
  if (group.shipmentType === "pallet") {
    doc.palletSubType = "forwarding";
  }
  if (group.service === FBA_SERVICE) {
    doc.fbaLabelWorkflow = true;
  }

  return doc;
}

/** @deprecated Prefer outboundBulkGroupToFirestoreDoc — kept for single-line callers. */
export function outboundBulkRowToFirestoreDoc(
  row: OutboundBulkValidatedRow,
  context: {
    ownerId: string;
    ownerDisplayName: string;
    requestedAt: Timestamp;
  }
): Record<string, unknown> {
  return outboundBulkGroupToFirestoreDoc(
    {
      service: row.service,
      shipmentType: row.shipmentType,
      shippingDate: row.shippingDate,
      shipmentPreference: row.shipmentPreference,
      remarks: row.remarks,
      lines: [row],
    },
    context
  );
}

function colLetter(col1Based: number): string {
  let n = col1Based;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export async function buildOutboundBulkWorkbook(inventory: InventoryItem[]): Promise<ExcelJS.Buffer> {
  const stockTypeRank = (item: InventoryItem) => {
    const t = inventoryStockType(item);
    if (t === "product") return 0;
    if (t === "box") return 1;
    if (t === "pallet") return 2;
    return 3;
  };
  const eligible = inventory
    .filter(isOutboundTemplateEligible)
    .sort((a, b) => {
      const byType = stockTypeRank(a) - stockTypeRank(b);
      if (byType !== 0) return byType;
      return String(a.productName || "").localeCompare(String(b.productName || ""));
    });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PrepCorex";
  workbook.created = new Date();

  const instructions = workbook.addWorksheet(INSTRUCTIONS_SHEET);
  instructions.getColumn(1).width = 100;
  const instructionLines = [
    "PrepCorex — Outbound shipment bulk import",
    "",
    "How to use",
    "1. Open the Outbound sheet (warehouse stock only — marketplace Other resources are excluded).",
    "2. Stock Type shows product / box / pallet. Use matching Service:",
    "   • Product → FBA/WFS/TFS or DTC/FBM",
    "   • Box → Carton Forwarding",
    "   • Pallet → Pallet Forwarding",
    "3. Fill Quantity, Pack Of, Service, Shipping Date, Shipment Preference on rows you want to ship.",
    "4. Use dropdowns for Service, Preference, Product Type, Lot Selection, and Lot 1/2/3.",
    "5. Shipping Date: use the calendar picker or type YYYY-MM-DD / MM/DD/YYYY / DD/MM/YYYY.",
    "",
    "Lot Selection (same as create-shipment form)",
    "• Auto (FEFO if expiry) — default",
    "• FEFO — first expire",
    "• FIFO — first received",
    "• Choose lots… — then pick up to 3 lots from the Lot 1 / Lot 2 / Lot 3 dropdowns",
    "  (each dropdown lists that product's expiry lots) and type the Qty next to each.",
    "  Example: Lot 1 = 2026-03-15 (avail 12), Lot 1 Qty = 5",
    "",
    "Multiple pack lines for the same product",
    "• Copy a row (or use Extra rows at the bottom) and change Quantity / Pack Of.",
    "• Same Service + Date + Preference (+ Remarks) → one request with multiple pack lines.",
    "",
    "Remaining Quantity",
    "• Line Units = Quantity × Pack Of.",
    "• Remaining = Available − all Line Units for that Product ID (including duplicates).",
    "",
    "Upload the filled .xlsx in PrepCorex → Create shipment → Bulk import.",
  ];
  instructionLines.forEach((line, i) => {
    const cell = instructions.getCell(i + 1, 1);
    cell.value = line;
    if (i === 0) cell.font = { bold: true, size: 14 };
    if (
      line === "How to use" ||
      line === "Lot Selection (same as create-shipment form)" ||
      line === "Multiple pack lines for the same product" ||
      line === "Remaining Quantity"
    ) {
      cell.font = { bold: true, size: 12 };
    }
  });

  const lists = workbook.addWorksheet(LISTS_SHEET);
  lists.state = "hidden";
  OUTBOUND_SERVICE_OPTIONS.forEach((v, i) => {
    lists.getCell(i + 1, 1).value = v;
  });
  OUTBOUND_PREFERENCE_OPTIONS.forEach((v, i) => {
    lists.getCell(i + 1, 2).value = v;
  });
  OUTBOUND_PRODUCT_TYPE_OPTIONS.forEach((v, i) => {
    lists.getCell(i + 1, 3).value = v;
  });
  eligible.forEach((item, i) => {
    lists.getCell(i + 1, 4).value = item.id;
  });
  OUTBOUND_LOT_SELECTION_OPTIONS.forEach((v, i) => {
    lists.getCell(i + 1, 5).value = v;
  });

  // Per-product lot dropdown lists (one column per product row), same pattern as inventory History lists
  const LOT_LISTS_SHEET = "LotLists";
  const lotLists = workbook.addWorksheet(LOT_LISTS_SHEET);
  lotLists.state = "hidden";
  const lotCountByProductIndex: number[] = [];
  eligible.forEach((item, index) => {
    const options = productLotOptions(item);
    lotCountByProductIndex[index] = options.length;
    const col = index + 1;
    options.forEach((opt, optIndex) => {
      lotLists.getCell(optIndex + 1, col).value = opt.label;
    });
  });

  const sheet = workbook.addWorksheet(SHEET_NAME, {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  // A..V
  sheet.columns = [
    { header: "Product ID", key: "productId", width: 28 },
    { header: "SKU", key: "sku", width: 20 },
    { header: "Product Name", key: "productName", width: 32 },
    { header: "Stock Type", key: "stockType", width: 12 },
    { header: "Available Quantity", key: "available", width: 14 },
    { header: "Available Lots", key: "availableLots", width: 28 },
    { header: "Quantity", key: "quantity", width: 10 },
    { header: "Pack Of", key: "packOf", width: 10 },
    { header: "Line Units", key: "lineUnits", width: 11 },
    { header: "Remaining Quantity", key: "remaining", width: 14 },
    { header: "Service", key: "service", width: 18 },
    { header: "Shipping Date", key: "shippingDate", width: 14 },
    { header: "Shipment Preference", key: "preference", width: 16 },
    { header: "Product Type", key: "productType", width: 12 },
    { header: "Lot Selection", key: "lotSelection", width: 22 },
    { header: "Lot 1", key: "lot1", width: 22 },
    { header: "Lot 1 Qty", key: "lot1Qty", width: 10 },
    { header: "Lot 2", key: "lot2", width: 22 },
    { header: "Lot 2 Qty", key: "lot2Qty", width: 10 },
    { header: "Lot 3", key: "lot3", width: 22 },
    { header: "Lot 3 Qty", key: "lot3Qty", width: 10 },
    { header: "Remarks", key: "remarks", width: 24 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle", wrapText: true };
  headerRow.height = 32;

  const productCount = eligible.length;
  const totalDataRows = productCount + EXTRA_PACK_LINE_ROWS;
  const lastDataRow = totalDataRows + 1;

  const colProductId = colLetter(1);
  const colAvailable = colLetter(5); // E
  const colQty = colLetter(7); // G
  const colPack = colLetter(8); // H
  const colLineUnits = colLetter(9); // I

  const applyLotDropdowns = (excelRow: number, productIndex: number) => {
    const lotCount = lotCountByProductIndex[productIndex] ?? 0;
    if (lotCount <= 0) return;
    const letter = colLetter(productIndex + 1);
    const formula = `${LOT_LISTS_SHEET}!$${letter}$1:$${letter}$${lotCount}`;
    for (const lotCol of [16, 18, 20]) {
      sheet.getCell(excelRow, lotCol).dataValidation = {
        type: "list",
        allowBlank: true,
        showErrorMessage: true,
        errorTitle: "Lot",
        error: "Pick a lot from this product's list, or leave blank.",
        formulae: [formula],
        promptTitle: "Choose lot",
        prompt: "Shown when Lot Selection = Choose lots… Pick expiry lot, then enter Qty beside it.",
        showInputMessage: true,
      };
    }
  };

  eligible.forEach((item, index) => {
    const excelRow = index + 2;
    const stockType = inventoryStockType(item) || "product";
    const row = sheet.getRow(excelRow);
    row.values = [
      item.id,
      String(item.sku ?? "").trim(),
      item.productName,
      stockType,
      Number(item.quantity) || 0,
      formatAvailableLots(item) || "",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      stockType === "product" ? "Standard" : "",
      lotSelectionLabel("auto"),
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ];

    sheet.getCell(excelRow, 9).value = {
      formula: `IF(OR(${colQty}${excelRow}="",${colQty}${excelRow}=0),"",${colQty}${excelRow}*IF(OR(${colPack}${excelRow}="",${colPack}${excelRow}=0),1,${colPack}${excelRow}))`,
    };
    sheet.getCell(excelRow, 10).value = {
      formula: `IF(${colProductId}${excelRow}="","",${colAvailable}${excelRow}-SUMIF($${colProductId}$2:$${colProductId}$${lastDataRow},${colProductId}${excelRow},$${colLineUnits}$2:$${colLineUnits}$${lastDataRow}))`,
    };

    applyLotDropdowns(excelRow, index);

    row.getCell(5).numFmt = "0";
    row.getCell(7).numFmt = "0";
    row.getCell(8).numFmt = "0";
    row.getCell(9).numFmt = "0";
    row.getCell(10).numFmt = "0";
    row.getCell(12).numFmt = "yyyy-mm-dd";
    row.getCell(17).numFmt = "0";
    row.getCell(19).numFmt = "0";
    row.getCell(21).numFmt = "0";
  });

  for (let i = 0; i < EXTRA_PACK_LINE_ROWS; i++) {
    const excelRow = productCount + 2 + i;
    const row = sheet.getRow(excelRow);
    row.values = [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      "Standard",
      lotSelectionLabel("auto"),
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ];

    if (productCount > 0) {
      sheet.getCell(excelRow, 1).dataValidation = {
        type: "list",
        allowBlank: true,
        showErrorMessage: true,
        errorTitle: "Product ID",
        error: "Choose a Product ID from the list, or copy a product row from above.",
        formulae: [`${LISTS_SHEET}!$D$1:$D$${productCount}`],
      };
      // VLOOKUP into prefilled block: cols A-F (id, sku, name, stock type, available, lots)
      sheet.getCell(excelRow, 2).value = {
        formula: `IF(${colProductId}${excelRow}="","",IFERROR(VLOOKUP(${colProductId}${excelRow},$A$2:$F$${productCount + 1},2,FALSE),""))`,
      };
      sheet.getCell(excelRow, 3).value = {
        formula: `IF(${colProductId}${excelRow}="","",IFERROR(VLOOKUP(${colProductId}${excelRow},$A$2:$F$${productCount + 1},3,FALSE),""))`,
      };
      sheet.getCell(excelRow, 4).value = {
        formula: `IF(${colProductId}${excelRow}="","",IFERROR(VLOOKUP(${colProductId}${excelRow},$A$2:$F$${productCount + 1},4,FALSE),""))`,
      };
      sheet.getCell(excelRow, 5).value = {
        formula: `IF(${colProductId}${excelRow}="","",IFERROR(VLOOKUP(${colProductId}${excelRow},$A$2:$F$${productCount + 1},5,FALSE),""))`,
      };
      sheet.getCell(excelRow, 6).value = {
        formula: `IF(${colProductId}${excelRow}="","",IFERROR(VLOOKUP(${colProductId}${excelRow},$A$2:$F$${productCount + 1},6,FALSE),""))`,
      };
    }

    sheet.getCell(excelRow, 9).value = {
      formula: `IF(OR(${colQty}${excelRow}="",${colQty}${excelRow}=0),"",${colQty}${excelRow}*IF(OR(${colPack}${excelRow}="",${colPack}${excelRow}=0),1,${colPack}${excelRow}))`,
    };
    sheet.getCell(excelRow, 10).value = {
      formula: `IF(${colProductId}${excelRow}="","",IF(${colAvailable}${excelRow}="","",${colAvailable}${excelRow}-SUMIF($${colProductId}$2:$${colProductId}$${lastDataRow},${colProductId}${excelRow},$${colLineUnits}$2:$${colLineUnits}$${lastDataRow})))`,
    };

    row.getCell(5).numFmt = "0";
    row.getCell(7).numFmt = "0";
    row.getCell(8).numFmt = "0";
    row.getCell(9).numFmt = "0";
    row.getCell(10).numFmt = "0";
    row.getCell(12).numFmt = "yyyy-mm-dd";
    row.getCell(17).numFmt = "0";
    row.getCell(19).numFmt = "0";
    row.getCell(21).numFmt = "0";
  }

  for (let excelRow = 2; excelRow <= lastDataRow; excelRow++) {
    sheet.getCell(excelRow, 11).dataValidation = {
      type: "list",
      allowBlank: true,
      showErrorMessage: true,
      errorTitle: "Service",
      error: "Choose FBA/WFS/TFS, DTC/FBM, Carton Forwarding, or Pallet Forwarding.",
      formulae: [`${LISTS_SHEET}!$A$1:$A$${OUTBOUND_SERVICE_OPTIONS.length}`],
    };
    sheet.getCell(excelRow, 13).dataValidation = {
      type: "list",
      allowBlank: true,
      showErrorMessage: true,
      errorTitle: "Shipment Preference",
      error: "Choose SPD or LTL from the list.",
      formulae: [`${LISTS_SHEET}!$B$1:$B$${OUTBOUND_PREFERENCE_OPTIONS.length}`],
    };
    sheet.getCell(excelRow, 14).dataValidation = {
      type: "list",
      allowBlank: true,
      showErrorMessage: true,
      errorTitle: "Product Type",
      error: "Choose Standard or Custom from the list.",
      formulae: [`${LISTS_SHEET}!$C$1:$C$${OUTBOUND_PRODUCT_TYPE_OPTIONS.length}`],
    };
    sheet.getCell(excelRow, 15).dataValidation = {
      type: "list",
      allowBlank: true,
      showErrorMessage: true,
      errorTitle: "Lot Selection",
      error: "Choose Auto, FEFO, FIFO, or Choose lots…",
      formulae: [`${LISTS_SHEET}!$E$1:$E$${OUTBOUND_LOT_SELECTION_OPTIONS.length}`],
      promptTitle: "Lot Selection",
      prompt: "For Choose lots… use Lot 1/2/3 dropdowns + Qty columns.",
      showInputMessage: true,
    };
    sheet.getCell(excelRow, 7).dataValidation = {
      type: "whole",
      operator: "greaterThan",
      formulae: [0],
      allowBlank: true,
      showErrorMessage: true,
      errorTitle: "Quantity",
      error: "Enter a positive whole number, or leave blank to skip this row.",
    };
    sheet.getCell(excelRow, 8).dataValidation = {
      type: "whole",
      operator: "greaterThan",
      formulae: [0],
      allowBlank: true,
      showErrorMessage: true,
      errorTitle: "Pack Of",
      error: "Enter a positive whole number (units per pack). Blank defaults to 1.",
    };
    for (const qtyCol of [17, 19, 21]) {
      sheet.getCell(excelRow, qtyCol).dataValidation = {
        type: "whole",
        operator: "greaterThan",
        formulae: [0],
        allowBlank: true,
        showErrorMessage: true,
        errorTitle: "Lot Qty",
        error: "Enter units to take from the chosen lot.",
      };
    }
    sheet.getCell(excelRow, 12).dataValidation = {
      type: "date",
      operator: "greaterThan",
      formulae: [new Date(2000, 0, 1)],
      allowBlank: true,
      showErrorMessage: true,
      errorTitle: "Shipping Date",
      error: "Pick a date from the calendar or type a valid date.",
      promptTitle: "Shipping Date",
      prompt: "Use the date picker or type YYYY-MM-DD / MM/DD/YYYY / DD/MM/YYYY.",
      showInputMessage: true,
    };
  }

  for (let excelRow = 2; excelRow <= lastDataRow; excelRow++) {
    for (const col of [7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]) {
      sheet.getCell(excelRow, col).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFF8E7" },
      };
    }
    for (const col of [4, 5, 6, 9, 10]) {
      sheet.getCell(excelRow, col).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF3F4F6" },
      };
    }
  }

  return workbook.xlsx.writeBuffer();
}

export async function downloadOutboundBulkTemplate(inventory: InventoryItem[]): Promise<void> {
  const buffer = await buildOutboundBulkWorkbook(inventory);
  downloadExcelBuffer(buffer, "outbound-shipment-template.xlsx");
}

/** Legacy CSV template (no dropdowns) — kept for tooling/tests. */
export function downloadOutboundBulkTemplateCsv(inventory: InventoryItem[]): void {
  const eligible = inventory
    .filter(isOutboundTemplateEligible)
    .sort((a, b) => String(a.productName || "").localeCompare(String(b.productName || "")));

  const lines = [
    OUTBOUND_BULK_CSV_HEADERS.join(","),
    ...eligible.map((item) => {
      const row: OutboundBulkCsvRow = {
        "Product ID": item.id,
        SKU: String(item.sku ?? "").trim(),
        "Product Name": item.productName,
        "Stock Type": inventoryStockType(item) || "product",
        "Available Quantity": String(item.quantity),
        "Available Lots": formatAvailableLots(item),
        Quantity: "",
        "Pack Of": "",
        "Line Units": "",
        "Remaining Quantity": "",
        Service: "",
        "Shipping Date": "",
        "Shipment Preference": "",
        "Product Type": inventoryStockType(item) === "product" ? "Standard" : "",
        "Lot Selection": lotSelectionLabel("auto"),
        "Lot 1": "",
        "Lot 1 Qty": "",
        "Lot 2": "",
        "Lot 2 Qty": "",
        "Lot 3": "",
        "Lot 3 Qty": "",
        Remarks: "",
      };
      return OUTBOUND_BULK_CSV_HEADERS.map((h) => escapeCsvCell(row[h])).join(",");
    }),
  ];

  downloadCSV("\uFEFF" + lines.join("\n"), "outbound-shipment-template.csv");
}
