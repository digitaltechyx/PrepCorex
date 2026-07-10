import { formatWarehouseDisplayName } from "@/lib/warehouse-display";

export type RegionOption = {
  code: string;
  name: string;
};

export const WAREHOUSE_COUNTRIES = ["United States", "Canada"] as const;
export type WarehouseCountry = (typeof WAREHOUSE_COUNTRIES)[number];

/** Official US states + DC for warehouse create/edit dropdowns. */
export const US_STATE_OPTIONS: RegionOption[] = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
];

/** Official Canadian provinces and territories. */
export const CA_PROVINCE_OPTIONS: RegionOption[] = [
  { code: "AB", name: "Alberta" },
  { code: "BC", name: "British Columbia" },
  { code: "MB", name: "Manitoba" },
  { code: "NB", name: "New Brunswick" },
  { code: "NL", name: "Newfoundland and Labrador" },
  { code: "NT", name: "Northwest Territories" },
  { code: "NS", name: "Nova Scotia" },
  { code: "NU", name: "Nunavut" },
  { code: "ON", name: "Ontario" },
  { code: "PE", name: "Prince Edward Island" },
  { code: "QC", name: "Quebec" },
  { code: "SK", name: "Saskatchewan" },
  { code: "YT", name: "Yukon" },
];

export function normalizeWarehouseCountry(raw?: string | null): WarehouseCountry | "" {
  const c = (raw || "").trim().toLowerCase();
  if (!c) return "";
  if (c === "us" || c === "usa" || c === "united states" || c === "united states of america") {
    return "United States";
  }
  if (c === "ca" || c === "can" || c === "canada") return "Canada";
  return "";
}

export function regionOptionsForCountry(country?: string | null): RegionOption[] {
  const normalized = normalizeWarehouseCountry(country);
  if (normalized === "United States") return US_STATE_OPTIONS;
  if (normalized === "Canada") return CA_PROVINCE_OPTIONS;
  return [];
}

/** Resolve a stored state/province (name or code) to the official full name for forms. */
export function normalizeRegionName(country?: string | null, stateOrProvince?: string | null): string {
  const raw = (stateOrProvince || "").trim();
  if (!raw) return "";
  const options = regionOptionsForCountry(country);
  if (!options.length) return raw;
  const upper = raw.toUpperCase();
  const byCode = options.find((o) => o.code === upper);
  if (byCode) return byCode.name;
  const byName = options.find((o) => o.name.toLowerCase() === raw.toLowerCase());
  if (byName) return byName.name;
  return raw;
}

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
