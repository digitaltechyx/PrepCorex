import { formatWarehouseDisplayName } from "@/lib/warehouse-display";

/** Lowercase US state / territory name → USPS code */
const US_STATE_BY_NAME: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "american samoa": "AS",
  guam: "GU",
  "northern mariana islands": "MP",
  "puerto rico": "PR",
  "u.s. virgin islands": "VI",
  "us virgin islands": "VI",
};

/** Lowercase Canadian province/territory name → code */
const CA_PROVINCE_BY_NAME: Record<string, string> = {
  alberta: "AB",
  "british columbia": "BC",
  manitoba: "MB",
  "new brunswick": "NB",
  "newfoundland and labrador": "NL",
  "northwest territories": "NT",
  "nova scotia": "NS",
  nunavut: "NU",
  ontario: "ON",
  "prince edward island": "PE",
  quebec: "QC",
  québec: "QC",
  saskatchewan: "SK",
  yukon: "YT",
};

function isUnitedStates(country?: string | null): boolean {
  const c = (country || "").trim().toLowerCase();
  return c === "us" || c === "usa" || c === "united states" || c === "united states of america";
}

function isCanada(country?: string | null): boolean {
  const c = (country || "").trim().toLowerCase();
  return c === "ca" || c === "can" || c === "canada";
}

/** Short label for a state/province row (US + CA mapped; others use a compact heuristic). */
export function abbreviateStateOrProvince(
  country?: string | null,
  stateOrProvince?: string | null
): string {
  const raw = (stateOrProvince || "").trim();
  if (!raw) return "";
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  const key = raw.toLowerCase();
  if (isUnitedStates(country)) {
    return US_STATE_BY_NAME[key] ?? intlAbbrevFallback(raw);
  }
  if (isCanada(country)) {
    return CA_PROVINCE_BY_NAME[key] ?? intlAbbrevFallback(raw);
  }
  return intlAbbrevFallback(raw);
}

function intlAbbrevFallback(raw: string): string {
  const t = raw.trim();
  if (t.length <= 3) return t.toUpperCase();
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return parts
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 5);
}

/** Breadcrumb-style path: full state as stored; warehouse shown as NJ1, NJ2, etc. */
export function formatLocationPath(
  country?: string | null,
  stateOrProvince?: string | null,
  name?: string | null
): string {
  const co = (country || "").trim() || "Uncategorized";
  const stateRaw = (stateOrProvince || "").trim();
  const st = stateRaw || "Unspecified";
  const nm = formatWarehouseDisplayName(name);
  if (co !== "Uncategorized" && stateRaw) return `${co} > ${st} > ${nm}`;
  if (co !== "Uncategorized") return `${co} > ${nm}`;
  return nm;
}
