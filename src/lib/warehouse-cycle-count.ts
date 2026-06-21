import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  orderBy,
  limit,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { warehouseBinsCollectionRef } from "@/lib/warehouse-firestore";
import { findBinByPath } from "@/lib/warehouse-putaway";
import {
  aggregateBinSkuStock,
  listCartonsInBin,
} from "@/lib/warehouse-internal-move";
import type {
  WarehouseBinDoc,
  WarehouseCycleCountBinResult,
  WarehouseCycleCountCountedLine,
  WarehouseCycleCountExpectedLine,
  WarehouseCycleCountTaskDoc,
  WarehouseCycleCountTaskStatus,
  WarehouseCycleCountType,
  WarehouseCycleCountVarianceReason,
} from "@/types";

const WAREHOUSES = "warehouses";

export const CYCLE_COUNT_VARIANCE_REASONS: {
  value: WarehouseCycleCountVarianceReason;
  label: string;
}[] = [
  { value: "miscount", label: "Miscount" },
  { value: "damaged_not_recorded", label: "Damaged not recorded" },
  { value: "found_stock", label: "Found stock" },
  { value: "missing_stock", label: "Missing stock" },
  { value: "mislabeled", label: "Mislabeled carton/bin" },
  { value: "other", label: "Other" },
];

export function warehouseCycleCountTasksCollectionRef(warehouseId: string) {
  return collection(db, WAREHOUSES, warehouseId, "cycleCountTasks");
}

