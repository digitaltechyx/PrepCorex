import { toMillis } from "@/lib/inbound-tracking";
import {
  listWarehouseCartons,
  listWarehousePallets,
} from "@/lib/warehouse-carton-firestore";
import { isActiveWarehouseCarton } from "@/lib/warehouse-carton-states";
import { isLinePutawayPlaced } from "@/lib/warehouse-carton-line-utils";
import {
  isCrossdockAreaPlaced,
  needsCrossdockPutawayChoice,
} from "@/lib/warehouse-putaway-disposition";
import {
  isPalletAreaPlaced,
  needsPalletPutawayChoice,
} from "@/lib/warehouse-pallet-putaway";
import type { WarehouseCartonDoc, WarehousePalletDoc } from "@/types";

export type PutawayQueueLabel = {
  kind: "carton" | "pallet";
  id: string;
  code: string;
  badge: string;
  subtitle: string;
  sortMs: number;
};

export function cartonIsAwaitingPutaway(carton: WarehouseCartonDoc): boolean {
  if (!isActiveWarehouseCarton(carton)) return false;
  if (isCrossdockAreaPlaced(carton)) return false;
  if (needsCrossdockPutawayChoice(carton)) return true;
  if (
    carton.status !== "received" &&
    carton.status !== "receiving" &&
    carton.status !== "stowed_partial"
  ) {
    return false;
  }
  const lines = carton.lines ?? [];
  if (lines.length === 0) return !carton.binId;
  return lines.some((l) => !isLinePutawayPlaced(l));
}

export function palletIsAwaitingPutaway(
  pallet: WarehousePalletDoc,
  cartonsOnPallet: WarehouseCartonDoc[]
): boolean {
  if (isPalletAreaPlaced(pallet)) return false;
  if (needsPalletPutawayChoice(pallet)) return true;
  return cartonsOnPallet.some(cartonIsAwaitingPutaway);
}

function cartonBadge(carton: WarehouseCartonDoc): string {
  if (carton.isPackage) return "Package";
  if (carton.isContainer) return "Container";
  if (carton.receiveMode === "crossdock") return "Cross-dock";
  if (carton.isLoose) return "Open receive";
  return "Carton";
}

function cartonSubtitle(carton: WarehouseCartonDoc): string {
  const lines = carton.lines ?? [];
  const pending = lines.filter((l) => !isLinePutawayPlaced(l));
  const units = pending.reduce((s, l) => s + Math.max(0, l.quantity), 0);
  const skus = new Set(pending.map((l) => l.sku).filter(Boolean));
  const parts: string[] = [];
  if (needsCrossdockPutawayChoice(carton)) {
    parts.push("Needs disposition");
  } else if (pending.length > 0) {
    parts.push(
      `${pending.length} line${pending.length === 1 ? "" : "s"}`,
      `${units}u`,
      skus.size > 0 ? `${skus.size} SKU${skus.size === 1 ? "" : "s"}` : ""
    );
  } else if (lines.length === 0) {
    parts.push("Awaiting putaway");
  }
  if (carton.status === "stowed_partial") parts.push("Partial");
  return parts.filter(Boolean).join(" · ");
}

function palletSubtitle(
  pallet: WarehousePalletDoc,
  cartonsOnPallet: WarehouseCartonDoc[]
): string {
  if (needsPalletPutawayChoice(pallet)) return "Closed cross-dock · needs disposition";
  const pendingCartons = cartonsOnPallet.filter(cartonIsAwaitingPutaway);
  return `${pendingCartons.length} carton${pendingCartons.length === 1 ? "" : "s"} awaiting`;
}

function labelFromCarton(carton: WarehouseCartonDoc): PutawayQueueLabel {
  return {
    kind: "carton",
    id: carton.id,
    code: carton.cartonCode,
    badge: cartonBadge(carton),
    subtitle: cartonSubtitle(carton),
    sortMs:
      toMillis(carton.receivedAt) ??
      toMillis(carton.createdAt) ??
      toMillis(carton.updatedAt) ??
      0,
  };
}

function labelFromPallet(
  pallet: WarehousePalletDoc,
  cartonsOnPallet: WarehouseCartonDoc[]
): PutawayQueueLabel {
  return {
    kind: "pallet",
    id: pallet.id,
    code: pallet.palletCode,
    badge: "Pallet",
    subtitle: palletSubtitle(pallet, cartonsOnPallet),
    sortMs:
      toMillis(pallet.receivedAt) ??
      toMillis(pallet.createdAt) ??
      toMillis(pallet.updatedAt) ??
      0,
  };
}

/** Labels (CTN / PKG / PAL) still available for putaway, newest first. */
export function buildPutawayQueueLabels(
  cartons: WarehouseCartonDoc[],
  pallets: WarehousePalletDoc[]
): PutawayQueueLabel[] {
  const byPallet = new Map<string, WarehouseCartonDoc[]>();
  for (const c of cartons) {
    if (!c.palletId) continue;
    const list = byPallet.get(c.palletId) ?? [];
    list.push(c);
    byPallet.set(c.palletId, list);
  }

  const out: PutawayQueueLabel[] = [];
  for (const c of cartons) {
    if (!cartonIsAwaitingPutaway(c)) continue;
    out.push(labelFromCarton(c));
  }
  for (const p of pallets) {
    const onPallet = byPallet.get(p.id) ?? [];
    if (!palletIsAwaitingPutaway(p, onPallet)) continue;
    out.push(labelFromPallet(p, onPallet));
  }

  return out.sort((a, b) => {
    if (b.sortMs !== a.sortMs) return b.sortMs - a.sortMs;
    return a.code.localeCompare(b.code);
  });
}

export async function listPutawayQueueLabels(
  warehouseId: string
): Promise<PutawayQueueLabel[]> {
  const [cartons, pallets] = await Promise.all([
    listWarehouseCartons(warehouseId),
    listWarehousePallets(warehouseId),
  ]);
  return buildPutawayQueueLabels(cartons, pallets);
}
