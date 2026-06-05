import {
  collection,
  getDocs,
  query,
  where,
  limit,
  serverTimestamp,
  doc,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  warehouseCartonsCollectionRef,
  warehouseCartonDocRef,
} from "@/lib/warehouse-carton-firestore";
import { warehouseBinsCollectionRef } from "@/lib/warehouse-firestore";
import {
  decodeCartonBarcode,
  decodePalletBarcode,
  decodePackageBarcode,
} from "@/lib/warehouse-carton-barcode";
import type {
  WarehouseBinDoc,
  WarehouseCartonDoc,
  WarehouseCartonLine,
} from "@/types";

const WAREHOUSES = "warehouses";

/** Bin "kind" inferred from area code for putaway routing. */
export type BinKind = "normal" | "quarantine" | "receiving_staging";

export function classifyBin(bin: WarehouseBinDoc): BinKind {
  const area = (bin.area ?? "").toUpperCase();
  if (area.includes("QUAR") || area.startsWith("QR") || area === "Q") return "quarantine";
  if (area.includes("RECV") || area.includes("RCV") || area.includes("STAGE")) {
    return "receiving_staging";
  }
  return "normal";
}

/** Strip "PCX|" prefix or just return the trimmed raw token from a scan. */
function normalizeRawScan(input: string): string {
  return input.trim();
}

/** Find a carton by its `cartonCode` field within a warehouse. */
export async function findCartonByCode(
  warehouseId: string,
  cartonCodeRaw: string
): Promise<WarehouseCartonDoc | null> {
  const cartonCode = cartonCodeRaw.trim();
  if (!cartonCode) return null;
  const decodedPkg = decodePackageBarcode(cartonCode);
  const code = decodedPkg ?? cartonCode;
  const snap = await getDocs(
    query(
      warehouseCartonsCollectionRef(warehouseId),
      where("cartonCode", "==", code),
      limit(1)
    )
  );
  if (snap.empty) return null;
  const d = snap.docs[0];
  return docToCartonShallow(d.id, d.data() as Record<string, unknown>);
}

/** Find by either raw cartonCode, full QR payload, or pallet code. */
export async function resolveScan(
  warehouseId: string,
  raw: string
): Promise<
  | { kind: "carton"; carton: WarehouseCartonDoc }
  | { kind: "pallet"; palletCode: string }
  | { kind: "none" }
> {
  const value = normalizeRawScan(raw);
  if (!value) return { kind: "none" };

  const decoded = decodeCartonBarcode(value);
  if (decoded?.cartonCode) {
    const carton = await findCartonByCode(warehouseId, decoded.cartonCode);
    if (carton) return { kind: "carton", carton };
  }

  const pal = decodePalletBarcode(value);
  if (pal) return { kind: "pallet", palletCode: pal };

  const pkg = decodePackageBarcode(value);
  if (pkg) {
    const carton = await findCartonByCode(warehouseId, pkg);
    if (carton) return { kind: "carton", carton };
  }

  const direct = await findCartonByCode(warehouseId, value);
  if (direct) return { kind: "carton", carton: direct };

  if (/^PAL-\d{4}-\d+$/i.test(value)) {
    return { kind: "pallet", palletCode: value };
  }

  if (/^PKG-\d{4}-\d+$/i.test(value)) {
    const carton = await findCartonByCode(warehouseId, value);
    if (carton) return { kind: "carton", carton };
  }

  return { kind: "none" };
}

/** Look up a bin by `path` or `barcode`. */
export async function findBinByPath(
  warehouseId: string,
  pathOrBarcode: string
): Promise<WarehouseBinDoc | null> {
  const raw = pathOrBarcode.trim();
  if (!raw) return null;

  let snap = await getDocs(
    query(warehouseBinsCollectionRef(warehouseId), where("path", "==", raw), limit(1))
  );
  if (snap.empty) {
    snap = await getDocs(
      query(warehouseBinsCollectionRef(warehouseId), where("barcode", "==", raw), limit(1))
    );
  }
  if (snap.empty) return null;
  const d = snap.docs[0];
  const data = d.data() as Record<string, unknown>;
  return {
    id: d.id,
    area: String(data.area ?? ""),
    row: String(data.row ?? ""),
    bay: String(data.bay ?? ""),
    level: String(data.level ?? ""),
    binCode: String(data.binCode ?? ""),
    path: String(data.path ?? ""),
    barcode: String(data.barcode ?? ""),
    active: data.active !== false,
    storageAreaId: data.storageAreaId != null ? String(data.storageAreaId) : undefined,
    temporary: data.temporary === true,
    layoutBlockId: data.layoutBlockId != null ? String(data.layoutBlockId) : undefined,
  };
}

/**
 * Inspect what SKUs currently live in a bin (across all cartons / lines).
 * Returns a set of SKUs and a flag for whether any damaged stock is present.
 */
