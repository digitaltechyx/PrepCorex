import type { ShippingAddress } from "@/types";

const US_STATES: { value: string; label: string }[] = [
  { value: "AL", label: "Alabama" },
  { value: "AK", label: "Alaska" },
  { value: "AZ", label: "Arizona" },
  { value: "AR", label: "Arkansas" },
  { value: "CA", label: "California" },
  { value: "CO", label: "Colorado" },
  { value: "CT", label: "Connecticut" },
  { value: "DE", label: "Delaware" },
  { value: "FL", label: "Florida" },
  { value: "GA", label: "Georgia" },
  { value: "HI", label: "Hawaii" },
  { value: "ID", label: "Idaho" },
  { value: "IL", label: "Illinois" },
  { value: "IN", label: "Indiana" },
  { value: "IA", label: "Iowa" },
  { value: "KS", label: "Kansas" },
  { value: "KY", label: "Kentucky" },
  { value: "LA", label: "Louisiana" },
  { value: "ME", label: "Maine" },
  { value: "MD", label: "Maryland" },
  { value: "MA", label: "Massachusetts" },
  { value: "MI", label: "Michigan" },
  { value: "MN", label: "Minnesota" },
  { value: "MS", label: "Mississippi" },
  { value: "MO", label: "Missouri" },
  { value: "MT", label: "Montana" },
  { value: "NE", label: "Nebraska" },
  { value: "NV", label: "Nevada" },
  { value: "NH", label: "New Hampshire" },
  { value: "NJ", label: "New Jersey" },
  { value: "NM", label: "New Mexico" },
  { value: "NY", label: "New York" },
  { value: "NC", label: "North Carolina" },
  { value: "ND", label: "North Dakota" },
  { value: "OH", label: "Ohio" },
  { value: "OK", label: "Oklahoma" },
  { value: "OR", label: "Oregon" },
  { value: "PA", label: "Pennsylvania" },
  { value: "RI", label: "Rhode Island" },
  { value: "SC", label: "South Carolina" },
  { value: "SD", label: "South Dakota" },
  { value: "TN", label: "Tennessee" },
  { value: "TX", label: "Texas" },
  { value: "UT", label: "Utah" },
  { value: "VT", label: "Vermont" },
  { value: "VA", label: "Virginia" },
  { value: "WA", label: "Washington" },
  { value: "WV", label: "West Virginia" },
  { value: "WI", label: "Wisconsin" },
  { value: "WY", label: "Wyoming" },
  { value: "DC", label: "District of Columbia" },
];

const CANADIAN_PROVINCES: { value: string; label: string }[] = [
  { value: "AB", label: "Alberta" },
  { value: "BC", label: "British Columbia" },
  { value: "MB", label: "Manitoba" },
  { value: "NB", label: "New Brunswick" },
  { value: "NL", label: "Newfoundland and Labrador" },
  { value: "NS", label: "Nova Scotia" },
  { value: "ON", label: "Ontario" },
  { value: "PE", label: "Prince Edward Island" },
  { value: "QC", label: "Quebec" },
  { value: "SK", label: "Saskatchewan" },
  { value: "NT", label: "Northwest Territories" },
  { value: "NU", label: "Nunavut" },
  { value: "YT", label: "Yukon" },
];

const US_STATE_BY_LABEL = new Map(US_STATES.map((s) => [s.label.toLowerCase(), s.value]));
const US_STATE_CODES = new Set(US_STATES.map((s) => s.value));
const CA_PROVINCE_BY_LABEL = new Map(CANADIAN_PROVINCES.map((s) => [s.label.toLowerCase(), s.value]));
const CA_PROVINCE_CODES = new Set(CANADIAN_PROVINCES.map((s) => s.value));

export type LocationShippingInput = {
  id?: string;
  name?: string;
  shippingName?: string;
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  stateOrProvince?: string;
  zip?: string;
  country?: string;
};

/** Map Firestore location country labels to Shippo / form select codes. */
export function normalizeShippoCountry(raw: string | undefined): string {
  const v = (raw || "").trim();
  if (!v) return "US";
  const lower = v.toLowerCase();
  if (lower === "us" || lower === "usa" || lower === "united states" || lower === "united states of america") {
    return "US";
  }
  if (lower === "ca" || lower === "can" || lower === "canada") {
    return "CA";
  }
  return v.length === 2 ? v.toUpperCase() : v;
}

/** Map full state/province names to 2-letter codes used by the buy-labels form and Shippo. */
export function normalizeShippoState(raw: string | undefined, countryCode: string): string {
  const v = (raw || "").trim();
  if (!v) return "";

  if (countryCode === "US") {
    const upper = v.toUpperCase();
    if (US_STATE_CODES.has(upper)) return upper;
    return US_STATE_BY_LABEL.get(v.toLowerCase()) || upper;
  }

  if (countryCode === "CA") {
    const upper = v.toUpperCase();
    if (CA_PROVINCE_CODES.has(upper)) return upper;
    return CA_PROVINCE_BY_LABEL.get(v.toLowerCase()) || upper;
  }

  return v;
}

export function normalizeUsZip(raw: string | undefined): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length >= 9) {
    return `${digits.slice(0, 5)}-${digits.slice(5, 9)}`;
  }
  return digits.padStart(5, "0");
}

export function locationToFromShippingAddress(
  location: LocationShippingInput,
  options?: {
    shipperName?: string;
    phone?: string;
    email?: string;
  }
): ShippingAddress {
  const country = normalizeShippoCountry(location.country);
  const state = normalizeShippoState(location.stateOrProvince || location.state, country);
  const zip =
    country === "US" ? normalizeUsZip(location.zip) : String(location.zip || "").trim();

  const shipperName =
    (location.shippingName || "").trim() ||
    (options?.shipperName || "").trim() ||
    (location.name || "").trim();

  return {
    name: shipperName,
    street1: (location.street1 || "").trim(),
    street2: (location.street2 || "").trim() || undefined,
    city: (location.city || "").trim(),
    state,
    zip,
    country,
    phone: (options?.phone || "").trim() || undefined,
    email: (options?.email || "").trim() || undefined,
  };
}

function normField(v: string): string {
  return v.trim().toLowerCase();
}

/** Compare two shipping addresses after normalizing country/state/zip. */
export function shippingAddressesMatch(a: ShippingAddress, b: ShippingAddress): boolean {
  const countryA = normalizeShippoCountry(a.country);
  const countryB = normalizeShippoCountry(b.country);
  const zipA = countryA === "US" ? normalizeUsZip(a.zip) : a.zip.trim();
  const zipB = countryB === "US" ? normalizeUsZip(b.zip) : b.zip.trim();

  return (
    normField(a.street1) === normField(b.street1) &&
    normField(a.street2 || "") === normField(b.street2 || "") &&
    normField(a.city) === normField(b.city) &&
    normalizeShippoState(a.state, countryA) === normalizeShippoState(b.state, countryB) &&
    normField(zipA) === normField(zipB) &&
    countryA === countryB
  );
}

export function normalizeShippingAddressForShippo(address: ShippingAddress): ShippingAddress {
  const country = normalizeShippoCountry(address.country);
  return {
    ...address,
    country,
    state: normalizeShippoState(address.state, country),
    zip: country === "US" ? normalizeUsZip(address.zip) : address.zip.trim(),
  };
}
