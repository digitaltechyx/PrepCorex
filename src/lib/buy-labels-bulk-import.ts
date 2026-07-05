import { downloadCSV } from "@/lib/csv-utils";
import type { ParcelDetails, ShippingAddress, ShippingRate } from "@/types";

export const BUY_LABELS_BULK_CSV_HEADERS = [
  "Location ID",
  "Location Name",
  "From Name",
  "From Street 1",
  "From Street 2",
  "From City",
  "From State",
  "From ZIP",
  "From Country",
  "From Phone",
  "From Email",
  "To Name",
  "To Street 1",
  "To Street 2",
  "To City",
  "To State",
  "To ZIP",
  "To Country",
  "To Phone",
  "To Email",
  "Length",
  "Width",
  "Height",
  "Distance Unit",
  "Weight Pounds",
  "Weight Ounces",
  "Preferred Carrier",
  "Preferred Service",
] as const;

export type BuyLabelsBulkCsvRow = Record<(typeof BUY_LABELS_BULK_CSV_HEADERS)[number], string>;

export type BuyLabelLocationInput = {
  id: string;
  name?: string;
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  stateOrProvince?: string;
  zip?: string;
  country?: string;
};

export type BuyLabelsBulkValidatedRow = {
  rowNumber: number;
  locationId: string;
  fromAddress: ShippingAddress;
  toAddress: ShippingAddress;
  parcel: ParcelDetails & { weight: number; weightUnit: "lb" };
  preferredCarrier?: string;
  preferredService?: string;
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

function normField(v: string): string {
  return v.trim().toLowerCase();
}

export function locationToFromAddress(
  location: BuyLabelLocationInput,
  fromName: string,
  fromPhone = "",
  fromEmail = ""
): ShippingAddress {
  const stateValue = (location.stateOrProvince || location.state || "").trim();
  return {
    name: fromName.trim() || "Prep Services FBA LLC",
    street1: (location.street1 || "").trim(),
    street2: (location.street2 || "").trim() || undefined,
    city: (location.city || "").trim(),
    state: stateValue,
    zip: (location.zip || "").trim(),
    country: (location.country || "US").trim() || "US",
    phone: fromPhone.trim() || undefined,
    email: fromEmail.trim() || undefined,
  };
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
    if (!row["To Name"] && !row["To Street 1"] && !row["To City"]) continue;
    rows.push(row);
  }

  if (rows.length === 0) errors.push("No shipment rows found. Fill in To address on at least one row.");
  return { rows, errors };
}

