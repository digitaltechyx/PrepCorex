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

/** Strip GS1-style symbology prefixes (`(420)`, `]C1`) and whitespace. */
export function normalizeTrackingScan(raw: string): string {
  let v = String(raw ?? "").trim().toUpperCase();
  // Strip GS1 AI prefix like (420)92110 or (00) (01) etc.
  v = v.replace(/^\((\d{2,4})\)/, "");
  // Strip Code 128 / AIM prefixes
  v = v.replace(/^]C[01]/, "");
  // Strip "TRK:" / "TN:" prefixes
  v = v.replace(/^(TRK|TN|TRACK)[:#]?/, "");
  // Remove embedded spaces / dashes
  v = v.replace(/[\s-]/g, "");
  return v;
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