function docToBin(id: string, data: Record<string, unknown>): WarehouseBinDoc {
  return {
    id,
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

function docToTask(id: string, data: Record<string, unknown>): WarehouseCycleCountTaskDoc {
  const binResultsRaw = Array.isArray(data.binResults) ? data.binResults : [];
  return {
    id,
    warehouseId: String(data.warehouseId ?? ""),
    type: (data.type as WarehouseCycleCountType) ?? "spot",
    status: (data.status as WarehouseCycleCountTaskStatus) ?? "open",
    title: String(data.title ?? "Cycle count"),
    binIds: Array.isArray(data.binIds) ? data.binIds.map(String) : [],
    binPaths: Array.isArray(data.binPaths) ? data.binPaths.map(String) : [],
    completedBinIds: Array.isArray(data.completedBinIds)
      ? data.completedBinIds.map(String)
      : [],
    binResults: binResultsRaw as WarehouseCycleCountBinResult[],
    createdBy: data.createdBy != null ? String(data.createdBy) : null,
    createdAt: data.createdAt as WarehouseCycleCountTaskDoc["createdAt"],
    startedAt: data.startedAt as WarehouseCycleCountTaskDoc["startedAt"],
    completedAt: data.completedAt as WarehouseCycleCountTaskDoc["completedAt"],
    cancelledAt: data.cancelledAt as WarehouseCycleCountTaskDoc["cancelledAt"],
    notes: data.notes != null ? String(data.notes) : null,
  };
}

export async function countOpenCycleCountTasks(warehouseId: string): Promise<number> {
  const snap = await getDocs(
    query(
      warehouseCycleCountTasksCollectionRef(warehouseId),
      where("status", "in", ["open", "in_progress"])
    )
  );
  return snap.size;
}

export async function loadActiveCycleCountTasks(
  warehouseId: string
): Promise<WarehouseCycleCountTaskDoc[]> {
  const ref = warehouseCycleCountTasksCollectionRef(warehouseId);
  const snap = await getDocs(
    query(ref, where("status", "in", ["open", "in_progress"]))
  );
  return snap.docs
    .map((d) => docToTask(d.id, d.data() as Record<string, unknown>))
    .sort((a, b) => {
      const aSec = a.createdAt && "seconds" in a.createdAt ? a.createdAt.seconds : 0;
      const bSec = b.createdAt && "seconds" in b.createdAt ? b.createdAt.seconds : 0;
      return bSec - aSec;
    });
}

export async function loadCycleCountTask(
  warehouseId: string,
  taskId: string
): Promise<WarehouseCycleCountTaskDoc | null> {
  const snap = await getDoc(doc(warehouseCycleCountTasksCollectionRef(warehouseId), taskId));
  if (!snap.exists()) return null;
  return docToTask(snap.id, snap.data() as Record<string, unknown>);
}

/** Active bins sorted by path (for supervisor pickers). */
export async function listActiveWarehouseBins(warehouseId: string): Promise<WarehouseBinDoc[]> {
  const snap = await getDocs(
    query(warehouseBinsCollectionRef(warehouseId), where("active", "==", true))
  );
  return snap.docs
    .map((d) => docToBin(d.id, d.data() as Record<string, unknown>))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Bins with at least one stowed carton line (for random spot counts). */
export async function listBinsWithStock(warehouseId: string): Promise<WarehouseBinDoc[]> {
  const binsSnap = await getDocs(
    query(warehouseBinsCollectionRef(warehouseId), where("active", "==", true))
  );
  const bins = binsSnap.docs.map((d) => docToBin(d.id, d.data() as Record<string, unknown>));
  const withStock: WarehouseBinDoc[] = [];

  for (const bin of bins) {
    const occupants = await listCartonsInBin(warehouseId, bin.id);
    if (occupants.length > 0) withStock.push(bin);
  }

  return withStock;
}

export function pickRandomItems<T>(items: T[], count: number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(count, copy.length));
}

export async function buildExpectedLinesForBin(
  warehouseId: string,
  binId: string
): Promise<{
  bin: WarehouseBinDoc | null;
  expectedLines: WarehouseCycleCountExpectedLine[];
  expectedCartons: Array<{ id: string; code: string }>;
}> {
  const binSnap = await getDoc(doc(warehouseBinsCollectionRef(warehouseId), binId));
  if (!binSnap.exists()) {
    return { bin: null, expectedLines: [], expectedCartons: [] };
  }
  const bin = docToBin(binSnap.id, binSnap.data() as Record<string, unknown>);
  const occupants = await listCartonsInBin(warehouseId, binId);
  const rows = aggregateBinSkuStock(occupants);

  const expectedLines: WarehouseCycleCountExpectedLine[] = rows.map((row) => ({
    key: row.key,
    sku: row.sku,
    lot: row.lot,
    expiry: row.expiry,
    condition: row.condition,
    productTitle: row.productTitle,
    expectedQty: row.quantity,
    cartonIds: [...new Set(row.sources.map((s) => s.carton.id))],
    cartonCodes: [...new Set(row.sources.map((s) => s.carton.cartonCode))],
  }));

  const cartonMap = new Map<string, string>();
  for (const { carton } of occupants) {
    cartonMap.set(carton.id, carton.cartonCode);
  }
  const expectedCartons = [...cartonMap.entries()].map(([id, code]) => ({ id, code }));

  return { bin, expectedLines, expectedCartons };
}

export async function createSpotCountTask(input: {
  warehouseId: string;
  title?: string;
  binIds?: string[];
  randomCount?: number;
  createdBy?: string | null;
  notes?: string | null;
  type?: WarehouseCycleCountType;
}): Promise<string> {
  let bins: WarehouseBinDoc[] = [];

  if (input.binIds?.length) {
    for (const binId of input.binIds) {
      const snap = await getDoc(doc(warehouseBinsCollectionRef(input.warehouseId), binId));
      if (snap.exists()) {
        bins.push(docToBin(snap.id, snap.data() as Record<string, unknown>));
      }
    }
  } else if (input.randomCount && input.randomCount > 0) {
    const withStock = await listBinsWithStock(input.warehouseId);
    bins = pickRandomItems(withStock, input.randomCount);
  }

  if (bins.length === 0) {
    throw new Error("No bins selected for this count task.");
  }

  const title =
    input.title?.trim() ||
    `Spot count — ${bins.length} bin${bins.length === 1 ? "" : "s"} — ${new Date().toLocaleDateString()}`;

  const ref = await addDoc(warehouseCycleCountTasksCollectionRef(input.warehouseId), {
    warehouseId: input.warehouseId,
    type: (input.type ?? "spot") as WarehouseCycleCountType,
    status: "open" as WarehouseCycleCountTaskStatus,
    title,
    binIds: bins.map((b) => b.id),
    binPaths: bins.map((b) => b.path),
    completedBinIds: [],
    binResults: [],
    createdBy: input.createdBy ?? null,
    notes: input.notes?.trim() || null,
    createdAt: serverTimestamp(),
  });

  return ref.id;
}

/** One-off floor count — scan any bin without a pre-planned list. */
export async function startQuickBinCount(input: {
  warehouseId: string;
  pathOrBarcode: string;
  createdBy?: string | null;
}): Promise<{
  task: WarehouseCycleCountTaskDoc;
  bin: WarehouseBinDoc;
  expectedLines: WarehouseCycleCountExpectedLine[];
  expectedCartons: Array<{ id: string; code: string }>;
}> {
  const bin = await findBinByPath(input.warehouseId, input.pathOrBarcode.trim());
  if (!bin) throw new Error("Bin not found.");

  const taskId = await createSpotCountTask({
    warehouseId: input.warehouseId,
    binIds: [bin.id],
    title: `Quick count — ${bin.path}`,
    createdBy: input.createdBy,
    type: "quick",
  });
  const task = await loadCycleCountTask(input.warehouseId, taskId);
  if (!task) throw new Error("Count could not be started.");

  const snapshot = await buildExpectedLinesForBin(input.warehouseId, bin.id);
  return {
    task,
    bin,
    expectedLines: snapshot.expectedLines,
    expectedCartons: snapshot.expectedCartons,
  };
}

export async function addBinToSpotCountTask(input: {
  warehouseId: string;
  taskId: string;
  binPathOrBarcode: string;
}): Promise<void> {
  const task = await loadCycleCountTask(input.warehouseId, input.taskId);
  if (!task) throw new Error("Count task not found.");
  if (task.status === "completed" || task.status === "cancelled") {
    throw new Error("This count task is closed.");
  }

  const bin = await findBinByPath(input.warehouseId, input.binPathOrBarcode.trim());
  if (!bin) throw new Error("Bin not found.");

  if (task.binIds.includes(bin.id)) {
    throw new Error("Bin is already on this task.");
  }

  await updateDoc(doc(warehouseCycleCountTasksCollectionRef(input.warehouseId), input.taskId), {
    binIds: [...task.binIds, bin.id],
    binPaths: [...task.binPaths, bin.path],
    updatedAt: serverTimestamp(),
  });
}

export async function cancelCycleCountTask(input: {
  warehouseId: string;
  taskId: string;
}): Promise<void> {
  const task = await loadCycleCountTask(input.warehouseId, input.taskId);
  if (!task) throw new Error("Count task not found.");
  if (task.status === "completed") throw new Error("Completed tasks cannot be cancelled.");

  await updateDoc(doc(warehouseCycleCountTasksCollectionRef(input.warehouseId), input.taskId), {
    status: "cancelled" as WarehouseCycleCountTaskStatus,
    cancelledAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export function defaultCountedLines(
  expectedLines: WarehouseCycleCountExpectedLine[]
): WarehouseCycleCountCountedLine[] {
  return expectedLines.map((line) => ({
    key: line.key,
    sku: line.sku,
    lot: line.lot,
    condition: line.condition,
    expectedQty: line.expectedQty,
    countedQty: line.expectedQty,
    variance: 0,
    varianceReason: null,
    varianceNotes: null,
  }));
}

export function computeVarianceLines(
  lines: WarehouseCycleCountCountedLine[]
): WarehouseCycleCountCountedLine[] {
  return lines.map((line) => ({
    ...line,
    variance: line.countedQty - line.expectedQty,
  }));
}

export function binCountReadyToSubmit(input: {
  expectedCartonIds: string[];
  scannedCartonIds: string[];
  countedLines: WarehouseCycleCountCountedLine[];
  isEmptyBin: boolean;
}): { ok: boolean; reason?: string } {
  if (!input.isEmptyBin) {
    const missing = input.expectedCartonIds.filter((id) => !input.scannedCartonIds.includes(id));
    if (missing.length > 0) {
      return { ok: false, reason: "Scan every expected carton before submitting." };
    }
  }

  for (const line of input.countedLines) {
    if (line.variance !== 0 && !line.varianceReason) {
      return {
        ok: false,
        reason: `Select a variance reason for ${line.sku}${line.lot ? ` · ${line.lot}` : ""}.`,
      };
    }
    if (line.varianceReason === "other" && !line.varianceNotes?.trim()) {
      return {
        ok: false,
        reason: `Add notes for "Other" variance on ${line.sku}.`,
      };
    }
  }

  return { ok: true };
}

export async function submitBinCycleCount(input: {
  warehouseId: string;
  taskId: string;
  binId: string;
  scannedCartonIds: string[];
  scannedCartonCodes: string[];
  countedLines: WarehouseCycleCountCountedLine[];
  operatorId?: string | null;
  notes?: string | null;
}): Promise<WarehouseCycleCountBinResult> {
  const task = await loadCycleCountTask(input.warehouseId, input.taskId);
  if (!task) throw new Error("Count task not found.");
  if (task.status === "completed" || task.status === "cancelled") {
    throw new Error("This count task is closed.");
  }
  if (!task.binIds.includes(input.binId)) {
    throw new Error("This bin is not part of the count task.");
  }
  if (task.completedBinIds.includes(input.binId)) {
    throw new Error("This bin was already counted.");
  }

  const { bin, expectedLines, expectedCartons } = await buildExpectedLinesForBin(
    input.warehouseId,
    input.binId
  );
  if (!bin) throw new Error("Bin not found.");

  const countedLines = computeVarianceLines(input.countedLines);
  const isEmptyBin = expectedCartons.length === 0;
  const ready = binCountReadyToSubmit({
    expectedCartonIds: expectedCartons.map((c) => c.id),
    scannedCartonIds: input.scannedCartonIds,
    countedLines,
    isEmptyBin,
  });
  if (!ready.ok) throw new Error(ready.reason ?? "Cannot submit count.");

  const hasVariance = countedLines.some((l) => l.variance !== 0);

  const binResult: WarehouseCycleCountBinResult = {
    binId: bin.id,
    binPath: bin.path,
    expectedLines,
    scannedCartonIds: input.scannedCartonIds,
    scannedCartonCodes: input.scannedCartonCodes,
    countedLines,
    hasVariance,
    submittedBy: input.operatorId ?? null,
    notes: input.notes?.trim() || null,
    submittedAt: serverTimestamp() as unknown as WarehouseCycleCountBinResult["submittedAt"],
  };

  const nextCompleted = [...task.completedBinIds, bin.id];
  const nextResults = [...task.binResults, binResult];
  const allDone = nextCompleted.length >= task.binIds.length;
  const nextStatus: WarehouseCycleCountTaskStatus = allDone ? "completed" : "in_progress";

  const taskRef = doc(warehouseCycleCountTasksCollectionRef(input.warehouseId), input.taskId);
  await updateDoc(taskRef, {
    completedBinIds: nextCompleted,
    binResults: nextResults,
    status: nextStatus,
    startedAt: task.startedAt ?? serverTimestamp(),
    completedAt: allDone ? serverTimestamp() : task.completedAt ?? null,
    updatedAt: serverTimestamp(),
  });

  const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");
  await addDoc(eventsRef, {
    type: "cycle_count",
    taskId: input.taskId,
    binId: bin.id,
    binPath: bin.path,
    hasVariance,
    countedLines: countedLines.map((l) => ({
      sku: l.sku,
      lot: l.lot,
      condition: l.condition,
      expectedQty: l.expectedQty,
      countedQty: l.countedQty,
      variance: l.variance,
      varianceReason: l.varianceReason ?? null,
      varianceNotes: l.varianceNotes ?? null,
    })),
    scannedCartonIds: input.scannedCartonIds,
    operatorId: input.operatorId ?? null,
    at: serverTimestamp(),
  });

  return binResult;
}

/** Resolve a bin scan against a task's pending bins. */
export async function resolveTaskBinScan(input: {
  warehouseId: string;
  task: WarehouseCycleCountTaskDoc;
  pathOrBarcode: string;
}): Promise<{ bin: WarehouseBinDoc; pending: boolean } | null> {
  const bin = await findBinByPath(input.warehouseId, input.pathOrBarcode.trim());
  if (!bin) return null;
  if (!input.task.binIds.includes(bin.id)) {
    throw new Error("Scanned bin is not on this count task.");
  }
  if (input.task.completedBinIds.includes(bin.id)) {
    throw new Error("This bin was already counted on this task.");
  }
  return { bin, pending: true };
}

export async function loadRecentCycleCountTasks(
  warehouseId: string,
  max = 20
): Promise<WarehouseCycleCountTaskDoc[]> {
  const ref = warehouseCycleCountTasksCollectionRef(warehouseId);
  const snap = await getDocs(query(ref, orderBy("createdAt", "desc"), limit(max)));
  return snap.docs.map((d) => docToTask(d.id, d.data() as Record<string, unknown>));
}
