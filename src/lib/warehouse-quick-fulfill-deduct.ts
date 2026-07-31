/**
 * Deduct physical warehouse carton/bin qty after Shopify Quick Fulfill
 * (client inventory alone is not enough — Warehouse Ops reads carton lines).
 */

import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { compareFefoFifo } from "@/lib/warehouse-stock-sort";
import { isExpiryPast } from "@/lib/warehouse-carton-states";

const WAREHOUSES = "warehouses";

const ELIGIBLE_CARTON_STATUSES = new Set([
  "stowed",
  "stowed_partial",
  "split",
  "available",
  "reserved",
]);

type CartonLineRaw = {
  lineId: string;
  sku: string;
  productTitle?: string | null;
  quantity: number;
  lot?: string | null;
  expiry?: string | null;
  condition?: string;
  binId?: string | null;
  stagingArea?: string | null;
  allocationStatus?: string;
  clientId?: string | null;
  inventoryRequestId?: string | null;
  productReturnId?: string | null;
  quarantineAt?: unknown;
  quarantineDisposedAt?: unknown;
  quarantineReleasedAt?: unknown;
};

type DeductCandidate = {
  warehouseId: string;
  cartonId: string;
  cartonCode: string;
  cartonStatus: string;
  isMixed: boolean;
  receivedAt: unknown;
  createdAt: unknown;
  line: CartonLineRaw;
  lines: CartonLineRaw[];
};

export type WarehouseQuickFulfillDeductResult = {
  deducted: number;
  shortfall: number;
  movements: Array<{
    warehouseId: string;
    cartonCode: string;
    sku: string;
    quantity: number;
    binId: string | null;
  }>;
};

function normSku(sku: string | null | undefined): string {
  return String(sku || "")
    .trim()
    .toUpperCase();
}

function parseLines(data: Record<string, unknown>): CartonLineRaw[] {
  const raw = Array.isArray(data.lines) ? (data.lines as Array<Record<string, unknown>>) : [];
  if (raw.length > 0) {
    return raw
      .filter((l) => typeof l.sku === "string" && String(l.sku).trim())
      .map((l, i) => ({
        lineId: typeof l.lineId === "string" && l.lineId ? l.lineId : `L${i + 1}`,
        sku: String(l.sku),
        productTitle: l.productTitle != null ? String(l.productTitle) : null,
        quantity: Math.max(0, Math.floor(Number(l.quantity) || 0)),
        lot: l.lot != null ? String(l.lot) : null,
        expiry: l.expiry != null ? String(l.expiry) : null,
        condition: l.condition === "damaged" ? "damaged" : "good",
        binId: l.binId != null ? String(l.binId) : null,
        stagingArea: l.stagingArea != null ? String(l.stagingArea) : null,
        allocationStatus:
          l.allocationStatus === "allocated" || l.allocationStatus === "picked"
            ? String(l.allocationStatus)
            : "unallocated",
        clientId: l.clientId != null ? String(l.clientId) : null,
        inventoryRequestId: l.inventoryRequestId != null ? String(l.inventoryRequestId) : null,
        productReturnId: l.productReturnId != null ? String(l.productReturnId) : null,
        quarantineAt: l.quarantineAt ?? null,
        quarantineDisposedAt: l.quarantineDisposedAt ?? null,
        quarantineReleasedAt: l.quarantineReleasedAt ?? null,
      }));
  }
  const sku = data.sku != null ? String(data.sku) : "";
  if (!sku) return [];
  return [
    {
      lineId: "L1",
      sku,
      productTitle: data.productTitle != null ? String(data.productTitle) : null,
      quantity: Math.max(0, Math.floor(Number(data.quantity) || 0)),
      lot: data.lot != null ? String(data.lot) : null,
      expiry: data.expiry != null ? String(data.expiry) : null,
      condition: data.status === "damaged" ? "damaged" : "good",
      binId: data.binId != null ? String(data.binId) : null,
      stagingArea: data.stagingArea != null ? String(data.stagingArea) : null,
      allocationStatus: data.clientId ? "allocated" : "unallocated",
      clientId: data.clientId != null ? String(data.clientId) : null,
      inventoryRequestId:
        data.inventoryRequestId != null ? String(data.inventoryRequestId) : null,
    },
  ];
}

