import { downloadCSV } from "@/lib/csv-utils";
import {
  locationToFromShippingAddress,
  normalizeShippingAddressForShippo,
  shippingAddressesMatch,
  type LocationShippingInput,
} from "@/lib/location-shipping-address";
import type { ParcelDetails, ShippingAddress, ShippingRate } from "@/types";

/** Fixed shipper name on Buy Labels from address (warehouse sender). */
export const BUY_LABELS_FROM_NAME = "Prep Services FBA";

/** CSV columns mirror the Buy Labels form field labels (no extra metadata columns). */
export const BUY_LABELS_BULK_CSV_HEADERS = [
  "From Name",
  "From Phone",
  "From Street Address",
  "From Apartment Suite",
  "From Country",
  "From State",
  "From City",
  "From ZIP Code",
  "To Name",
  "To Phone",
  "To Street Address",
  "To Apartment Suite",
  "To Country",
  "To State",
  "To City",
  "To ZIP Code",
  "Weight (lbs)",
  "Weight (oz)",
  "Length",
  "Width",
  "Height",
  "Distance Unit",
] as const;

export type BuyLabelsBulkCsvRow = Record<(typeof BUY_LABELS_BULK_CSV_HEADERS)[number], string>;

export type BuyLabelLocationInput = LocationShippingInput & { id: string };

export type BuyLabelsBulkValidatedRow = {
  rowNumber: number;
  locationId: string;
  fromAddress: ShippingAddress;
  toAddress: ShippingAddress;
  parcel: ParcelDetails & { weight: number; weightUnit: "lb" };
};

export type BuyLabelsBulkRowError = {
  rowNumber: number;
  message: string;
};

const DISTANCE_UNITS = new Set(["in", "ft", "cm", "m"]);

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

export function locationToFromAddress(
  location: BuyLabelLocationInput,
  fromName: string,
  fromPhone = ""
): ShippingAddress {
  return locationToFromShippingAddress(location, {
    shipperName: fromName.trim() || BUY_LABELS_FROM_NAME,
    phone: fromPhone,
  });
}

export function parseBuyLabelsBulkCsv(text: string): {
  rows: BuyLabelsBulkCsvRow[];
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

  for (const required of BUY_LABELS_BULK_CSV_HEADERS) {
    if (!headerIndex.has(normHeader(required))) {
      errors.push(`Missing required column: "${required}".`);
    }
  }
  if (errors.length > 0) return { rows: [], errors };

  const rows: BuyLabelsBulkCsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const row = {} as BuyLabelsBulkCsvRow;
    for (const header of BUY_LABELS_BULK_CSV_HEADERS) {
      const idx = headerIndex.get(normHeader(header))!;
      row[header] = (cells[idx] ?? "").trim();
    }
    if (!row["To Name"] && !row["To Street Address"] && !row["To City"]) continue;
    rows.push(row);
  }

  if (rows.length === 0) errors.push("No shipment rows found. Fill in To address on at least one row.");
  return { rows, errors };
}

function parsePositiveNumber(raw: string): number | "invalid" {
  const v = raw.trim();
  if (!v) return "invalid";
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "invalid";
  return n;
}

