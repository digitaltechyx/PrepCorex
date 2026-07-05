import { Timestamp } from "firebase/firestore";
import type { ServiceType, UserPricing, InventoryItem } from "@/types";
import { DTC_FBM_SERVICE, normalizeStoredServiceType } from "@/types";
import { downloadCSV } from "@/lib/csv-utils";
import { FBA_SERVICE } from "@/lib/fba-shipment-workflow";
import {
  calculatePrepUnitPrice,
  type FbaPackAddOnConfig,
} from "@/lib/pricing-utils";

export const OUTBOUND_BULK_CSV_HEADERS = [
  "Product ID",
  "SKU",
  "Product Name",
  "Current Quantity",
  "Service",
  "Shipping Date",
  "Shipment Preference",
  "Quantity",
  "Pack Of",
  "Remarks",
] as const;

export type OutboundBulkCsvRow = Record<(typeof OUTBOUND_BULK_CSV_HEADERS)[number], string>;

export type OutboundBulkValidatedRow = {
  rowNumber: number;
  service: ServiceType;
  shippingDate: Date;
  shipmentPreference: "box" | "pallet";
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  packOf: number;
  unitPrice: number;
  totalPrice: number;
  remarks?: string;
};

export type OutboundBulkRowError = {
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
  const headerIndex = new Map<string, number>();
  headerCells.forEach((cell, idx) => headerIndex.set(normHeader(cell), idx));

  for (const required of OUTBOUND_BULK_CSV_HEADERS) {
    if (!headerIndex.has(normHeader(required))) {
      errors.push(`Missing required column: "${required}".`);
    }
  }
  if (errors.length > 0) return { rows: [], errors };

  const rows: OutboundBulkCsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const row = {} as OutboundBulkCsvRow;
    for (const header of OUTBOUND_BULK_CSV_HEADERS) {
      const idx = headerIndex.get(normHeader(header))!;
      row[header] = (cells[idx] ?? "").trim();
    }
    if (OUTBOUND_BULK_CSV_HEADERS.every((h) => !row[h])) continue;
    rows.push(row);
  }

  if (rows.length === 0) errors.push("No data rows found.");
  return { rows, errors };
}

function normalizeService(raw: string): ServiceType | null {
  const v = raw.trim();
  const upper = v.toUpperCase();
  if (upper === "FBA/WFS/TFS" || upper === "FBA" || upper === "WFS" || upper === "TFS") {
    return "FBA/WFS/TFS";
  }
  if (upper === "FBM" || upper === "DTC/FBM" || v === "DTC/FBM") {
    return DTC_FBM_SERVICE;
  }
  return normalizeStoredServiceType(v);
}

function normalizePreference(raw: string): "box" | "pallet" | null {
  const v = raw.trim().toLowerCase();
  if (v === "box" || v === "carton" || v === "spd") return "box";
  if (v === "pallet" || v === "ltl") return "pallet";
  return null;
}

