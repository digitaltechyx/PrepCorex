import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";

/** Per-admin saved invoice line templates (additional services). */
export const INVOICE_LINE_CATALOG = "invoiceLineCatalog";

export type InvoiceCatalogLine = {
  id: string;
  /** Optional short label in the dropdown; defaults to description. */
  label?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export function catalogCollectionPath(ownerUid: string) {
  return collection(db, "users", ownerUid, INVOICE_LINE_CATALOG);
}

export function catalogLineLabel(line: Pick<InvoiceCatalogLine, "label" | "description">): string {
  const label = (line.label || "").trim();
  if (label) return label;
  const desc = (line.description || "").trim();
  if (!desc) return "Untitled line";
  const first = desc.split("\n")[0]?.trim() || desc;
  return first.length > 72 ? `${first.slice(0, 69)}…` : first;
}

function mapCatalogDoc(id: string, data: Omit<InvoiceCatalogLine, "id">): InvoiceCatalogLine {
  return {
    id,
    label: typeof data.label === "string" ? data.label : "",
    description: typeof data.description === "string" ? data.description : "",
    quantity: Number(data.quantity) || 0,
    unitPrice: Number(data.unitPrice) || 0,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

export async function listInvoiceCatalogLines(ownerUid: string): Promise<InvoiceCatalogLine[]> {
  const col = catalogCollectionPath(ownerUid);
  try {
    const snap = await getDocs(query(col, orderBy("updatedAt", "desc")));
    return snap.docs.map((d) => mapCatalogDoc(d.id, d.data() as Omit<InvoiceCatalogLine, "id">));
  } catch {
    const snap = await getDocs(col);
    const rows = snap.docs.map((d) => mapCatalogDoc(d.id, d.data() as Omit<InvoiceCatalogLine, "id">));
    return rows.sort((a, b) => catalogLineLabel(a).localeCompare(catalogLineLabel(b)));
  }
}

export type CatalogLineInput = {
  label?: string;
  description: string;
  quantity: number;
  unitPrice: number;
};

export async function addInvoiceCatalogLine(
  ownerUid: string,
  input: CatalogLineInput
): Promise<string> {
  const ref = await addDoc(catalogCollectionPath(ownerUid), {
    label: (input.label || "").trim(),
    description: (input.description || "").trim(),
    quantity: Number(input.quantity) || 0,
    unitPrice: Number(input.unitPrice) || 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateInvoiceCatalogLine(
  ownerUid: string,
  lineId: string,
  input: CatalogLineInput
): Promise<void> {
  await updateDoc(doc(db, "users", ownerUid, INVOICE_LINE_CATALOG, lineId), {
    label: (input.label || "").trim(),
    description: (input.description || "").trim(),
    quantity: Number(input.quantity) || 0,
    unitPrice: Number(input.unitPrice) || 0,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteInvoiceCatalogLine(ownerUid: string, lineId: string): Promise<void> {
  await deleteDoc(doc(db, "users", ownerUid, INVOICE_LINE_CATALOG, lineId));
}

/**
 * True when a shipped order still needs a Create Invoice (outbound dispatch or
 * marketplace quick fulfill). Only rows with explicit `invoiceStatus: "pending"`
 * show the button — legacy rows without that flag do not.
 * Pass `allowPrepcorexCreateInvoice: false` for CRM-draft clients (hides Create Invoice).
 */
export function shippedNeedsOutboundInvoice(item: {
  invoiceId?: string | null;
  invoiceStatus?: string | null;
  crmExternalInvoiceId?: string | null;
}, opts?: { allowPrepcorexCreateInvoice?: boolean }): boolean {
  if (opts?.allowPrepcorexCreateInvoice === false) return false;
  if (item.invoiceId || item.crmExternalInvoiceId) return false;
  const status = String(item.invoiceStatus || "").trim().toLowerCase();
  return status === "pending";
}

/** Alias — same gate for marketplace quick-fulfill shipped rows. */
export const shippedNeedsInvoice = shippedNeedsOutboundInvoice;

/**
 * Off (CRM draft) clients: still need post-dispatch Add Services / push to CRM
 * while pending and not yet linked to a CRM draft.
 * Only rows with explicit `invoiceStatus: "pending"` (set at dispatch / quick fulfill).
 */
export function shippedNeedsCrmDraftServices(item: {
  invoiceId?: string | null;
  invoiceStatus?: string | null;
  crmExternalInvoiceId?: string | null;
}, opts?: { allowPrepcorexCreateInvoice?: boolean }): boolean {
  if (opts?.allowPrepcorexCreateInvoice !== false) return false;
  if (item.invoiceId || item.crmExternalInvoiceId) return false;
  return String(item.invoiceStatus || "").trim().toLowerCase() === "pending";
}

/**
 * True when a shipment request is fully dispatched and still needs an invoice.
 * Requires explicit `invoiceStatus: "pending"` from a new dispatch (not historical).
 */
export function shipmentRequestNeedsOutboundInvoice(request: {
  warehouseDispatchStatus?: string | null;
  invoiceId?: string | null;
  invoiceStatus?: string | null;
  crmExternalInvoiceId?: string | null;
}, opts?: { allowPrepcorexCreateInvoice?: boolean }): boolean {
  if (opts?.allowPrepcorexCreateInvoice === false) return false;
  if (String(request.warehouseDispatchStatus || "").trim().toLowerCase() !== "dispatched") {
    return false;
  }
  if (request.invoiceId || request.crmExternalInvoiceId) return false;
  return String(request.invoiceStatus || "").trim().toLowerCase() === "pending";
}

export function shipmentRequestNeedsCrmDraftServices(request: {
  warehouseDispatchStatus?: string | null;
  invoiceId?: string | null;
  invoiceStatus?: string | null;
  crmExternalInvoiceId?: string | null;
}, opts?: { allowPrepcorexCreateInvoice?: boolean }): boolean {
  if (opts?.allowPrepcorexCreateInvoice !== false) return false;
  if (String(request.warehouseDispatchStatus || "").trim().toLowerCase() !== "dispatched") {
    return false;
  }
  if (request.invoiceId || request.crmExternalInvoiceId) return false;
  return String(request.invoiceStatus || "").trim().toLowerCase() === "pending";
}
