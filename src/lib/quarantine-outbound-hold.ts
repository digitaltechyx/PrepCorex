import type { InventoryItem, QuarantineRequest } from "@/types";

export type QuarantineLotHold = {
  /** Units held on open quarantine (move-to) requests for this product. */
  units: number;
  /** Units held per expiry (YYYY-MM-DD). */
  byExpiry: Map<string, number>;
};

function isOpenQuarantineStatus(status: string | undefined | null): boolean {
  return status === "pending" || status === "approved";
}

/**
 * Open "move to quarantine" requests reserve sellable units so they no longer
 * appear as shippable in outbound form / Excel — including before warehouse completes.
 */
export function buildOpenQuarantineHolds(
  requests: Array<Pick<QuarantineRequest, "kind" | "status" | "productId" | "quantity" | "lotAllocations">>
): Map<string, QuarantineLotHold> {
  const map = new Map<string, QuarantineLotHold>();
  for (const req of requests) {
    if (req.kind !== "quarantine") continue;
    if (!isOpenQuarantineStatus(req.status)) continue;
    const productId = String(req.productId || "").trim();
    if (!productId) continue;

    const units = Math.max(0, Math.floor(Number(req.quantity) || 0));
    if (units <= 0) continue;

    let hold = map.get(productId);
    if (!hold) {
      hold = { units: 0, byExpiry: new Map() };
      map.set(productId, hold);
    }
    hold.units += units;

    const allocs = Array.isArray(req.lotAllocations) ? req.lotAllocations : [];
    if (allocs.length > 0) {
      for (const row of allocs) {
        const expiry = String(row?.expiry ?? "").trim();
        const qty = Math.max(0, Math.floor(Number(row?.quantity) || 0));
        if (!expiry || qty <= 0) continue;
        hold.byExpiry.set(expiry, (hold.byExpiry.get(expiry) ?? 0) + qty);
      }
    }
  }
  return map;
}

/** Sellable qty available for outbound after open quarantine holds. */
export function outboundSellableQuantity(
  item: Pick<InventoryItem, "id" | "quantity">,
  holds: Map<string, QuarantineLotHold> | undefined | null
): number {
  const onHand = Math.max(0, Math.floor(Number(item.quantity) || 0));
  const held = holds?.get(item.id)?.units ?? 0;
  return Math.max(0, onHand - held);
}

/**
 * Sellable expiry lots for outbound pickers / Excel after subtracting open
 * quarantine holds (and dropping zero-qty lots).
 */
export function outboundSellableExpiryBatches(
  item: Pick<InventoryItem, "id" | "expiryBatches">,
  holds: Map<string, QuarantineLotHold> | undefined | null
): NonNullable<InventoryItem["expiryBatches"]> {
  const batches = Array.isArray(item.expiryBatches) ? item.expiryBatches : [];
  const heldByExpiry = holds?.get(item.id)?.byExpiry;
  const heldTotal = holds?.get(item.id)?.units ?? 0;

  // If the open request has no lot breakdown, subtract held units FEFO-style
  // from earliest expiries so outbound cannot ship the held volume.
  let remainingUnallocatedHold = 0;
  if (heldTotal > 0 && (!heldByExpiry || heldByExpiry.size === 0)) {
    remainingUnallocatedHold = heldTotal;
  }

  const next: NonNullable<InventoryItem["expiryBatches"]> = [];
  const sorted = [...batches]
    .map((b) => ({
      expiry: String(b?.expiry ?? "").trim(),
      quantity: Math.max(0, Math.floor(Number(b?.quantity) || 0)),
      lot: b?.lot ?? null,
      requestId: b?.requestId ?? null,
    }))
    .filter((b) => b.expiry)
    .sort((a, b) => a.expiry.localeCompare(b.expiry));

  for (const b of sorted) {
    let qty = b.quantity;
    const heldOnLot = heldByExpiry?.get(b.expiry) ?? 0;
    if (heldOnLot > 0) qty = Math.max(0, qty - heldOnLot);
    if (remainingUnallocatedHold > 0 && qty > 0) {
      const take = Math.min(qty, remainingUnallocatedHold);
      qty -= take;
      remainingUnallocatedHold -= take;
    }
    if (qty > 0) {
      next.push({
        expiry: b.expiry,
        quantity: qty,
        lot: b.lot,
        requestId: b.requestId,
      });
    }
  }
  return next;
}

/** Inventory view for outbound template / picker after quarantine holds. */
export function inventoryForOutboundWithQuarantineHolds(
  inventory: InventoryItem[],
  requests: Array<Pick<QuarantineRequest, "kind" | "status" | "productId" | "quantity" | "lotAllocations">>
): InventoryItem[] {
  const holds = buildOpenQuarantineHolds(requests);
  return inventory
    .map((item) => {
      const qty = outboundSellableQuantity(item, holds);
      if (qty <= 0) return null;
      const batches = outboundSellableExpiryBatches(item, holds);
      return {
        ...item,
        quantity: qty,
        expiryBatches: batches,
      };
    })
    .filter(Boolean) as InventoryItem[];
}