function parseShippingDate(raw: string): Date | "invalid" {
  if (!raw.trim()) return "invalid";
  const d = new Date(`${raw.trim()}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "invalid";
  return d;
}

/** Sellable product rows only (excludes box/container/pallet inventory types). */
export function isOutboundTemplateEligible(item: InventoryItem): boolean {
  const inventoryType = (item as InventoryItem & { inventoryType?: string }).inventoryType;
  if (inventoryType === "box" || inventoryType === "container" || inventoryType === "pallet") {
    return false;
  }
  return Number(item.quantity) > 0;
}

export function computeOutboundLinePricing(
  pricingRules: UserPricing[],
  service: ServiceType,
  quantity: number,
  packOf: number,
  packConfig?: FbaPackAddOnConfig
): { unitPrice: number; totalPrice: number } {
  const calculated = calculatePrepUnitPrice(
    pricingRules,
    service,
    "Standard",
    quantity,
    packOf,
    packConfig
  );
  const unitPrice = calculated?.rate ?? 0;
  if (unitPrice <= 0 || quantity <= 0) {
    return { unitPrice: 0, totalPrice: 0 };
  }
  const baseTotal = unitPrice * quantity;
  const packCharge = calculated?.packOf ?? 0;
  return {
    unitPrice,
    totalPrice: parseFloat((baseTotal + packCharge).toFixed(2)),
  };
}

export function validateOutboundBulkRows(
  csvRows: OutboundBulkCsvRow[],
  context: {
    inventory: InventoryItem[];
    pricingRules: UserPricing[];
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

    const quantity = Number.parseInt(quantityRaw, 10);
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

    const csvCurrentQty = Number.parseInt(raw["Current Quantity"].trim(), 10);
    const liveQty = Number(product.quantity) || 0;
    if (Number.isFinite(csvCurrentQty) && csvCurrentQty !== liveQty) {
      warnings.push({
        rowNumber,
        message: `Current Quantity in file (${csvCurrentQty}) differs from live stock (${liveQty}). Using live quantity.`,
      });
    }

    const service = normalizeService(raw.Service);
    if (!service) {
      errors.push({
        rowNumber,
        message: 'Service must be "FBA/WFS/TFS" or "DTC/FBM".',
      });
      return;
    }

    const shippingDate = parseShippingDate(raw["Shipping Date"]);
    if (shippingDate === "invalid") {
      errors.push({ rowNumber, message: "Shipping Date must be YYYY-MM-DD." });
      return;
    }

    const shipmentPreference = normalizePreference(raw["Shipment Preference"]);
    if (!shipmentPreference) {
      errors.push({ rowNumber, message: 'Shipment Preference must be "SPD" or "LTL".' });
      return;
    }

    const packOfRaw = raw["Pack Of"].trim();
    const packOf = packOfRaw ? Number.parseInt(packOfRaw, 10) : 1;
    if (Number.isNaN(packOf) || packOf <= 0) {
      errors.push({ rowNumber, message: "Pack Of must be a positive whole number when provided." });
      return;
    }

    const totalUnits = quantity * packOf;
    const alreadyRequested = shipDemandByProduct.get(product.id) ?? 0;
    const cumulativeUnits = alreadyRequested + totalUnits;
    if (cumulativeUnits > liveQty) {
      errors.push({
        rowNumber,
        message: `Insufficient stock for "${product.productName}": requested ${cumulativeUnits}, available ${liveQty}.`,
      });
      return;
    }
    shipDemandByProduct.set(product.id, cumulativeUnits);

    const { unitPrice, totalPrice } = computeOutboundLinePricing(
      context.pricingRules,
      service,
      quantity,
      packOf,
      context.packConfig
    );

    valid.push({
      rowNumber,
      service,
      shippingDate,
      shipmentPreference,
      productId: product.id,
      productName: product.productName,
      sku: String(product.sku ?? sku),
      quantity,
      packOf,
      unitPrice,
      totalPrice,
      remarks: raw.Remarks.trim() || undefined,
    });
  });

  if (valid.length === 0 && errors.length === 0) {
    errors.push("Add Quantity on at least one row for products you want to ship.");
  }

  return { valid, errors, warnings };
}

export function outboundBulkRowToFirestoreDoc(
  row: OutboundBulkValidatedRow,
  context: {
    ownerId: string;
    ownerDisplayName: string;
    requestedAt: Timestamp;
  }
): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    userId: context.ownerId,
    userName: context.ownerDisplayName,
    date: Timestamp.fromDate(row.shippingDate),
    remarks: row.remarks,
    shipmentType: "product",
    shipmentPreference: row.shipmentPreference,
    service: row.service,
    productType: "Standard",
    labelUrl: "",
    status: "pending",
    requestedBy: context.ownerId,
    requestedAt: context.requestedAt,
    shipments: [
      {
        productId: row.productId,
        quantity: row.quantity,
        packOf: row.packOf,
        unitPrice: row.unitPrice,
      },
    ],
  };

  if (row.service === FBA_SERVICE) {
    doc.fbaLabelWorkflow = true;
  }

  return doc;
}

export function downloadOutboundBulkTemplate(inventory: InventoryItem[]): void {
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
        "Current Quantity": String(item.quantity),
        Service: "",
        "Shipping Date": "",
        "Shipment Preference": "",
        Quantity: "",
        "Pack Of": "",
        Remarks: "",
      };
      return OUTBOUND_BULK_CSV_HEADERS.map((h) => escapeCsvCell(row[h])).join(",");
    }),
  ];

  downloadCSV("\uFEFF" + lines.join("\n"), "outbound-shipment-template.csv");
}
