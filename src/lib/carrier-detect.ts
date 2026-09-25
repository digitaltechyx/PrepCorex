/**
 * Pull the printed tracking ID out of a raw camera / wedge scan.
 *
 * Labels carry several barcodes. Only one is the carrier tracking number:
 * - USPS: GS1-128 with AI 420 (ZIP) then AI 91–95 tracking (22/26/30/34 digits starting 9)
 * - UPS: 1Z + 16 alphanumeric
 * - FedEx Ground: Code 128 “96” barcode (22 digits) → printed tracking is the last 15 digits
 * - FedEx Express: 12-digit tracking, often at the end of a longer 1D/PDF417 payload
 * - FedEx SmartPost: 20 digits starting 92
 * - GOFO: GFUS / GF + country + digits, or YLGE / YT partner numbers
 * Ignore ZIP-only 420 barcodes, UPC/EAN product codes, and address text.
 */

export type DetectedCarrier =
  | "UPS"
  | "FedEx"
  | "USPS"
  | "DHL"
  | "Amazon Logistics"
  | "GOFO"
  | null;

type TrackingCandidate = { tracking: string; carrier: Exclude<DetectedCarrier, null>; rank: number };

function compactTrackingPayload(raw: string): string {
  let v = String(raw ?? "").trim().toUpperCase();
  v = v.replace(/[\u0000-\u001F\u007F]/g, "");
  v = v.replace(/\][A-Z0-9]{2}/g, "");
  v = v.replace(/\(\d{2,4}\)/g, "");
  v = v.replace(/^(TRK|TN|TRACK(ING)?)[:#\s]*/i, "");
  return v.replace(/[\s\-_.]/g, "");
}

function preferUspsLookupNumber(digits: string): string {
  if (/^(20|22|26|30|34)$/.test(String(digits.length)) && /^9[1-5]/.test(digits)) {
    return digits;
  }
  if (digits.length > 22) {
    const last22 = digits.slice(-22);
    if (/^9[1-5]\d{20}$/.test(last22)) return last22;
    const embedded = digits.match(/9[1-5]\d{20}/);
    if (embedded) return embedded[0];
  }
  return digits;
}

function collectCandidates(compact: string): TrackingCandidate[] {
  const found: TrackingCandidate[] = [];
  const push = (tracking: string, carrier: TrackingCandidate["carrier"], rank: number) => {
    if (!tracking) return;
    found.push({ tracking, carrier, rank });
  };

  const ups = compact.match(/1Z[0-9A-Z]{16}/);
  if (ups) push(ups[0], "UPS", 100);

  const gofoUs = compact.match(/GF[A-Z]{2}\d{13,16}/);
  if (gofoUs) push(gofoUs[0], "GOFO", 95);

  const gofoYlge = compact.match(/YLGE\d{10,16}/);
  if (gofoYlge) push(gofoYlge[0], "GOFO", 94);

  const gofoYt = compact.match(/YT\d{12,16}/);
  if (gofoYt) push(gofoYt[0], "GOFO", 93);

  const amazon = compact.match(/TBA\d{12}/);
  if (amazon) push(amazon[0], "Amazon Logistics", 90);

  const dhlAlpha = compact.match(/J[JVD][A-Z0-9]{14,22}/);
  if (dhlAlpha) push(dhlAlpha[0], "DHL", 88);

  const routed = compact.match(/420(?:\d{9}|\d{5})[^0-9]?(\d{20,34})/);
  if (routed) push(preferUspsLookupNumber(routed[1]), "USPS", 85);

  const fedex96 = compact.match(/96\d{20}/);
  if (fedex96) {
    const barcode = fedex96[0];
    const ground15 = barcode.slice(-15);
    push(ground15, "FedEx", 84);
  }

  const smartPost = compact.match(/92\d{18}/);
  if (smartPost && compact.replace(/[^0-9]/g, "").length <= 21) {
    push(smartPost[0], "FedEx", 80);
  }

  const usps22 = compact.match(/9[1-5]\d{20}/);
  if (usps22 && compact.replace(/[^0-9]/g, "").length >= 22) {
    push(preferUspsLookupNumber(usps22[0]), "USPS", 70);
  }

  const usps26 = compact.match(/9[1-5]\d{24}/);
  if (usps26) push(preferUspsLookupNumber(usps26[0].slice(0, 26)), "USPS", 72);

  if (/^\d{34}$/.test(compact) || /^\d{32}$/.test(compact)) {
    const last12 = compact.slice(-12);
    if (/^[1-8]\d{11}$/.test(last12)) push(last12, "FedEx", 75);
  }

  if (/^\d{22}$/.test(compact) && !compact.startsWith("9") && !compact.startsWith("96")) {
    push(compact, "FedEx", 60);
  }

  return found;
}

export function normalizeTrackingScan(raw: string): string {
  const compact = compactTrackingPayload(raw);
  if (!compact) return "";

  if (/^420\d{5}$/.test(compact) || /^420\d{9}$/.test(compact)) return "";

  const candidates = collectCandidates(compact);
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.rank - a.rank);
    return candidates[0].tracking;
  }

  if (/^1Z[0-9A-Z]{16}$/.test(compact)) return compact;
  if (/^GF[A-Z]{2}\d{13,16}$/.test(compact)) return compact;

  const digits = compact.replace(/[^0-9]/g, "");
  if (/^\d{15}$/.test(digits) && digits.startsWith("96")) return digits;
  if (/^\d{12}$/.test(digits) && !digits.startsWith("0") && !digits.startsWith("420")) return digits;
  if (/^\d{22,34}$/.test(digits) && /^9[1-5]/.test(digits)) return preferUspsLookupNumber(digits);

  return "";
}

export function detectCarrier(raw: string): DetectedCarrier {
  const compact = compactTrackingPayload(raw);
  const tracking = normalizeTrackingScan(raw);
  const haystack = `${compact} ${tracking}`;

  if (/1Z[0-9A-Z]{16}/.test(haystack) || /^1Z[0-9A-Z]{16}$/.test(tracking)) return "UPS";
  if (/GF[A-Z]{2}\d{13,16}|YLGE\d{10,}|YT\d{12,}/.test(haystack) || /^GF[A-Z]{2}\d{13,16}$/.test(tracking)) {
    return "GOFO";
  }
  if (/^TBA\d{12}$/.test(tracking)) return "Amazon Logistics";
  if (/^J[JVD][A-Z0-9]{14,}$/.test(tracking)) return "DHL";

  if (/^96\d{13}$/.test(tracking) || /^96\d{20}$/.test(compact)) return "FedEx";
  if (/^92\d{18}$/.test(tracking)) return "FedEx";
  if (/^\d{12}$/.test(tracking) && !tracking.startsWith("9") && !tracking.startsWith("0")) return "FedEx";
  if (/^\d{15}$/.test(tracking) && tracking.startsWith("96")) return "FedEx";

  if (/^9[1-5]\d{20,32}$/.test(tracking)) return "USPS";
  if (/^\d{22,34}$/.test(tracking) && tracking.startsWith("9")) return "USPS";

  return null;
}

export function resolveTrackerCarrier(raw: string, provided?: string | null): string {
  const detected = detectCarrier(raw);
  const given = String(provided ?? "").trim();
  if (detected) return detected;
  if (given && given.toLowerCase() !== "usps") return given;
  return detected || "Unknown";
}
