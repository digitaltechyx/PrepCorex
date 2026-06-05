import type { WarehouseCartonDoc } from "@/types";

const PREFIX = "PCX";

export type CartonBarcodeFields = {
  cartonCode: string;
  sku: string;
  lot?: string | null;
  expiry?: string | null;
  quantity: number;
};

/** Build internal carton QR payload (pipe-delimited key=value). */
export function encodeCartonBarcode(fields: CartonBarcodeFields): string {
  const parts = [
    `${PREFIX}|CTN=${encodeSegment(fields.cartonCode)}`,
    `SKU=${encodeSegment(fields.sku)}`,
    `QTY=${Math.max(0, Math.floor(fields.quantity))}`,
  ];
  if (fields.lot?.trim()) parts.push(`LOT=${encodeSegment(fields.lot.trim())}`);
  if (fields.expiry?.trim()) parts.push(`EXP=${encodeSegment(fields.expiry.trim().slice(0, 10))}`);
  return parts.join("|");
}

function encodeSegment(value: string): string {
  return value.replace(/\|/g, "/");
}

export type DecodedCartonBarcode = {
  cartonCode: string;
  sku: string;
  lot?: string;
  expiry?: string;
  quantity: number;
};

/** Parse scanner input from our carton label QR. */
export function decodeCartonBarcode(payload: string): DecodedCartonBarcode | null {
  const raw = String(payload ?? "").trim();
  if (!raw) return null;

  if (!raw.includes("|") && !raw.includes("=")) {
    return null;
  }

  const map = new Map<string, string>();
  for (const chunk of raw.split("|")) {
    const eq = chunk.indexOf("=");
    if (eq <= 0) continue;
    const key = chunk.slice(0, eq).trim().toUpperCase();
    const val = chunk.slice(eq + 1).trim();
    if (key && val) map.set(key, val);
  }

  const cartonCode = map.get("CTN") ?? map.get("CARTON_ID") ?? map.get("ID");
  const sku = map.get("SKU");
  if (!cartonCode || !sku) return null;

  const qtyRaw = map.get("QTY") ?? map.get("QUANTITY") ?? "0";
  const quantity = Math.max(0, parseInt(qtyRaw, 10) || 0);

  return {
    cartonCode,
    sku,
    lot: map.get("LOT"),
    expiry: map.get("EXP") ?? map.get("EXPIRY"),
    quantity,
  };
}

export function encodePalletBarcode(palletCode: string): string {
  return `${PREFIX}|PAL=${encodeSegment(palletCode.trim())}`;
}

export function encodePackageBarcode(packageCode: string): string {
  return `${PREFIX}|PKG=${encodeSegment(packageCode.trim())}`;
}

export function decodePalletBarcode(payload: string): string | null {
  const raw = String(payload ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith(`${PREFIX}|`)) {
    for (const chunk of raw.split("|")) {
      const eq = chunk.indexOf("=");
      if (eq <= 0) continue;
      if (chunk.slice(0, eq).trim().toUpperCase() === "PAL") {
        return chunk.slice(eq + 1).trim();
      }
    }
  }
  if (/^PAL-\d{4}-\d+$/i.test(raw)) return raw;
  return null;
}

export function decodePackageBarcode(payload: string): string | null {
  const raw = String(payload ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith(`${PREFIX}|`)) {
    for (const chunk of raw.split("|")) {
      const eq = chunk.indexOf("=");
      if (eq <= 0) continue;
      if (chunk.slice(0, eq).trim().toUpperCase() === "PKG") {
        return chunk.slice(eq + 1).trim();
      }
    }
  }
  if (/^PKG-\d{4}-\d+$/i.test(raw)) return raw;
  return null;
}

export function cartonBarcodeFromDoc(
  carton: Pick<WarehouseCartonDoc, "cartonCode" | "sku" | "lot" | "expiry" | "quantity" | "isPackage" | "barcode">
): string {
  if (carton.isPackage) {
    return encodePackageBarcode(carton.cartonCode);
  }
  if (carton.barcode?.includes("|PKG=")) {
    return carton.barcode;
  }
  return encodeCartonBarcode({
    cartonCode: carton.cartonCode,
    sku: carton.sku,
    lot: carton.lot,
    expiry: carton.expiry,
    quantity: carton.quantity,
  });
}
