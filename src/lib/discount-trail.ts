import { addDoc, collection, getDocs, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { computeInvoiceTotals } from "@/lib/invoice-totals";
import type { DiscountTrailEntry, Invoice } from "@/types";

export function trailEntryMs(entry: DiscountTrailEntry): number {
  const v = entry.appliedAt;
  if (!v) return 0;
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  }
  if (typeof v === "object" && v !== null && "seconds" in v) {
    return (v as { seconds: number }).seconds * 1000;
  }
  return 0;
}

export function formatDiscountTrailLabel(
  type?: DiscountTrailEntry["discountType"],
  value?: number
): string {
  if (type === "percent" && typeof value === "number") {
    return `${value.toFixed(2)}% off`;
  }
  if (typeof value === "number") {
    return `$${value.toFixed(2)} off`;
  }
  return "Discount";
}

export async function recordDiscountTrailEntry(input: {
  userId: string;
  invoiceId: string;
  invoiceNumber: string;
  discountType: "amount" | "percent";
  discountValue: number;
  discountAmount: number;
  grossTotal?: number;
  grandTotalAfter?: number;
  invoiceStatus?: string;
  appliedBy?: string | null;
  appliedByName?: string | null;
}): Promise<void> {
  await addDoc(collection(db, `users/${input.userId}/discountTrail`), {
    userId: input.userId,
    invoiceId: input.invoiceId,
    invoiceNumber: input.invoiceNumber,
    discountType: input.discountType,
    discountValue: input.discountValue,
    discountAmount: input.discountAmount,
    grossTotal: input.grossTotal ?? null,
    grandTotalAfter: input.grandTotalAfter ?? null,
    invoiceStatus: input.invoiceStatus ?? null,
    appliedBy: input.appliedBy ?? null,
    appliedByName: input.appliedByName ?? null,
    appliedAt: serverTimestamp(),
  });
}

export async function loadDiscountTrailForUser(userId: string): Promise<DiscountTrailEntry[]> {
  if (!userId) return [];
  const snap = await getDocs(collection(db, `users/${userId}/discountTrail`));
  return snap.docs
    .map((d) => ({
      id: d.id,
      ...(d.data() as Omit<DiscountTrailEntry, "id">),
    }))
    .sort((a, b) => trailEntryMs(b) - trailEntryMs(a));
}

export async function loadDiscountTrailsForUsers(
  userIds: string[]
): Promise<DiscountTrailEntry[]> {
  const unique = [...new Set(userIds.filter(Boolean))];
  const batches = await Promise.all(unique.map((id) => loadDiscountTrailForUser(id)));
  return batches
    .flat()
    .sort((a, b) => trailEntryMs(b) - trailEntryMs(a));
}

export function invoiceToTrailEntry(
  invoice: Invoice,
  userName?: string
): DiscountTrailEntry | null {
  const totals = computeInvoiceTotals(invoice);
  if (totals.discountAmount <= 0.009) return null;
  const appliedAt = (invoice as Invoice).updatedAt || invoice.createdAt;
  return {
    id: `inv-${invoice.id}`,
    userId: invoice.userId,
    userName,
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    discountType: invoice.discountType || "amount",
    discountValue:
      typeof invoice.discountValue === "number"
        ? invoice.discountValue
        : totals.discountAmount,
    discountAmount: totals.discountAmount,
    grossTotal: totals.grossTotal,
    grandTotalAfter: invoice.grandTotal,
    invoiceStatus: invoice.status,
    appliedByName: "Admin",
    appliedAt,
    source: "invoice_backfill",
  };
}

/** Merge Firestore trail docs with legacy discounted invoices (one entry per invoice). */
export function mergeDiscountTrailEntries(
  stored: DiscountTrailEntry[],
  invoices: Invoice[],
  userNameById?: Record<string, string>
): DiscountTrailEntry[] {
  const byInvoice = new Map<string, DiscountTrailEntry>();

  for (const e of stored) {
    if (e.invoiceId) byInvoice.set(e.invoiceId, e);
  }

  for (const inv of invoices) {
    if (!inv.id || byInvoice.has(inv.id)) continue;
    const name = userNameById?.[inv.userId];
    const backfill = invoiceToTrailEntry(inv, name);
    if (backfill) byInvoice.set(inv.id, backfill);
  }

  return [...byInvoice.values()].sort((a, b) => trailEntryMs(b) - trailEntryMs(a));
}

export function sumDiscountTrailAmount(entries: DiscountTrailEntry[]): number {
  return Number(
    entries.reduce((sum, e) => sum + (Number(e.discountAmount) || 0), 0).toFixed(2)
  );
}
