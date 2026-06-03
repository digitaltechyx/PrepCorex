import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { encodeCartonBarcode, encodePalletBarcode, cartonBarcodeFromDoc } from "@/lib/warehouse-carton-barcode";
import {
  assertCartonStatusTransition,
  isExpiryPast,
} from "@/lib/warehouse-carton-states";
import { resolveReceiveLot } from "@/lib/warehouse-receive-lot";
import type {
  WarehouseCartonDoc,
  WarehouseCartonLine,
  WarehouseCartonStatus,
  WarehousePalletDoc,
  WarehousePutawayDisposition,
  WarehouseReceiveMode,
  WarehousePalletStatus,
} from "@/types";

const WAREHOUSES = "warehouses";
/** One doc per warehouse: `warehouseLabelCounters/{warehouseId}` */
const LABEL_COUNTERS = "warehouseLabelCounters";

export function warehouseCartonsCollectionRef(warehouseId: string) {
  return collection(db, WAREHOUSES, warehouseId, "cartons");
}

export function warehouseCartonDocRef(warehouseId: string, cartonId: string) {
  return doc(db, WAREHOUSES, warehouseId, "cartons", cartonId);
}

export function warehousePalletsCollectionRef(warehouseId: string) {
  return collection(db, WAREHOUSES, warehouseId, "pallets");
}

export function warehousePalletDocRef(warehouseId: string, palletId: string) {
  return doc(db, WAREHOUSES, warehouseId, "pallets", palletId);
}

function counterDocRef(warehouseId: string) {
  return doc(db, LABEL_COUNTERS, warehouseId);
}

