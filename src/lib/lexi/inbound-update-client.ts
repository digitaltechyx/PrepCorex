"use client";

import { Timestamp, doc, getDoc, updateDoc } from "firebase/firestore";
import { inboundBatchLinesPath } from "@/lib/inbound-batch";
import { db } from "@/lib/firebase";
import type { LexiInboundUpdatePayload } from "@/lib/lexi/types";

function parseExpiryOrNull(raw: string | null | undefined): Timestamp | null | undefined {
  if (raw === undefined) return undefined;
  const value = String(raw || "").trim();
  if (!value || value.toLowerCase() === "null" || value.toLowerCase() === "clear") {
    return null;
  }
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new Error("expiryDate must be a valid date (use YYYY-MM-DD), or clear.");
  }
  return Timestamp.fromDate(d);
}

function optionalPositiveNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("Unit size/weight values must be greater than zero.");
  }
  return n;
}

/**
 * Update a pending inventory (inbound) request — same fields as Inventory → Edit / Update Request.
 * Syncs linked single-line batch rows when present.
 */
export async function lexiUpdatePendingInboundOnClient(
  payload: LexiInboundUpdatePayload,
  operatorId: string
): Promise<string> {
  const clientUserId = String(payload.clientUserId || "").trim();
  const requestId = String(payload.requestId || "").trim();
  if (!clientUserId || !requestId) throw new Error("Missing client or request id.");

  const requestRef = doc(db, `users/${clientUserId}/inventoryRequests`, requestId);
  const snap = await getDoc(requestRef);
  if (!snap.exists()) throw new Error("Inbound request not found.");

  const data = snap.data() as Record<string, unknown>;
  if (String(data.status || "").toLowerCase() !== "pending") {
    throw new Error("Only pending inbound requests can be updated.");
  }

  const patch: Record<string, unknown> = {
    lexiUpdatedBy: operatorId,
    lexiUpdatedAt: Timestamp.now(),
  };
  const changed: string[] = [];

  if (payload.productNameNew !== undefined) {
    const name = String(payload.productNameNew || "").trim();
    if (!name) throw new Error("Product name cannot be empty.");
    patch.productName = name;
    changed.push(`name → ${name}`);
  }

  if (payload.sku !== undefined) {
    const sku = String(payload.sku || "").trim();
    patch.sku = sku || null;
    changed.push(sku ? `SKU → ${sku}` : "SKU cleared");
  }

  if (payload.quantity !== undefined) {
    const qty = Math.floor(Number(payload.quantity));
    if (!Number.isFinite(qty) || qty <= 0) throw new Error("Quantity must be greater than 0.");
    patch.quantity = qty;
    patch.requestedQuantity = qty;
    changed.push(`qty → ${qty}`);
  }

  if (payload.retailIdentifier !== undefined) {
    const retail = String(payload.retailIdentifier || "").trim();
    patch.retailIdentifier = retail;
    changed.push(retail ? `retail → ${retail}` : "retail id cleared");
  }

  if (payload.expiryDate !== undefined) {
    const expiry = parseExpiryOrNull(payload.expiryDate);
    patch.expiryDate = expiry ?? null;
    changed.push(
      expiry ? `expiry → ${String(payload.expiryDate).trim()}` : "expiry cleared"
    );
  }

  if (payload.remarks !== undefined) {
    const remarks = String(payload.remarks || "").trim();
    patch.remarks = remarks || null;
    changed.push(remarks ? "remarks updated" : "remarks cleared");
  }

  const length = optionalPositiveNumber(payload.unitLengthIn);
  const width = optionalPositiveNumber(payload.unitWidthIn);
  const height = optionalPositiveNumber(payload.unitHeightIn);
  const weight = optionalPositiveNumber(payload.unitWeightLb);

  if (length !== undefined) {
    patch.unitLengthIn = length;
    changed.push(length != null ? `L ${length}in` : "length cleared");
  }
  if (width !== undefined) {
    patch.unitWidthIn = width;
    changed.push(width != null ? `W ${width}in` : "width cleared");
  }
  if (height !== undefined) {
    patch.unitHeightIn = height;
    changed.push(height != null ? `H ${height}in` : "height cleared");
  }
  if (weight !== undefined) {
    patch.unitWeightLb = weight;
    changed.push(weight != null ? `Wt ${weight}lb` : "weight cleared");
  }

  if (changed.length === 0) {
    throw new Error("No fields to update. Pass at least one change (e.g. unit size).");
  }

  await updateDoc(requestRef, patch);

  const batchId = String(data.batchId || "").trim();
  const batchLineId = String(data.batchLineId || "").trim();
  if (batchId && batchLineId) {
    const linePatch: Record<string, unknown> = {};
    for (const key of [
      "productName",
      "sku",
      "quantity",
      "requestedQuantity",
      "retailIdentifier",
      "remarks",
      "expiryDate",
      "unitLengthIn",
      "unitWidthIn",
      "unitHeightIn",
      "unitWeightLb",
    ]) {
      if (key in patch) linePatch[key] = patch[key];
    }
    if (Object.keys(linePatch).length > 0) {
      await updateDoc(doc(db, inboundBatchLinesPath(clientUserId, batchId), batchLineId), linePatch);
    }
  }

  const label = String(patch.productName || data.productName || payload.productName || requestId);
  return `Inbound #${requestId} (${label}) updated: ${changed.join(", ")}.`;
}
