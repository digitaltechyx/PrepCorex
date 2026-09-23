/**
 * Heuristic carrier detection from a raw tracking number scanned at receiving.
 * Pattern reference: UPS / FedEx / USPS / DHL / Amazon Logistics published formats.
 * Returns one of our dropdown values or null when no pattern matches.
 */

export type DetectedCarrier =
  | "UPS"
  | "FedEx"
  | "USPS"
  | "DHL"
  | "Amazon Logistics"
  | null;

/**
 * Turn a raw scanner or camera read into the carrier tracking number.
 * USPS labels often include an AIM prefix (`]C1`) and a `420` + ZIP routing
 * code (sometimes separated by one extra character) before the real number.
 */
export function normalizeTrackingScan(raw: string): string {
  let v = String(raw ?? "").trim().toUpperCase();
  v = v.replace(/[\u0000-\u001F\u007F]/g, "");
  v = v.replace(/^\((\d{2,4})\)/, "");
  // AIM symbology ids: ]C1 Code 128, ]e0 GS1-128, ]d2 Data Matrix, ]Q3 QR, etc.
  while (/^\][A-Z]\d/.test(v)) {
    v = v.slice(3);
  }
  v = v.replace(/^(TRK|TN|TRACK)[:#]?/, "");
  v = v.replace(/[\s-]/g, "");
  if (!v) return "";

  const ups = v.match(/1Z[0-9A-Z]{16}/);
  if (ups) return ups[0];

  // 420 + ZIP (5 or 9) + optional one-character separator + USPS tracking digits.
  const routed = v.match(/^420(?:\d{9}|\d{5})[^0-9]?(\d{20,34})$/);
  if (routed) return preferUspsLookupNumber(routed[1]);

  const compact = v.replace(/[^0-9A-Z]/g, "");
  if (/^\d{23,}$/.test(compact)) return preferUspsLookupNumber(compact);

  return compact;
}

/** Carrier lookup wants the printed USPS number, not the routing barcode. */
function preferUspsLookupNumber(digits: string): string {
  if (/^(20|22|26|34)$/.test(String(digits.length)) && /^9/.test(digits)) {
    return digits;
  }
  if (digits.length > 22) {
    const last22 = digits.slice(-22);
    if (/^9[2-6]\d{20}$/.test(last22)) return last22;
    const embedded = digits.match(/9[2-6]\d{20}/);
    if (embedded) return embedded[0];
  }
  return digits;
}

export function detectCarrier(raw: string): DetectedCarrier {
  const v = normalizeTrackingScan(raw);
  if (!v) return null;

  // UPS: 1Z + 16 chars (total 18). Also handles "1Z…" prefix.
  if (/^1Z[A-Z0-9]{16}$/.test(v)) return "UPS";

  // Amazon Logistics: TBA + 12 digits
  if (/^TBA\d{12}$/.test(v)) return "Amazon Logistics";

  // DHL Express: 10 digits, OR starts with JD/JJD/JV…
  if (/^J[JVD][A-Z0-9]{14,}$/.test(v)) return "DHL";
  if (/^\d{10}$/.test(v)) return "DHL";

  // USPS Tracking common prefixes:
  //   9400 1XXX (Tracking Plus), 9205 5XXX (Priority), 9303 (Standard),
  //   9407 (Certified), 9405 (Standard), 9270 (Express)
  if (/^9(400|205|303|407|405|270|2055|2056)\d/.test(v)) return "USPS";
  // USPS 22-26 digit numeric
  if (/^\d{22,26}$/.test(v)) return "USPS";

  // FedEx Express (12 digit) / Ground (15 digit starting 96 or 100)
  if (/^\d{12}$/.test(v)) return "FedEx";
  if (/^96\d{20}$/.test(v) || /^\d{15}$/.test(v) || /^\d{20}$/.test(v)) return "FedEx";

  return null;
}