function parsePositiveNumber(raw: string, label: string): number | "invalid" {
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

function buildAddressFromRow(
  prefix: "From" | "To",
  row: BuyLabelsBulkCsvRow
): ShippingAddress | null {
  const name = row[`${prefix} Name`].trim();
  const street1 = row[`${prefix} Street 1`].trim();
  const city = row[`${prefix} City`].trim();
  const state = row[`${prefix} State`].trim();
  const zip = row[`${prefix} ZIP`].trim();
  const country = row[`${prefix} Country`].trim() || "US";

  if (!name || !street1 || !city || !state || !zip) return null;

  return {
    name,
    street1,
    street2: row[`${prefix} Street 2`].trim() || undefined,
    city,
    state,
    zip,
    country,
    phone: row[`${prefix} Phone`].trim() || undefined,
    email: row[`${prefix} Email`].trim() || undefined,
  };
}

function addressesMatch(a: ShippingAddress, b: ShippingAddress): boolean {
  return (
    normField(a.name) === normField(b.name) &&
    normField(a.street1) === normField(b.street1) &&
    normField(a.street2 || "") === normField(b.street2 || "") &&
    normField(a.city) === normField(b.city) &&
    normField(a.state) === normField(b.state) &&
    normField(a.zip) === normField(b.zip) &&
    normField(a.country) === normField(b.country)
  );
}

export function validateBuyLabelsBulkRows(
  rows: BuyLabelsBulkCsvRow[],
  options: {
    allowedLocationIds: string[];
    locationsById: Map<string, BuyLabelLocationInput>;
    defaultFromName: string;
    defaultFromPhone?: string;
    defaultFromEmail?: string;
  }
): {
  valid: BuyLabelsBulkValidatedRow[];
  errors: BuyLabelsBulkRowError[];
  warnings: BuyLabelsBulkRowError[];
} {
  const valid: BuyLabelsBulkValidatedRow[] = [];
  const errors: BuyLabelsBulkRowError[] = [];
  const warnings: BuyLabelsBulkRowError[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const locationId = row["Location ID"].trim();

    if (!locationId) {
      errors.push({ rowNumber, message: "Location ID is required." });
      return;
    }
    if (!options.allowedLocationIds.includes(locationId)) {
      errors.push({ rowNumber, message: "Location ID is not assigned to your account." });
      return;
    }

    const location = options.locationsById.get(locationId);
    if (!location) {
      errors.push({ rowNumber, message: "Unknown location." });
      return;
    }

    const expectedFrom = locationToFromAddress(
      location,
      row["From Name"].trim() || options.defaultFromName,
      row["From Phone"].trim() || options.defaultFromPhone,
      row["From Email"].trim() || options.defaultFromEmail
    );
    const fromAddress = buildAddressFromRow("From", row);
    if (!fromAddress) {
      errors.push({ rowNumber, message: "From address is incomplete. Re-download the template." });
      return;
    }
    if (!addressesMatch(fromAddress, expectedFrom)) {
      warnings.push({
        rowNumber,
        message: "From address differs from the selected warehouse location. Using CSV values.",
      });
    }

    const toAddress = buildAddressFromRow("To", row);
    if (!toAddress) {
      errors.push({
        rowNumber,
        message: "To address is incomplete (Name, Street 1, City, State, ZIP required).",
      });
      return;
    }

    const length = parsePositiveNumber(row.Length, "Length");
    const width = parsePositiveNumber(row.Width, "Width");
    const height = parsePositiveNumber(row.Height, "Height");
    if (length === "invalid" || width === "invalid" || height === "invalid") {
      errors.push({ rowNumber, message: "Length, Width, and Height must be positive numbers." });
      return;
    }

    const distanceUnitRaw = row["Distance Unit"].trim().toLowerCase() || "in";
    if (!DISTANCE_UNITS.has(distanceUnitRaw)) {
      errors.push({ rowNumber, message: 'Distance Unit must be one of: in, ft, cm, m.' });
      return;
    }

    const weightPounds = parseNonNegativeNumber(row["Weight Pounds"]);
    const weightOunces = parseNonNegativeNumber(row["Weight Ounces"]);
    const totalWeightOunces = weightPounds * 16 + weightOunces;
    if (totalWeightOunces <= 0) {
      errors.push({ rowNumber, message: "Total weight must be greater than 0." });
      return;
    }
    if (weightPounds > 70) {
      errors.push({ rowNumber, message: "Weight cannot exceed 70 pounds." });
      return;
    }
    if (weightOunces > 15.999) {
      errors.push({ rowNumber, message: "Weight ounces cannot exceed 15.999." });
      return;
    }

    const totalWeightPounds = totalWeightOunces / 16;

    valid.push({
      rowNumber,
      locationId,
      fromAddress,
      toAddress,
      parcel: {
        length,
        width,
        height,
        weight: totalWeightPounds,
        weightUnit: "lb",
        distanceUnit: distanceUnitRaw as ParcelDetails["distanceUnit"],
      },
      preferredCarrier: row["Preferred Carrier"].trim() || undefined,
      preferredService: row["Preferred Service"].trim() || undefined,
    });
  });

  return { valid, errors, warnings };
}

export function pickShippingRate(
  rates: ShippingRate[],
  preferredCarrier?: string,
  preferredService?: string
): ShippingRate | null {
  if (rates.length === 0) return null;

  let pool = rates;
  if (preferredCarrier?.trim()) {
    const carrier = preferredCarrier.trim().toLowerCase();
    const filtered = rates.filter((r) => r.provider.toLowerCase().includes(carrier));
    if (filtered.length > 0) pool = filtered;
  }
  if (preferredService?.trim()) {
    const svc = preferredService.trim().toLowerCase();
    const filtered = pool.filter((r) => r.servicelevel.name.toLowerCase().includes(svc));
    if (filtered.length > 0) pool = filtered;
  }

  return pool.reduce((best, rate) =>
    parseFloat(rate.amount) < parseFloat(best.amount) ? rate : best
  );
}

export function downloadBuyLabelsBulkTemplate(
  location: BuyLabelLocationInput,
  options?: {
    fromName?: string;
    fromPhone?: string;
    fromEmail?: string;
    sampleRows?: number;
  }
): void {
  const fromName = options?.fromName?.trim() || "Prep Services FBA LLC";
  const from = locationToFromAddress(location, fromName, options?.fromPhone, options?.fromEmail);
  const sampleCount = Math.max(1, options?.sampleRows ?? 5);

  const blankToFields = {
    "To Name": "",
    "To Street 1": "",
    "To Street 2": "",
    "To City": "",
    "To State": "",
    "To ZIP": "",
    "To Country": "US",
    "To Phone": "",
    "To Email": "",
    Length: "15",
    Width: "4",
    Height: "4",
    "Distance Unit": "in",
    "Weight Pounds": "0",
    "Weight Ounces": "13",
    "Preferred Carrier": "",
    "Preferred Service": "",
  };

  const lines = [
    BUY_LABELS_BULK_CSV_HEADERS.join(","),
    ...Array.from({ length: sampleCount }, () => {
      const row: BuyLabelsBulkCsvRow = {
        "Location ID": location.id,
        "Location Name": String(location.name ?? "").trim(),
        "From Name": from.name,
        "From Street 1": from.street1,
        "From Street 2": from.street2 || "",
        "From City": from.city,
        "From State": from.state,
        "From ZIP": from.zip,
        "From Country": from.country,
        "From Phone": from.phone || "",
        "From Email": from.email || "",
        ...blankToFields,
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
