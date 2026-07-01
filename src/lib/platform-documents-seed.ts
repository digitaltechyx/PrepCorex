import { MSA_AGREEMENT_SECTIONS, MSA_SERVICE_PROVIDER } from "./msa-content";
import type { PlatformDocument, PlatformDocumentSection, PlatformDocumentSlug } from "./platform-documents-types";
import { PLATFORM_DOCUMENT_LABELS } from "./platform-documents-types";

export { MSA_SERVICE_PROVIDER };

export const TERMS_OF_SERVICE_SECTIONS: PlatformDocumentSection[] = [
  {
    title: "1. Scope",
    body: "This Schedule A (Pricing & Commercial Terms) forms part of the Master Service Agreement between Prep Services FBA LLC and the Client. It governs pricing, billing cycles, service tiers, and commercial terms for warehousing, prep, storage, fulfillment, and related services accessed through the PrepCorex client portal.",
  },
  {
    title: "2. Pricing & Rate Changes",
    body: "Service rates are published in the client portal or communicated in writing. Prep Services FBA may update rates with reasonable notice. Continued use of Services after notice constitutes acceptance of updated rates unless the Client terminates in accordance with the MSA.",
  },
  {
    title: "3. Billing & Payment",
    body: "Invoices are issued when services are completed or when storage charges accrue, as described in the MSA. Payment is due within forty-eight (48) hours unless prepaid arrangements apply. Late payments may incur fees and suspension of service release.",
  },
  {
    title: "4. Storage Minimums & Fees",
    body: "Storage fees apply per unit, pallet, or volume tier as configured for the Client account. Minimum monthly storage or handling fees may apply where stated in the portal or a signed addendum.",
  },
  {
    title: "5. Service Levels",
    body: "Standard turnaround times are estimates based on operational volume and inbound condition. Expedited processing is available only when agreed in writing and may incur additional fees.",
  },
  {
    title: "6. Disputes & Adjustments",
    body: "Billing disputes must be reported within seven (7) days of invoice issuance. Prep Services FBA will review supporting documentation and issue credits or adjustments at its reasonable discretion.",
  },
  {
    title: "7. Taxes",
    body: "Fees are exclusive of applicable taxes unless stated otherwise. Client is responsible for any sales, use, or similar taxes not collected by Prep Services FBA.",
  },
  {
    title: "8. Order of Precedence",
    body: "If there is a conflict between this Schedule A and the MSA, the MSA controls except where this Schedule A expressly states otherwise for pricing and commercial terms.",
  },
];

export const PRIVACY_POLICY_SECTIONS: PlatformDocumentSection[] = [
  {
    title: "1. Introduction",
    body: "This Privacy, Data Processing & Information Security Policy (“Privacy Policy”) describes how Prep Services FBA LLC (“we”, “us”) collects, uses, stores, and protects information when you use PrepCorex and related services.",
  },
  {
    title: "2. Information We Collect",
    body: "We collect account information (name, company, email, phone), operational data (inventory, shipments, labels, integrations), billing data, support communications, and technical logs necessary to operate and secure the platform.",
  },
  {
    title: "3. How We Use Information",
    body: "We use information to provide warehousing and fulfillment services, process payments, communicate about your account, improve the platform, comply with law, and protect against fraud or abuse.",
  },
  {
    title: "4. Sharing & Processors",
    body: "We share data with service providers (hosting, email, payment, carriers, marketplace integrations) only as needed to deliver Services. We require appropriate safeguards from subprocessors handling Client data.",
  },
  {
    title: "5. Data Retention",
    body: "We retain account and operational records as long as needed to provide Services, meet legal obligations, resolve disputes, and enforce agreements. Retention periods may vary by data type.",
  },
  {
    title: "6. Security",
    body: "We implement administrative, technical, and physical safeguards designed to protect information. No system is completely secure; Clients should use strong passwords and protect portal credentials.",
  },
  {
    title: "7. Client Responsibilities",
    body: "Clients must provide accurate information, limit access to authorized personnel, and promptly notify us of suspected unauthorized access or data incidents related to their account.",
  },
  {
    title: "8. Your Rights & Contact",
    body: "Depending on jurisdiction, you may have rights to access, correct, or delete certain personal information. Contact info@prepservicesfba.com for privacy requests.",
  },
];

export function getDefaultPlatformDocument(slug: PlatformDocumentSlug): PlatformDocument {
  const labels = PLATFORM_DOCUMENT_LABELS[slug];
  const now = new Date().toISOString();

  if (slug === "msa") {
    return {
      slug,
      title: labels.title,
      subtitle: "Prep Services FBA LLC — Master Service Agreement",
      sections: MSA_AGREEMENT_SECTIONS.map((s) => ({ title: s.title, body: s.body })),
      version: 1,
      updatedAt: now,
      updatedByName: "System",
    };
  }

  if (slug === "terms") {
    return {
      slug,
      title: labels.title,
      subtitle: "Schedule A — Pricing & Commercial Terms",
      sections: TERMS_OF_SERVICE_SECTIONS,
      version: 1,
      updatedAt: now,
      updatedByName: "System",
    };
  }

  return {
    slug,
    title: labels.title,
    subtitle: "Schedule D — Privacy, Data Processing & Information Security Policy",
    sections: PRIVACY_POLICY_SECTIONS,
    version: 1,
    updatedAt: now,
    updatedByName: "System",
  };
}

export function getAllDefaultPlatformDocuments(): PlatformDocument[] {
  return (["msa", "terms", "privacy"] as PlatformDocumentSlug[]).map(getDefaultPlatformDocument);
}