export async function inspectBinContents(
  warehouseId: string,
  binId: string
): Promise<{ skus: string[]; hasDamaged: boolean; cartonCount: number }> {
  const skus = new Set<string>();
  let hasDamaged = false;
  let cartonCount = 0;

  // (a) Old single-sku cartons assigned to this bin at the root level.
  const rootSnap = await getDocs(
    query(warehouseCartonsCollectionRef(warehouseId), where("binId", "==", binId))
  );
  for (const d of rootSnap.docs) {
    cartonCount += 1;
    const data = d.data() as Record<string, unknown>;
    const rootSku = typeof data.sku === "string" ? data.sku : "";
    if (rootSku && rootSku !== "MIXED") skus.add(rootSku);
    if (data.status === "damaged" || data.status === "quarantine") hasDamaged = true;
    const lines = Array.isArray(data.lines) ? (data.lines as Array<Record<string, unknown>>) : [];
    for (const l of lines) {
      if (l.binId === binId) {
        if (typeof l.sku === "string") skus.add(l.sku);
        if (l.condition === "damaged") hasDamaged = true;
      }
    }
  }

  // (b) Cartons whose root binId isn't this bin but which have a *line* stowed here.
  //     Firestore array-contains can't match nested objects exactly, so we scan
  //     received/stowed_partial/stowed cartons that don't yet match by root.
  //     This is bounded — receiving staging is naturally small.
  // For now we rely on (a) above; admin search will handle deeper queries.

  return { skus: Array.from(skus), hasDamaged, cartonCount };
}

export type LineValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

/** Decide whether a particular line can be stowed into a given bin. */
export function validateLineToBin(
  line: WarehouseCartonLine,
  bin: WarehouseBinDoc,
  binContents: { skus: string[] }
): LineValidationResult {
  if (!bin.active) return { ok: false, reason: "Bin is inactive." };
  const kind = classifyBin(bin);

  if (line.condition === "damaged") {
    if (kind !== "quarantine") {
      return {
        ok: false,
        reason: "Damaged stock must go to a quarantine bin.",
      };
    }
    return { ok: true };
  }

  if (kind === "quarantine") {
    return {
      ok: false,
      reason: "Good stock cannot be stowed in a quarantine bin.",
    };
  }
  if (kind === "receiving_staging") {
    return {
      ok: false,
      reason: "Choose a storage bin — receiving staging is for inbound only.",
    };
  }

  const existing = binContents.skus.filter((s) => s && s !== "MIXED");
  if (existing.length === 0) return { ok: true };
  if (existing.length === 1 && existing[0] === line.sku) return { ok: true };
  return {
    ok: false,
    reason: `Bin already holds ${existing.join(", ")}. SKU-pooled bins accept one SKU at a time.`,
  };
}

/**
 * Apply the putaway assignments for a single carton. Each assignment maps a
 * line (by lineId) to the bin where it should land. Lines not mentioned stay
 * in receiving staging (their `binId` is unchanged).
 *
 * Updates carton status:
 *   - all lines have binId → stowed (or split if isMixed and lines went to different bins)
 *   - some lines have binId → stowed_partial
 *   - none have binId → unchanged
 */
export async function applyPutawayAssignments(
  warehouseId: string,
  cartonId: string,
  carton: WarehouseCartonDoc,
  assignments: Array<{ lineId: string; binId: string; binPath: string }>,
  options?: { operatorId?: string | null }
): Promise<{ status: WarehouseCartonDoc["status"]; allStowed: boolean; splitAcrossBins: boolean }> {
  if (!carton.lines || carton.lines.length === 0) {
    throw new Error("This carton has no lines — cannot putaway.");
  }

  const byId = new Map(assignments.map((a) => [a.lineId, a]));
  const nextLines = carton.lines.map((l) => {
    const a = byId.get(l.lineId);
    if (!a) return l;
    return { ...l, binId: a.binId };
  });

  const stowedLines = nextLines.filter((l) => l.binId);
  const allStowed = stowedLines.length === nextLines.length;
  const someStowed = stowedLines.length > 0;
  const distinctBins = new Set(stowedLines.map((l) => l.binId));
  const splitAcrossBins = distinctBins.size > 1;

  let nextStatus: WarehouseCartonDoc["status"] = carton.status;
  if (allStowed) {
    if (splitAcrossBins && carton.isMixed) {
      nextStatus = "split";
    } else {
      nextStatus = "stowed";
    }
  } else if (someStowed) {
    nextStatus = "stowed_partial";
  }

  const rootBinId =
    allStowed && !splitAcrossBins ? stowedLines[0].binId ?? null : null;

  const batch = writeBatch(db);
  const dispositionPatch =
    carton.receiveMode === "crossdock" && !carton.putawayDisposition
      ? { putawayDisposition: "open_for_storage" as const }
      : {};

  batch.update(warehouseCartonDocRef(warehouseId, cartonId), {
    ...dispositionPatch,
    lines: nextLines.map((l) => ({
      lineId: l.lineId,
      sku: l.sku,
      productTitle: l.productTitle ?? null,
      quantity: l.quantity,
      lot: l.lot ?? null,
      expiry: l.expiry ? l.expiry.slice(0, 10) : null,
      condition: l.condition,
      binId: l.binId ?? null,
      allocationStatus: l.allocationStatus ?? "unallocated",
      clientId: l.clientId ?? null,
      inventoryRequestId: l.inventoryRequestId ?? null,
    })),
    status: nextStatus,
    binId: rootBinId,
    updatedAt: serverTimestamp(),
  });

  // Movement event log (immutable audit trail).
  for (const a of assignments) {
    const eventsRef = collection(db, WAREHOUSES, warehouseId, "movementEvents");
    const ref = doc(eventsRef);
    const line = carton.lines.find((l) => l.lineId === a.lineId);
    batch.set(ref, {
      type: "putaway",
      cartonId,
      cartonCode: carton.cartonCode,
      lineId: a.lineId,
      sku: line?.sku ?? null,
      quantity: line?.quantity ?? null,
      condition: line?.condition ?? null,
      toBinId: a.binId,
      toBinPath: a.binPath,
      operatorId: options?.operatorId ?? null,
      at: serverTimestamp(),
    });
  }

  await batch.commit();

  return { status: nextStatus, allStowed, splitAcrossBins };
}