function linesToPayload(lines: CartonLineRaw[]) {
  return lines.map((l) => ({
    lineId: l.lineId,
    sku: l.sku,
    productTitle: l.productTitle ?? null,
    quantity: l.quantity,
    lot: l.lot ?? null,
    expiry: l.expiry ? String(l.expiry).slice(0, 10) : null,
    condition: l.condition === "damaged" ? "damaged" : "good",
    binId: l.binId ?? null,
    stagingArea: l.stagingArea ?? null,
    allocationStatus: l.allocationStatus ?? "unallocated",
    clientId: l.clientId ?? null,
    inventoryRequestId: l.inventoryRequestId ?? null,
    productReturnId: l.productReturnId ?? null,
    quarantineAt: l.quarantineAt ?? null,
    quarantineDisposedAt: l.quarantineDisposedAt ?? null,
    quarantineReleasedAt: l.quarantineReleasedAt ?? null,
  }));
}

function rollStatus(
  cartonStatus: string,
  isMixed: boolean,
  nextLines: CartonLineRaw[]
): { status: string; binId: string | null; quantity: number } {
  const quantity = nextLines.reduce((s, l) => s + Math.max(0, l.quantity), 0);
  const placed = nextLines.filter((l) => Boolean(l.binId?.trim() || l.stagingArea?.trim()));
  const binLines = nextLines.filter((l) => l.binId);
  const allPlaced = placed.length === nextLines.length && nextLines.length > 0;
  const somePlaced = placed.length > 0;
  const distinctBins = new Set(binLines.map((l) => l.binId));

  let status = cartonStatus;
  if (nextLines.length === 0 || quantity <= 0) {
    status = "closed";
  } else if (allPlaced) {
    status = distinctBins.size > 1 && isMixed ? "split" : "stowed";
  } else if (somePlaced) {
    status = "stowed_partial";
  }

  const binId =
    allPlaced && distinctBins.size === 1 && binLines.length === nextLines.length
      ? binLines[0]?.binId ?? null
      : null;

  return { status, binId, quantity };
}

/**
 * Reduce bin/carton line qty for a client SKU (FEFO/FIFO), matching pick eligibility.
 */