function parseNonNegativeNumber(raw: string): number {
  const v = raw.trim();
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function buildFromAddressFromRow(row: BuyLabelsBulkCsvRow): ShippingAddress | null {
  const name = row["From Name"].trim();
  const street1 = row["From Street Address"].trim();
  const city = row["From City"].trim();
  const state = row["From State"].trim();
  const zip = row["From ZIP Code"].trim();
  const country = row["From Country"].trim() || "US";

  if (!name || !street1 || !city || !state || !zip) return null;

  return normalizeShippingAddressForShippo({
    name,
    street1,
    street2: row["From Apartment Suite"].trim() || undefined,
    city,
    state,
    zip,
    country,
    phone: row["From Phone"].trim() || undefined,
  });
}

function buildToAddressFromRow(row: BuyLabelsBulkCsvRow): ShippingAddress | null {
  const name = row["To Name"].trim();
  const street1 = row["To Street Address"].trim();
  const city = row["To City"].trim();
  const state = row["To State"].trim();
  const zip = row["To ZIP Code"].trim();
  const country = row["To Country"].trim() || "US";

  if (!name || !street1 || !city || !state || !zip) return null;

  return normalizeShippingAddressForShippo({
    name,
    street1,
    street2: row["To Apartment Suite"].trim() || undefined,
    city,
    state,
    zip,
    country,
    phone: row["To Phone"].trim() || undefined,
  });
}

function findMatchingLocation(
  fromAddress: ShippingAddress,
  locations: BuyLabelLocationInput[],
  options: {
    defaultFromName: string;
    defaultFromPhone?: string;
  }
): BuyLabelLocationInput | null {
  for (const location of locations) {
    const expected = locationToFromAddress(
      location,
      BUY_LABELS_FROM_NAME,
      fromAddress.phone || options.defaultFromPhone
    );
    if (shippingAddressesMatch(fromAddress, expected)) {
      return location;
    }
  }
  return null;
}

export function validateBuyLabelsBulkRows(
  rows: BuyLabelsBulkCsvRow[],
  options: {
    locations: BuyLabelLocationInput[];
    defaultFromName: string;
    defaultFromPhone?: string;
    templateLocationId?: string;
  }
): {
  valid: BuyLabelsBulkValidatedRow[];
  errors: BuyLabelsBulkRowError[];
  warnings: BuyLabelsBulkRowError[];
} {
  const valid: BuyLabelsBulkValidatedRow[] = [];
  const errors: BuyLabelsBulkRowError[] = [];
  const warnings: BuyLabelsBulkRowError[] = [];

  const templateLocation = options.templateLocationId
    ? options.locations.find((loc) => loc.id === options.templateLocationId)
    : undefined;

  rows.forEach((row, index) => {
    const rowNumber = index + 2;

    const fromAddress = buildFromAddressFromRow(row);
    if (!fromAddress) {
      errors.push({ rowNumber, message: "From address is incomplete. Re-download the template." });
      return;
    }

    let matchedLocation = findMatchingLocation(fromAddress, options.locations, {
      defaultFromName: options.defaultFromName,
      defaultFromPhone: options.defaultFromPhone,
    });

    if (!matchedLocation && templateLocation) {
      const expectedFromTemplate = locationToFromAddress(
        templateLocation,
        BUY_LABELS_FROM_NAME,
        row["From Phone"].trim() || options.defaultFromPhone
      );
      if (shippingAddressesMatch(fromAddress, expectedFromTemplate)) {
        matchedLocation = templateLocation;
      }
    }

    if (!matchedLocation) {
      errors.push({
        rowNumber,
        message: "From address does not match your selected warehouse location. Re-download the template.",
      });
      return;
    }

    const canonicalFrom = locationToFromAddress(
      matchedLocation,
      BUY_LABELS_FROM_NAME,
      row["From Phone"].trim() || options.defaultFromPhone
    );

    if (row["From Name"].trim() && row["From Name"].trim() !== BUY_LABELS_FROM_NAME) {
      warnings.push({
        rowNumber,
        message: `From Name set to "${BUY_LABELS_FROM_NAME}".`,
      });
    }

    if (!shippingAddressesMatch(fromAddress, canonicalFrom)) {
      warnings.push({
        rowNumber,
        message: "From address adjusted to match the warehouse location on file.",
      });
    }

    const toAddress = buildToAddressFromRow(row);
    if (!toAddress) {
      errors.push({
        rowNumber,
        message: "To address is incomplete (Name, Street Address, City, State, ZIP Code required).",
      });
      return;
    }

    const length = parsePositiveNumber(row.Length);
    const width = parsePositiveNumber(row.Width);
    const height = parsePositiveNumber(row.Height);
    if (length === "invalid" || width === "invalid" || height === "invalid") {
      errors.push({ rowNumber, message: "Length, Width, and Height must be positive numbers." });
      return;
    }

    const distanceUnitRaw = row["Distance Unit"].trim().toLowerCase() || "in";
    if (!DISTANCE_UNITS.has(distanceUnitRaw)) {
      errors.push({ rowNumber, message: "Distance Unit must be one of: in, ft, cm, m." });
      return;
    }

    const weightPounds = parseNonNegativeNumber(row["Weight (lbs)"]);
    const weightOunces = parseNonNegativeNumber(row["Weight (oz)"]);
    const totalWeightOunces = weightPounds * 16 + weightOunces;
    if (totalWeightOunces <= 0) {
      errors.push({ rowNumber, message: "Total weight must be greater than 0." });
      return;
    }
    if (weightPounds > 70) {
      errors.push({ rowNumber, message: "Weight cannot exceed 70 lbs." });
      return;
    }
    if (weightOunces > 15.999) {
      errors.push({ rowNumber, message: "Weight (oz) cannot exceed 15.999." });
      return;
    }

    const totalWeightPounds = totalWeightOunces / 16;

    valid.push({
      rowNumber,
      locationId: matchedLocation.id,
      fromAddress: canonicalFrom,
      toAddress,
      parcel: {
        length,
        width,
        height,
        weight: totalWeightPounds,
        weightUnit: "lb",
        distanceUnit: distanceUnitRaw as ParcelDetails["distanceUnit"],
      },
    });
  });

  return { valid, errors, warnings };
}

export function pickShippingRate(rates: ShippingRate[]): ShippingRate | null {
  if (rates.length === 0) return null;
  return rates.reduce((best, rate) =>
    parseFloat(rate.amount) < parseFloat(best.amount) ? rate : best
  );
}

export function downloadBuyLabelsBulkTemplate(
  location: BuyLabelLocationInput,
  options?: {
    fromName?: string;
    fromPhone?: string;
    sampleRows?: number;
  }
): void {
  const from = locationToFromAddress(
    location,
    options?.fromName?.trim() || BUY_LABELS_FROM_NAME,
    options?.fromPhone?.trim() || ""
  );
  const sampleCount = Math.max(1, options?.sampleRows ?? 5);

  const blankRowFields = {
    "To Name": "",
    "To Phone": "",
    "To Street Address": "",
    "To Apartment Suite": "",
    "To Country": "US",
    "To State": "",
    "To City": "",
    "To ZIP Code": "",
    "Weight (lbs)": "0",
    "Weight (oz)": "13",
    Length: "15",
    Width: "4",
    Height: "4",
    "Distance Unit": "in",
  };

  const lines = [
    BUY_LABELS_BULK_CSV_HEADERS.join(","),
    ...Array.from({ length: sampleCount }, () => {
      const row: BuyLabelsBulkCsvRow = {
        "From Name": from.name,
        "From Phone": from.phone || "",
        "From Street Address": from.street1,
        "From Apartment Suite": from.street2 || "",
        "From Country": from.country,
        "From State": from.state,
        "From City": from.city,
        "From ZIP Code": from.zip,
        ...blankRowFields,
      };
      return BUY_LABELS_BULK_CSV_HEADERS.map((h) => escapeCsvCell(row[h])).join(",");
    }),
  ];

  const slug = String(location.name ?? location.id)
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  downloadCSV("\uFEFF" + lines.join("\n"), `buy-labels-template${slug ? `-${slug}` : ""}.csv`);
}