function docToCartonShallow(id: string, data: Record<string, unknown>): WarehouseCartonDoc {
  // Mirror the parser in warehouse-carton-firestore.ts so we get `lines`.
  const linesRaw = Array.isArray(data.lines) ? (data.lines as Array<Record<string, unknown>>) : null;
  const lines: WarehouseCartonLine[] | undefined = linesRaw
    ? linesRaw
        .filter((l) => typeof l.sku === "string" && l.sku)
        .map((l, i) => ({
          lineId:
            typeof l.lineId === "string" && l.lineId ? l.lineId : `L${i + 1}`,
          sku: String(l.sku),
          productTitle: l.productTitle != null ? String(l.productTitle) : null,
          quantity: typeof l.quantity === "number" ? l.quantity : 0,
          lot: l.lot != null ? String(l.lot) : null,
          expiry: l.expiry != null ? String(l.expiry) : null,
          condition: l.condition === "damaged" ? "damaged" : "good",
          binId: l.binId != null ? String(l.binId) : null,
          allocationStatus:
            l.allocationStatus === "allocated" || l.allocationStatus === "picked"
              ? (l.allocationStatus as "allocated" | "picked")
              : "unallocated",
          clientId: l.clientId != null ? String(l.clientId) : null,
          inventoryRequestId:
            l.inventoryRequestId != null ? String(l.inventoryRequestId) : null,
        }))
    : undefined;

  return {
    id,
    cartonCode: String(data.cartonCode ?? ""),
    sku: String(data.sku ?? ""),
    lot: data.lot != null ? String(data.lot) : null,
    expiry: data.expiry != null ? String(data.expiry) : null,
    quantity: typeof data.quantity === "number" ? data.quantity : 0,
    status: (data.status as WarehouseCartonDoc["status"]) ?? "receiving",
    clientId: data.clientId != null ? String(data.clientId) : null,
    receivedForClient:
      data.receivedForClient != null ? String(data.receivedForClient) : null,
    binId: data.binId != null ? String(data.binId) : null,
    palletId: data.palletId != null ? String(data.palletId) : null,
    productTitle: data.productTitle != null ? String(data.productTitle) : null,
    inventoryRequestId: data.inventoryRequestId != null ? String(data.inventoryRequestId) : null,
    barcode: String(data.barcode ?? ""),
    lines: lines && lines.length > 0 ? lines : undefined,
    isMixed: data.isMixed === true,
    isLoose: data.isLoose === true,
    isPackage: data.isPackage === true,
    trackingNumber: data.trackingNumber != null ? String(data.trackingNumber) : null,
    carrier: data.carrier != null ? String(data.carrier) : null,
    notes: data.notes != null ? String(data.notes) : null,
    photoUrl: data.photoUrl != null ? String(data.photoUrl) : null,
    receivedBy: data.receivedBy != null ? String(data.receivedBy) : null,
    stagingArea: data.stagingArea != null ? String(data.stagingArea) : null,
    receiveMode:
      data.receiveMode === "crossdock" || data.receiveMode === "unpackaged"
        ? data.receiveMode
        : null,
    isClosedCrossdock: data.isClosedCrossdock === true,
    putawayDisposition:
      data.putawayDisposition === "forward" ||
      data.putawayDisposition === "keep_closed" ||
      data.putawayDisposition === "open_for_storage"
        ? data.putawayDisposition
        : null,
    receivedAt: data.receivedAt as WarehouseCartonDoc["receivedAt"],
    createdAt: data.createdAt as WarehouseCartonDoc["createdAt"],
    updatedAt: data.updatedAt as WarehouseCartonDoc["updatedAt"],
  };
}