export async function deductWarehouseStockForQuickFulfill(input: {
  db: Firestore;
  clientUserId: string;
  sku: string | null | undefined;
  productName?: string | null;
  quantity: number;
  operatorId?: string | null;
  shopifyOrderId?: string | null;
  shopifyOrderName?: string | null;
}): Promise<WarehouseQuickFulfillDeductResult> {
  const need = Math.max(0, Math.floor(input.quantity));
  const empty: WarehouseQuickFulfillDeductResult = { deducted: 0, shortfall: need, movements: [] };
  if (need <= 0) return empty;

  const clientUserId = String(input.clientUserId || "").trim();
  const skuNorm = normSku(input.sku);
  if (!clientUserId || !skuNorm) {
    return { deducted: 0, shortfall: need, movements: [] };
  }

  const warehousesSnap = await input.db.collection(WAREHOUSES).get();
  const candidates: DeductCandidate[] = [];

  for (const wh of warehousesSnap.docs) {
    const cartonsSnap = await wh.ref.collection("cartons").get();
    for (const docSnap of cartonsSnap.docs) {
      const data = (docSnap.data() || {}) as Record<string, unknown>;
      const status = String(data.status || "");
      if (!ELIGIBLE_CARTON_STATUSES.has(status)) continue;
      if (status === "voided" || status === "closed") continue;

      const cartonClientId = data.clientId != null ? String(data.clientId) : "";
      const lines = parseLines(data);
      for (const line of lines) {
        if (normSku(line.sku) !== skuNorm) continue;
        if (line.condition === "damaged") continue;
        if (line.allocationStatus === "picked") continue;
        if (!line.binId?.trim() && !line.stagingArea?.trim()) continue;
        if (line.quantity <= 0) continue;
        if (line.expiry && isExpiryPast(line.expiry)) continue;
        const lineClient = line.clientId?.trim() || cartonClientId;
        if (lineClient && lineClient !== clientUserId) continue;
        if (cartonClientId && cartonClientId !== clientUserId && !line.clientId?.trim()) continue;

        candidates.push({
          warehouseId: wh.id,
          cartonId: docSnap.id,
          cartonCode: String(data.cartonCode || docSnap.id),
          cartonStatus: status,
          isMixed: data.isMixed === true,
          receivedAt: data.receivedAt,
          createdAt: data.createdAt,
          line,
          lines,
        });
      }
    }
  }

  candidates.sort((a, b) =>
    compareFefoFifo(
      {
        carton: {
          cartonCode: a.cartonCode,
          receivedAt: a.receivedAt as never,
          createdAt: a.createdAt as never,
        },
        line: { expiry: a.line.expiry },
      },
      {
        carton: {
          cartonCode: b.cartonCode,
          receivedAt: b.receivedAt as never,
          createdAt: b.createdAt as never,
        },
        line: { expiry: b.line.expiry },
      }
    )
  );

  let remaining = need;
  const takeByCarton = new Map<
    string,
    { candidate: DeductCandidate; takes: Array<{ lineId: string; qty: number }> }
  >();

  for (const c of candidates) {
    if (remaining <= 0) break;
    const key = `${c.warehouseId}/${c.cartonId}`;
    const already = takeByCarton.get(key);
    const usedOnLine =
      already?.takes.filter((t) => t.lineId === c.line.lineId).reduce((s, t) => s + t.qty, 0) ?? 0;
    const available = c.line.quantity - usedOnLine;
    if (available <= 0) continue;
    const take = Math.min(remaining, available);
    if (!already) {
      takeByCarton.set(key, { candidate: c, takes: [{ lineId: c.line.lineId, qty: take }] });
    } else {
      already.takes.push({ lineId: c.line.lineId, qty: take });
    }
    remaining -= take;
  }

  const movements: WarehouseQuickFulfillDeductResult["movements"] = [];
  let deducted = 0;

  for (const { candidate, takes } of takeByCarton.values()) {
    const cartonRef = input.db
      .collection(WAREHOUSES)
      .doc(candidate.warehouseId)
      .collection("cartons")
      .doc(candidate.cartonId);

    const applied: Array<{ lineId: string; sku: string; qty: number; binId: string | null; stagingArea: string | null }> =
      [];

    await input.db.runTransaction(async (tx) => {
      applied.length = 0;
      const snap = await tx.get(cartonRef);
      if (!snap.exists) return;
      const data = (snap.data() || {}) as Record<string, unknown>;
      let nextLines = parseLines(data);

      for (const t of takes) {
        const idx = nextLines.findIndex((l) => l.lineId === t.lineId);
        if (idx < 0) continue;
        const line = nextLines[idx];
        const qty = Math.min(line.quantity, t.qty);
        if (qty <= 0) continue;
        if (qty >= line.quantity) {
          nextLines = nextLines.filter((_, i) => i !== idx);
        } else {
          nextLines[idx] = { ...line, quantity: line.quantity - qty };
        }
        applied.push({
          lineId: t.lineId,
          sku: line.sku,
          qty,
          binId: line.binId ?? null,
          stagingArea: line.stagingArea ?? null,
        });

        const eventRef = input.db
          .collection(WAREHOUSES)
          .doc(candidate.warehouseId)
          .collection("movementEvents")
          .doc();
        tx.set(eventRef, {
          type: "shopify_quick_fulfill",
          cartonId: candidate.cartonId,
          cartonCode: candidate.cartonCode,
          lineId: t.lineId,
          sku: line.sku,
          quantity: qty,
          fromBinId: line.binId ?? null,
          stagingArea: line.stagingArea ?? null,
          operatorId: input.operatorId ?? null,
          shopifyOrderId: input.shopifyOrderId ?? null,
          shopifyOrderName: input.shopifyOrderName ?? null,
          productName: input.productName ?? line.productTitle ?? null,
          at: FieldValue.serverTimestamp(),
        });
      }

      if (applied.length === 0) return;

      const rolled = rollStatus(
        String(data.status || candidate.cartonStatus),
        data.isMixed === true,
        nextLines
      );
      tx.update(cartonRef, {
        lines: linesToPayload(nextLines),
        quantity: rolled.quantity,
        status: rolled.status,
        binId: rolled.binId,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    for (const a of applied) {
      deducted += a.qty;
      movements.push({
        warehouseId: candidate.warehouseId,
        cartonCode: candidate.cartonCode,
        sku: a.sku,
        quantity: a.qty,
        binId: a.binId,
      });
    }
  }

  return {
    deducted,
    shortfall: Math.max(0, need - deducted),
    movements,
  };
}
