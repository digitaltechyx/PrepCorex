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
import type {
  WarehouseCartonDoc,
  WarehouseCartonStatus,
  WarehousePalletDoc,
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
    barcode: String(data.barcode ?? ""),
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
  cartonCode?: string;
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
    barcode,
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
}): Promise<string> {
  const warehouseId = input.warehouseId;
  const palletCode = input.palletCode?.trim() || (await generatePalletCode(warehouseId));
  const barcode = encodePalletBarcode(palletCode);
  const ref = await addDoc(warehousePalletsCollectionRef(warehouseId), {
    palletCode,
    status: input.status ?? "receiving",
    binId: input.binId?.trim() || null,
    barcode,
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

export { cartonBarcodeFromDoc };