async function nextLabelSequence(
  warehouseId: string,
  field: "cartonSeq" | "palletSeq"
): Promise<number> {
  const ref = counterDocRef(warehouseId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const year = new Date().getFullYear();
    const data = snap.exists() ? snap.data() : {};
    const storedYear = typeof data.year === "number" ? data.year : year;
    let seq = typeof data[field] === "number" ? data[field] : 0;
    if (storedYear !== year) {
      seq = 0;
    }
    seq += 1;
    tx.set(
      ref,
      {
        year,
        [field]: seq,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return seq;
  });
}

export async function generateCartonCode(warehouseId: string): Promise<string> {
  const seq = await nextLabelSequence(warehouseId, "cartonSeq");
  const year = new Date().getFullYear();
  return `CTN-${year}-${String(seq).padStart(5, "0")}`;
}

export async function generatePalletCode(warehouseId: string): Promise<string> {
  const seq = await nextLabelSequence(warehouseId, "palletSeq");
  const year = new Date().getFullYear();
  return `PAL-${year}-${String(seq).padStart(5, "0")}`;
}

function parseLines(raw: unknown): WarehouseCartonLine[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: WarehouseCartonLine[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const sku = typeof obj.sku === "string" ? obj.sku : "";
    if (!sku) continue;
    out.push({
      lineId: typeof obj.lineId === "string" && obj.lineId ? obj.lineId : `L${out.length + 1}`,
      sku,
      productTitle: obj.productTitle != null ? String(obj.productTitle) : null,
      quantity: typeof obj.quantity === "number" ? obj.quantity : 0,
      lot: obj.lot != null ? String(obj.lot) : null,
      expiry: obj.expiry != null ? String(obj.expiry) : null,
      condition: obj.condition === "damaged" ? "damaged" : "good",
      binId: obj.binId != null ? String(obj.binId) : null,
      allocationStatus:
        obj.allocationStatus === "allocated" || obj.allocationStatus === "picked"
          ? (obj.allocationStatus as "allocated" | "picked")
          : "unallocated",
      clientId: obj.clientId != null ? String(obj.clientId) : null,
      inventoryRequestId: obj.inventoryRequestId != null ? String(obj.inventoryRequestId) : null,
    });
  }
  return out.length > 0 ? out : undefined;
}

function lineToFirestore(line: WarehouseCartonLine): Record<string, unknown> {
  return {
    lineId: line.lineId,
    sku: line.sku,
    productTitle: line.productTitle ?? null,
    quantity: Math.max(0, Math.floor(line.quantity)),
    lot: line.lot ?? null,
    expiry: line.expiry ? line.expiry.slice(0, 10) : null,
    condition: line.condition,
    binId: line.binId ?? null,
    allocationStatus: line.allocationStatus ?? "unallocated",
    clientId: line.clientId ?? null,
    inventoryRequestId: line.inventoryRequestId ?? null,
  };
}

function docToCarton(id: string, data: Record<string, unknown>): WarehouseCartonDoc {
  return {
    id,
    cartonCode: String(data.cartonCode ?? ""),
    sku: String(data.sku ?? ""),
    lot: data.lot != null ? String(data.lot) : null,
    expiry: data.expiry != null ? String(data.expiry) : null,
    quantity: typeof data.quantity === "number" ? data.quantity : 0,
    status: (data.status as WarehouseCartonStatus) ?? "receiving",
    clientId: data.clientId != null ? String(data.clientId) : null,
    binId: data.binId != null ? String(data.binId) : null,
    palletId: data.palletId != null ? String(data.palletId) : null,
    productTitle: data.productTitle != null ? String(data.productTitle) : null,
    inventoryRequestId: data.inventoryRequestId != null ? String(data.inventoryRequestId) : null,
    barcode: String(data.barcode ?? ""),
    lines: parseLines(data.lines),
    isMixed: data.isMixed === true,
    isLoose: data.isLoose === true,
    receiveMode:
      data.receiveMode === "crossdock" || data.receiveMode === "unpackaged"
        ? data.receiveMode
        : null,
    putawayDisposition:
      data.putawayDisposition === "forward" ||
      data.putawayDisposition === "keep_closed" ||
      data.putawayDisposition === "open_for_storage"
        ? data.putawayDisposition
        : null,
    trackingNumber: data.trackingNumber != null ? String(data.trackingNumber) : null,
    carrier: data.carrier != null ? String(data.carrier) : null,
    notes: data.notes != null ? String(data.notes) : null,
    photoUrl: data.photoUrl != null ? String(data.photoUrl) : null,
    receivedBy: data.receivedBy != null ? String(data.receivedBy) : null,
    stagingArea: data.stagingArea != null ? String(data.stagingArea) : null,
    receivedAt: data.receivedAt as WarehouseCartonDoc["receivedAt"],
    voidedAt: data.voidedAt as WarehouseCartonDoc["voidedAt"],
    voidedBy: data.voidedBy != null ? String(data.voidedBy) : null,
    voidReason: data.voidReason != null ? String(data.voidReason) : null,
    correctedAt: data.correctedAt as WarehouseCartonDoc["correctedAt"],
    correctedBy: data.correctedBy != null ? String(data.correctedBy) : null,
    createdAt: data.createdAt as WarehouseCartonDoc["createdAt"],
    updatedAt: data.updatedAt as WarehouseCartonDoc["updatedAt"],
  };
}

function docToPallet(id: string, data: Record<string, unknown>): WarehousePalletDoc {
  return {
    id,
    palletCode: String(data.palletCode ?? ""),
    status: (data.status as WarehousePalletStatus) ?? "receiving",
    binId: data.binId != null ? String(data.binId) : null,
    barcode: String(data.barcode ?? ""),
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
    putawayDisposition:
      data.putawayDisposition === "forward" ||
      data.putawayDisposition === "keep_closed" ||
      data.putawayDisposition === "open_for_storage"
        ? data.putawayDisposition
        : null,
    receivedAt: data.receivedAt as WarehousePalletDoc["receivedAt"],
    createdAt: data.createdAt as WarehousePalletDoc["createdAt"],
    updatedAt: data.updatedAt as WarehousePalletDoc["updatedAt"],
  };
}

export async function listWarehouseCartons(warehouseId: string): Promise<WarehouseCartonDoc[]> {
  const snap = await getDocs(warehouseCartonsCollectionRef(warehouseId));
  return snap.docs
    .map((d) => docToCarton(d.id, d.data() as Record<string, unknown>))
    .sort((a, b) => b.cartonCode.localeCompare(a.cartonCode));
}

export async function listWarehousePallets(warehouseId: string): Promise<WarehousePalletDoc[]> {
  const snap = await getDocs(warehousePalletsCollectionRef(warehouseId));
  return snap.docs
    .map((d) => docToPallet(d.id, d.data() as Record<string, unknown>))
    .sort((a, b) => b.palletCode.localeCompare(a.palletCode));
}

export async function countCartonsInBin(warehouseId: string, binId: string): Promise<number> {
  const q = query(warehouseCartonsCollectionRef(warehouseId), where("binId", "==", binId));
  const snap = await getDocs(q);
  return snap.size;
}

export async function createWarehouseCarton(input: {
  warehouseId: string;
  sku: string;
  quantity: number;
  lot?: string | null;
  expiry?: string | null;
  status?: WarehouseCartonStatus;
  clientId?: string | null;
  binId?: string | null;
  palletId?: string | null;
  productTitle?: string | null;
  inventoryRequestId?: string | null;
  cartonCode?: string;
  lines?: WarehouseCartonLine[];
  isMixed?: boolean;
  isLoose?: boolean;
  receiveMode?: WarehouseReceiveMode | null;
  putawayDisposition?: WarehousePutawayDisposition | null;
  trackingNumber?: string | null;
  carrier?: string | null;
  notes?: string | null;
  photoUrl?: string | null;
  receivedBy?: string | null;
  stagingArea?: string | null;
}): Promise<string> {
  const warehouseId = input.warehouseId;
  const cartonCode = input.cartonCode?.trim() || (await generateCartonCode(warehouseId));
  const sku = input.sku.trim();
  if (!sku) throw new Error("SKU is required.");
  const quantity = Math.max(0, Math.floor(input.quantity));
  if (quantity < 1) throw new Error("Quantity must be at least 1.");

  let status: WarehouseCartonStatus = input.status ?? "receiving";
  if (input.expiry && isExpiryPast(input.expiry)) {
    status = "expired";
  }

  const barcode = encodeCartonBarcode({
    cartonCode,
    sku,
    lot: input.lot,
    expiry: input.expiry,
    quantity,
  });

  const linesPayload = input.lines && input.lines.length > 0 ? input.lines.map(lineToFirestore) : null;

  const ref = await addDoc(warehouseCartonsCollectionRef(warehouseId), {
    cartonCode,
    sku,
    lot: input.lot?.trim() || null,
    expiry: input.expiry?.trim().slice(0, 10) || null,
    quantity,
    status,
    clientId: input.clientId?.trim() || null,
    binId: input.binId?.trim() || null,
    palletId: input.palletId?.trim() || null,
    productTitle: input.productTitle?.trim() || null,
    inventoryRequestId: input.inventoryRequestId?.trim() || null,
    barcode,
    ...(linesPayload ? { lines: linesPayload } : {}),
    ...(input.isMixed != null ? { isMixed: !!input.isMixed } : {}),
    ...(input.isLoose != null ? { isLoose: !!input.isLoose } : {}),
    ...(input.receiveMode ? { receiveMode: input.receiveMode } : {}),
    ...(input.putawayDisposition ? { putawayDisposition: input.putawayDisposition } : {}),
    ...(input.trackingNumber !== undefined ? { trackingNumber: input.trackingNumber?.trim() || null } : {}),
    ...(input.carrier !== undefined ? { carrier: input.carrier?.trim() || null } : {}),
    ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
    ...(input.photoUrl !== undefined ? { photoUrl: input.photoUrl?.trim() || null } : {}),
    ...(input.receivedBy !== undefined ? { receivedBy: input.receivedBy?.trim() || null } : {}),
    ...(input.stagingArea !== undefined ? { stagingArea: input.stagingArea?.trim() || null } : {}),
    ...(status === "received" ? { receivedAt: serverTimestamp() } : {}),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function createWarehousePallet(input: {
  warehouseId: string;
  status?: WarehousePalletStatus;
  binId?: string | null;
  palletCode?: string;
  trackingNumber?: string | null;
  carrier?: string | null;
  notes?: string | null;
  photoUrl?: string | null;
  receivedBy?: string | null;
  stagingArea?: string | null;
  receiveMode?: WarehouseReceiveMode | null;
  putawayDisposition?: WarehousePutawayDisposition | null;
}): Promise<string> {
  const warehouseId = input.warehouseId;
  const palletCode = input.palletCode?.trim() || (await generatePalletCode(warehouseId));
  const barcode = encodePalletBarcode(palletCode);
  const ref = await addDoc(warehousePalletsCollectionRef(warehouseId), {
    palletCode,
    status: input.status ?? "receiving",
    binId: input.binId?.trim() || null,
    barcode,
    ...(input.trackingNumber !== undefined ? { trackingNumber: input.trackingNumber?.trim() || null } : {}),
    ...(input.carrier !== undefined ? { carrier: input.carrier?.trim() || null } : {}),
    ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
    ...(input.photoUrl !== undefined ? { photoUrl: input.photoUrl?.trim() || null } : {}),
    ...(input.receivedBy !== undefined ? { receivedBy: input.receivedBy?.trim() || null } : {}),
    ...(input.stagingArea !== undefined ? { stagingArea: input.stagingArea?.trim() || null } : {}),
    ...(input.receiveMode ? { receiveMode: input.receiveMode } : {}),
    ...(input.putawayDisposition ? { putawayDisposition: input.putawayDisposition } : {}),
    ...(input.status === "receiving" ? { receivedAt: serverTimestamp() } : {}),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateWarehouseCarton(
  warehouseId: string,
  cartonId: string,
  patch: Partial<
    Pick<
      WarehouseCartonDoc,
      "lot" | "expiry" | "quantity" | "status" | "binId" | "palletId" | "clientId" | "productTitle"
    >
  >
): Promise<void> {
  const ref = warehouseCartonDocRef(warehouseId, cartonId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Carton not found.");
  const current = docToCarton(snap.id, snap.data() as Record<string, unknown>);

  if (patch.status != null && patch.status !== current.status) {
    assertCartonStatusTransition(current.status, patch.status);
  }

  const quantity =
    patch.quantity != null ? Math.max(0, Math.floor(patch.quantity)) : current.quantity;
  const lot = patch.lot !== undefined ? patch.lot?.trim() || null : current.lot;
  const expiry =
    patch.expiry !== undefined ? patch.expiry?.trim().slice(0, 10) || null : current.expiry;

  let status = patch.status ?? current.status;
  if (expiry && isExpiryPast(expiry) && status !== "expired") {
    status = "expired";
  }

  const barcode = encodeCartonBarcode({
    cartonCode: current.cartonCode,
    sku: current.sku,
    lot,
    expiry,
    quantity,
  });

  await updateDoc(ref, {
    ...(patch.lot !== undefined ? { lot } : {}),
    ...(patch.expiry !== undefined ? { expiry } : {}),
    ...(patch.quantity != null ? { quantity } : {}),
    ...(patch.status != null || status !== current.status ? { status } : {}),
    ...(patch.binId !== undefined ? { binId: patch.binId?.trim() || null } : {}),
    ...(patch.palletId !== undefined ? { palletId: patch.palletId?.trim() || null } : {}),
    ...(patch.clientId !== undefined ? { clientId: patch.clientId?.trim() || null } : {}),
    ...(patch.productTitle !== undefined
      ? { productTitle: patch.productTitle?.trim() || null }
      : {}),
    barcode,
    updatedAt: serverTimestamp(),
  });
}

/** Mark cartons past expiry as `expired` (run on warehouse carton list load). */
export async function markExpiredCartonsForWarehouse(warehouseId: string): Promise<number> {
  const snap = await getDocs(
    query(
      warehouseCartonsCollectionRef(warehouseId),
      where("status", "in", ["receiving", "available", "quarantine", "on_hold", "reserved", "damaged"])
    )
  );
  const batch = writeBatch(db);
  let count = 0;
  for (const d of snap.docs) {
    const data = d.data();
    const expiry = data.expiry as string | undefined;
    if (!expiry || !isExpiryPast(expiry)) continue;
    batch.update(d.ref, { status: "expired", updatedAt: serverTimestamp() });
    count += 1;
  }
  if (count > 0) await batch.commit();
  return count;
}

export async function linkCartonsToPallet(
  warehouseId: string,
  palletId: string,
  cartonIds: string[]
): Promise<void> {
  const batch = writeBatch(db);
  for (const cartonId of cartonIds) {
    batch.update(warehouseCartonDocRef(warehouseId, cartonId), {
      palletId,
      updatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
}

/**
 * Unified receiving batch. Optionally wraps cartons in a pallet, supports
 * single-SKU or mixed-line cartons, and can produce N identical "copies" of
 * each carton config in one click. Status defaults to "received".
 */
export async function createReceiveBatch(input: {
  warehouseId: string;
  receivedBy?: string | null;
  stagingArea?: string | null;
  /** When provided, all cartons in the batch are wrapped in a new pallet. */
  pallet?: {
    trackingNumber?: string | null;
    carrier?: string | null;
    notes?: string | null;
    photoUrl?: string | null;
  };
  /** True when this batch represents loose inventory (not packed in cartons). */
  isLoose?: boolean;
  receiveMode?: WarehouseReceiveMode | null;
  cartons: Array<{
    /** How many physical copies of this carton config to create. */
    copies: number;
    lines: Array<{
      sku: string;
      productTitle?: string | null;
      quantity: number;
      lot?: string | null;
      expiry?: string | null;
      /** When true, this line is recorded as damaged → quarantine candidate. */
      damaged?: boolean;
    }>;
    trackingNumber?: string | null;
    carrier?: string | null;
    notes?: string | null;
    photoUrl?: string | null;
  }>;
}): Promise<{ palletId: string | null; cartonIds: string[] }> {
  if (!input.cartons || input.cartons.length === 0) {
    throw new Error("At least one carton is required.");
  }

  let palletId: string | null = null;
  if (input.pallet) {
    palletId = await createWarehousePallet({
      warehouseId: input.warehouseId,
      status: "receiving",
      trackingNumber: input.pallet.trackingNumber ?? null,
      carrier: input.pallet.carrier ?? null,
      notes: input.pallet.notes ?? null,
      photoUrl: input.pallet.photoUrl ?? null,
      receivedBy: input.receivedBy ?? null,
      stagingArea: input.stagingArea ?? null,
      receiveMode: input.receiveMode ?? null,
    });
  }

  const cartonIds: string[] = [];
  for (const cfg of input.cartons) {
    const copies = Math.max(1, Math.floor(cfg.copies || 1));
    const validLines = cfg.lines.filter(
      (l) => l.sku.trim() && Math.max(0, Math.floor(l.quantity)) >= 1
    );
    if (validLines.length === 0) {
      throw new Error("Each carton must have at least one line with SKU and quantity ≥ 1.");
    }

    for (let copy = 0; copy < copies; copy++) {
      const lines: WarehouseCartonLine[] = validLines.map((l, i) => {
        const sku = l.sku.trim();
        const expiry = l.expiry?.trim().slice(0, 10) || null;
        const lot = resolveReceiveLot({ sku, expiry, lot: l.lot });
        return {
        lineId: `L${i + 1}`,
        sku,
        productTitle: l.productTitle?.trim() || null,
        quantity: Math.max(1, Math.floor(l.quantity)),
        lot,
        expiry,
        condition: l.damaged ? "damaged" : "good",
        binId: null,
        allocationStatus: "unallocated",
        clientId: null,
        inventoryRequestId: null,
      };
      });

      const totalQty = lines.reduce((s, l) => s + l.quantity, 0);
      const isMixed = new Set(lines.map((l) => l.sku)).size > 1;
      const rootSku = isMixed ? "MIXED" : lines[0].sku;
      const rootLot = isMixed ? null : lines[0].lot ?? null;
      const rootExpiry = isMixed ? null : lines[0].expiry ?? null;
      const rootTitle = isMixed
        ? `Mixed — ${new Set(lines.map((l) => l.sku)).size} SKUs`
        : lines[0].productTitle ?? null;

      const cartonId = await createWarehouseCarton({
        warehouseId: input.warehouseId,
        sku: rootSku,
        quantity: totalQty,
        lot: rootLot,
        expiry: rootExpiry,
        productTitle: rootTitle,
        status: "received",
        palletId,
        lines,
        isMixed,
        isLoose: input.isLoose ?? false,
        receiveMode: input.receiveMode ?? null,
        trackingNumber: cfg.trackingNumber ?? input.pallet?.trackingNumber ?? null,
        carrier: cfg.carrier ?? input.pallet?.carrier ?? null,
        notes: cfg.notes ?? null,
        photoUrl: cfg.photoUrl ?? null,
        receivedBy: input.receivedBy ?? null,
        stagingArea: input.stagingArea ?? null,
      });
      cartonIds.push(cartonId);
    }
  }

  return { palletId, cartonIds };
}

/**
 * Update lines of a carton (used by Putaway to mark `binId` per line and roll
 * the carton status to stowed / stowed_partial / split).
 */
export async function updateCartonLines(
  warehouseId: string,
  cartonId: string,
  lines: WarehouseCartonLine[],
  options?: { status?: WarehouseCartonStatus; binId?: string | null }
): Promise<void> {
  const ref = warehouseCartonDocRef(warehouseId, cartonId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Carton not found.");
  const current = docToCarton(snap.id, snap.data() as Record<string, unknown>);

  const next: Partial<Record<string, unknown>> = {
    lines: lines.map(lineToFirestore),
    updatedAt: serverTimestamp(),
  };

  if (options?.status && options.status !== current.status) {
    assertCartonStatusTransition(current.status, options.status);
    next.status = options.status;
  }
  if (options?.binId !== undefined) {
    next.binId = options.binId ? String(options.binId) : null;
  }
  await updateDoc(ref, next);
}

export { cartonBarcodeFromDoc };
