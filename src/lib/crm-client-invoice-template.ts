import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

/** Same collection as CRM-PrepCorex (`crm-client-invoice-template.ts`). */
export const CRM_CLIENT_INVOICE_TEMPLATES = "crmClientInvoiceTemplates";

export type CrmClientInvoiceTemplateFields = {
  companyName: string;
  companyAddress: string;
  companyCityStateZip: string;
  companyCountry: string;
  companyPhone: string;
  companyEmail: string;
  invoiceNote: string;
  fobPoint: string;
  shippingTerms: string;
  shippedVia: string;
  terms: string;
};

export type CrmClientInvoiceTemplate = CrmClientInvoiceTemplateFields & {
  id: string;
  clientEmail: string;
  clientName: string;
  prepcorexClientUserId?: string | null;
};

export function normalizeClientEmail(email?: string | null): string {
  return String(email || "").trim().toLowerCase();
}

export function clientInvoiceTemplateDocId(input: {
  email?: string | null;
  prepcorexClientUserId?: string | null;
}): string {
  const email = normalizeClientEmail(input.email);
  if (email) {
    return `email_${email.replace(/[^a-z0-9]+/g, "_")}`;
  }
  const uid = String(input.prepcorexClientUserId || "").trim();
  if (uid) return `uid_${uid}`;
  throw new Error("Client email or PrepCorex user id is required.");
}

function mapTemplate(
  id: string,
  data: Record<string, unknown>
): CrmClientInvoiceTemplate {
  return {
    id,
    clientEmail: normalizeClientEmail(data.clientEmail as string),
    clientName: String(data.clientName || "").trim(),
    prepcorexClientUserId: data.prepcorexClientUserId
      ? String(data.prepcorexClientUserId).trim()
      : null,
    companyName: String(data.companyName || "").trim(),
    companyAddress: String(data.companyAddress || "").trim(),
    companyCityStateZip: String(data.companyCityStateZip || "").trim(),
    companyCountry: String(data.companyCountry || "").trim(),
    companyPhone: String(data.companyPhone || "").trim(),
    companyEmail: String(data.companyEmail || "").trim(),
    invoiceNote: String(data.invoiceNote || "").trim(),
    fobPoint: String(data.fobPoint || "").trim(),
    shippingTerms: String(data.shippingTerms || "").trim(),
    shippedVia: String(data.shippedVia || "").trim(),
    terms: String(data.terms || "").trim(),
  };
}

/** Load the CRM-saved per-client invoice template (email first, then PrepCorex uid). */
export async function getClientInvoiceTemplate(input: {
  email?: string | null;
  prepcorexClientUserId?: string | null;
}): Promise<CrmClientInvoiceTemplate | null> {
  const email = normalizeClientEmail(input.email);
  const uid = String(input.prepcorexClientUserId || "").trim();

  if (email) {
    try {
      const byEmail = await getDoc(
        doc(db, CRM_CLIENT_INVOICE_TEMPLATES, clientInvoiceTemplateDocId({ email }))
      );
      if (byEmail.exists()) {
        return mapTemplate(byEmail.id, byEmail.data() as Record<string, unknown>);
      }
    } catch {
      /* continue */
    }
    try {
      const snap = await getDocs(
        query(
          collection(db, CRM_CLIENT_INVOICE_TEMPLATES),
          where("clientEmail", "==", email),
          limit(1)
        )
      );
      if (!snap.empty) {
        const d = snap.docs[0];
        return mapTemplate(d.id, d.data() as Record<string, unknown>);
      }
    } catch {
      /* continue */
    }
  }

  if (uid) {
    try {
      const byUid = await getDoc(
        doc(
          db,
          CRM_CLIENT_INVOICE_TEMPLATES,
          clientInvoiceTemplateDocId({ prepcorexClientUserId: uid })
        )
      );
      if (byUid.exists()) {
        return mapTemplate(byUid.id, byUid.data() as Record<string, unknown>);
      }
    } catch {
      /* continue */
    }
    try {
      const snap = await getDocs(
        query(
          collection(db, CRM_CLIENT_INVOICE_TEMPLATES),
          where("prepcorexClientUserId", "==", uid),
          limit(1)
        )
      );
      if (!snap.empty) {
        const d = snap.docs[0];
        return mapTemplate(d.id, d.data() as Record<string, unknown>);
      }
    } catch {
      /* continue */
    }
  }

  return null;
}

export function isAutoBuiltCrmDraftNote(note?: string | null): boolean {
  const text = String(note || "").trim().toLowerCase();
  if (!text) return false;
  return text.startsWith("auto-built from prepcorex outbound");
}
