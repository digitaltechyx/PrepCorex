export const PLATFORM_DOCUMENT_SLUGS = ["msa", "terms", "privacy"] as const;
export type PlatformDocumentSlug = (typeof PLATFORM_DOCUMENT_SLUGS)[number];

export type PlatformDocumentSection = {
  title: string;
  body: string;
};

export type PlatformDocument = {
  slug: PlatformDocumentSlug;
  title: string;
  subtitle?: string;
  sections: PlatformDocumentSection[];
  version: number;
  updatedAt?: string;
  updatedBy?: string;
  updatedByName?: string;
};

export type PlatformDocumentSummary = Pick<
  PlatformDocument,
  "slug" | "title" | "subtitle" | "version" | "updatedAt"
>;

export const PLATFORM_DOCUMENT_LABELS: Record<
  PlatformDocumentSlug,
  { title: string; shortLabel: string }
> = {
  msa: {
    title: "Master Service Agreement (MSA)",
    shortLabel: "Master Service Agreement (MSA)",
  },
  terms: {
    title: "Terms of Service (Schedule A — Pricing & Commercial Terms)",
    shortLabel: "Terms of Service",
  },
  privacy: {
    title: "Privacy Policy (Schedule D — Privacy, Data Processing & Information Security)",
    shortLabel: "Privacy Policy",
  },
};

export function isPlatformDocumentSlug(value: string): value is PlatformDocumentSlug {
  return (PLATFORM_DOCUMENT_SLUGS as readonly string[]).includes(value);
}
