export type UniqueFieldKind = "companyName" | "ein" | "phone";

export type UserUniqueFieldInput = {
  companyName?: string | null;
  ein?: string | null;
  phone?: string | null;
};

export type UserUniqueFieldKeys = {
  companyNameKey?: string | null;
  einKey?: string | null;
  phoneKey?: string | null;
};

const INTERNAL_COMPANY_PLACEHOLDERS = new Set(["prepcorex ops"]);

export function normalizeCompanyNameKey(value?: string | null): string | null {
  const collapsed = String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!collapsed) return null;
  const lower = collapsed.toLowerCase();
  if (INTERNAL_COMPANY_PLACEHOLDERS.has(lower)) return null;
  return lower;
}

export function normalizeEinKey(value?: string | null): string | null {
  const raw = String(value ?? "").trim();
  if (!raw || /^n\/a$/i.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 9) return null;
  return digits;
}

export function normalizePhoneKey(value?: string | null): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits;
}

export function buildUserUniqueFieldKeys(input: UserUniqueFieldInput): UserUniqueFieldKeys {
  return {
    companyNameKey: normalizeCompanyNameKey(input.companyName),
    einKey: normalizeEinKey(input.ein),
    phoneKey: normalizePhoneKey(input.phone),
  };
}

export function uniqueRegistryDocId(kind: UniqueFieldKind, key: string): string {
  const prefix = kind === "companyName" ? "company" : kind === "ein" ? "ein" : "phone";
  const safe = key.replace(/[^a-z0-9]/gi, "").slice(0, 120);
  return `${prefix}_${safe}`;
}

export const UNIQUE_FIELD_MESSAGES: Record<UniqueFieldKind, string> = {
  companyName: "This company name is already registered to another account.",
  ein: "This EIN is already associated with another account.",
  phone: "This phone number is already associated with another account.",
};
