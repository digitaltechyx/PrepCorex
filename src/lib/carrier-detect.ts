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
const ADDRESS_WORDS =
  /\b(STREET|AVENUE|AVE|ROAD|BLVD|BOULEVARD|DRIVE|LANE|COURT|APT|SUITE|POBOX|P\.?O\.?\s*BOX)\b/;

export function normalizeTrackingScan(raw: string): string {
  let v = String(raw ?? "").trim().toUpperCase();
  v = v.replace(/[\u0000-\u001F\u007F]/g, "");
  v = v.replace(/\][A-Z]\d/g, "");
  v = v.replace(/\(\d{2,4}\)/g, "");
  v = v.replace(/^(TRK|TN|TRACK)[:#]?/, "");
  if (!v.trim()) return "";

  const compact = v.replace(/[\s-]/g, "");

  const ups = compact.match(/1Z[0-9A-Z]{16}/);
  if (ups) return ups[0];

  const amazon = compact.match(/TBA\d{12}/);
  if (amazon) return amazon[0];

  const dhlAlpha = compact.match(/J[JVD][A-Z0-9]{14,22}/);
  if (dhlAlpha) return dhlAlpha[0];

  // 420 + ZIP (5 or 9) + optional separator + the printed USPS number.
  const routed = compact.match(/420(?:\d{9}|\d{5})[^0-9]?(\d{20,34})/);
  if (routed) return preferUspsLookupNumber(routed[1]);

  // ZIP routing barcode by itself is not a tracking number.
  if (/^420\d{5}$/.test(compact) || /^420\d{9}$/.test(compact)) return "";

  const usps = compact.match(/9(?:4|3|2|1)\d{19,32}/);
  if (usps) return preferUspsLookupNumber(usps[0].slice(0, 34));

  const fedex96 = compact.match(/96\d{18,22}/);
  if (fedex96 && fedex96[0].length >= 20 && fedex96[0].length <= 22) return fedex96[0];

  const digits = compact.replace(/[^0-9]/g, "");
  const letters = compact.replace(/[^A-Z]/g, "");
  if (ADDRESS_WORDS.test(v) || letters.length > 8) return "";

  if (digits.length === 12 && !digits.startsWith("420")) return digits;
  if (digits.length === 15 || digits.length === 20) return digits;
  if (digits.length === 10 && compact === digits) return digits;
  if (/^\d{22,34}$/.test(digits)) return preferUspsLookupNumber(digits);

  return "";
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
  if (/^96\d{18,22}$/.test(v) || /^\d{12}$/.test(v) || /^\d{15}$/.test(v)) return "FedEx";
  if (/^\d{20}$/.test(v) && !v.startsWith("9")) return "FedEx";

  if (/^9(400|205|303|407|405|270|2055|2056)\d/.test(v)) return "USPS";
  if (/^\d{22,34}$/.test(v) && v.startsWith("9")) return "USPS";

  return null;
}
