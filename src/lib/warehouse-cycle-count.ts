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
  writeBatch,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { warehouseBinsCollectionRef } from "@/lib/warehouse-firestore";
import { findBinByPath } from "@/lib/warehouse-putaway";
import {
  aggregateBinSkuStock,
  listCartonsInBin,
  sortSourcesFefo,
} from "@/lib/warehouse-internal-move";
import {
  binStockKey,
  linesToFirestorePayload,
  rollCartonBinStateFromLines,
} from "@/lib/warehouse-carton-line-utils";
import { warehouseCartonDocRef } from "@/lib/warehouse-carton-firestore";
import type {
  WarehouseBinDoc,
  WarehouseCartonDoc,
  WarehouseCycleCountBinResult,
  WarehouseCycleCountCountedLine,
  WarehouseCycleCountExpectedLine,
  WarehouseCycleCountResolveAction,
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
  { value: "found_missing_stock", label: "Found missing stock" },
  { value: "found_additional_stock", label: "Found additional stock" },
  { value: "damaged_not_recorded", label: "Damaged not recorded" },
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

export function isAssignedCycleCountTask(task: Pick<WarehouseCycleCountTaskDoc, "type">): boolean {
  return task.type !== "quick";
}

export async function countOpenCycleCountTasks(warehouseId: string): Promise<number> {
  const tasks = await loadActiveCycleCountTasks(warehouseId);
  return tasks.filter(isAssignedCycleCountTask).length;
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

export function cycleCountTimestampToDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "object" && value !== null && "toDate" in value) {
    try {
      const d = (value as { toDate: () => Date }).toDate();
      return Number.isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }
  if (typeof value === "object" && value !== null && "seconds" in value) {
    const seconds = Number((value as { seconds: number }).seconds);
    if (!Number.isFinite(seconds)) return null;
    return new Date(seconds * 1000);
  }
  return null;
}

export function varianceReasonLabel(
  reason: WarehouseCycleCountVarianceReason | null | undefined
): string {
  if (!reason) return "—";
  if (reason === "miscount") return "Found missing / additional (legacy)";
  if (reason === "missing_stock") return "Found missing stock";
  if (reason === "found_stock") return "Found additional stock";
  return CYCLE_COUNT_VARIANCE_REASONS.find((r) => r.value === reason)?.label ?? reason;
}

export type CycleCountTaskReportRow = {
  task: WarehouseCycleCountTaskDoc;
  binsCounted: number;
  binsTotal: number;
  varianceBinCount: number;
  varianceLineCount: number;
  unresolvedVarianceLineCount: number;
  createdAt: Date | null;
  completedAt: Date | null;
};

export function isCycleCountLineUnresolved(
  line: WarehouseCycleCountCountedLine
): boolean {
  return line.variance !== 0 && !line.resolveStatus;
}

export function buildCycleCountTaskReportRow(
  task: WarehouseCycleCountTaskDoc
): CycleCountTaskReportRow {
  const varianceBinCount = task.binResults.filter((r) => r.hasVariance).length;
  const varianceLineCount = task.binResults.reduce(
    (n, r) => n + r.countedLines.filter((l) => l.variance !== 0).length,
    0
  );
  const unresolvedVarianceLineCount = task.binResults.reduce(
    (n, r) => n + r.countedLines.filter((l) => isCycleCountLineUnresolved(l)).length,
    0
  );
  return {
    task,
    binsCounted: task.completedBinIds.length,
    binsTotal: task.binIds.length,
    varianceBinCount,
    varianceLineCount,
    unresolvedVarianceLineCount,
    createdAt: cycleCountTimestampToDate(task.createdAt),
    completedAt: cycleCountTimestampToDate(task.completedAt),
  };
}

/** Admin / supervisor report feed — completed first, then recent others. */
export async function loadCycleCountTasksForReport(
  warehouseId: string,
  max = 100
): Promise<CycleCountTaskReportRow[]> {
  const tasks = await loadRecentCycleCountTasks(warehouseId, max);
  return tasks
    .map(buildCycleCountTaskReportRow)
    .sort((a, b) => {
      const ta = a.completedAt?.getTime() ?? a.createdAt?.getTime() ?? 0;
      const tb = b.completedAt?.getTime() ?? b.createdAt?.getTime() ?? 0;
      return tb - ta;
    });
}

async function syncClientInventoryForSku(input: {
  clientUserId: string;
  sku: string;
  delta: number;
  adminId: string;
  note: string;
}): Promise<string | null> {
  if (!input.clientUserId || input.delta === 0) return null;
  const invCol = collection(db, `users/${input.clientUserId}/inventory`);
  const snap = await getDocs(query(invCol, where("sku", "==", input.sku), limit(5)));
  if (snap.empty) {
    // Try productName matching sku when sku field missing
    return `Client inventory row not found for SKU ${input.sku} — warehouse updated only.`;
  }
  const docSnap = snap.docs[0]!;
  const data = docSnap.data() as { quantity?: number; status?: string };
  const current = Math.max(0, Number(data.quantity) || 0);
  const next = Math.max(0, current + input.delta);
  await updateDoc(docSnap.ref, {
    quantity: next,
    status: next > 0 ? "In Stock" : "Out of Stock",
    updatedAt: Timestamp.now(),
    lastCycleCountAdjustBy: input.adminId,
    lastCycleCountAdjustNote: input.note,
  });
  return `Client inventory ${input.sku}: ${current} → ${next}`;
}

/**
 * Adjust warehouse carton lines in a bin so physical count can be applied.
 * Negative delta removes qty; positive adds onto an existing matching line.
 */
async function applyWarehouseQtyDelta(input: {
  warehouseId: string;
  binId: string;
  sku: string;
  lot: string | null;
  condition: "good" | "damaged";
  delta: number;
  operatorId: string;
  taskId: string;
}): Promise<{ detail: string; clientId: string | null }> {
  const abs = Math.abs(Math.floor(input.delta));
  if (abs < 1) throw new Error("Nothing to adjust.");

  const occupants = await listCartonsInBin(input.warehouseId, input.binId);
  const rows = aggregateBinSkuStock(occupants);
  const key = binStockKey({
    sku: input.sku,
    lot: input.lot,
    condition: input.condition,
  });
  const row = rows.find((r) => r.key === key);

  const batch = writeBatch(db);
  const cartonsToUpdate = new Map<string, WarehouseCartonDoc>();
  for (const { carton } of occupants) {
    cartonsToUpdate.set(carton.id, carton);
  }

  let clientId: string | null = null;
  const touchedIds = new Set<string>();

  if (input.delta < 0) {
    if (!row || row.quantity < abs) {
      throw new Error(
        row
          ? `Only ${row.quantity} of ${input.sku} in bin now — cannot remove ${abs}.`
          : `No ${input.sku} currently in this bin to reduce.`
      );
    }
    let remaining = abs;
    for (const { carton, line } of sortSourcesFefo(row.sources)) {
      if (remaining <= 0) break;
      const current = cartonsToUpdate.get(carton.id);
      if (!current?.lines?.length) continue;
      const live = current.lines.find((l) => l.lineId === line.lineId);
      if (!live || live.allocationStatus === "picked") continue;
      const take = Math.min(remaining, live.quantity);
      const nextLines = current.lines
        .map((l) => {
          if (l.lineId !== live.lineId) return l;
          const q = l.quantity - take;
          return q > 0 ? { ...l, quantity: q } : null;
        })
        .filter(Boolean) as NonNullable<(typeof current.lines)[number]>[];

      if (!clientId) {
        clientId =
          (live.clientId && String(live.clientId)) ||
          (current.clientId && String(current.clientId)) ||
          null;
      }

      cartonsToUpdate.set(carton.id, { ...current, lines: nextLines });
      touchedIds.add(carton.id);
      remaining -= take;
    }
    if (remaining > 0) {
      throw new Error("Could not remove the full missing quantity from warehouse cartons.");
    }
  } else {
    if (!row || row.sources.length === 0) {
      throw new Error(
        `No existing ${input.sku} carton in this bin to add found stock onto. Receive or move the unit into the bin first, then apply.`
      );
    }
    const { carton, line } = sortSourcesFefo(row.sources)[0]!;
    const current = cartonsToUpdate.get(carton.id);
    if (!current?.lines?.length) {
      throw new Error("Carton for found stock could not be loaded.");
    }
    const nextLines = current.lines.map((l) =>
      l.lineId === line.lineId ? { ...l, quantity: l.quantity + abs } : l
    );
    clientId =
      (line.clientId && String(line.clientId)) ||
      (current.clientId && String(current.clientId)) ||
      null;
    cartonsToUpdate.set(carton.id, { ...current, lines: nextLines });
    touchedIds.add(carton.id);
  }

  const touchedCodes: string[] = [];
  for (const id of touchedIds) {
    const updated = cartonsToUpdate.get(id);
    if (!updated) continue;
    touchedCodes.push(updated.cartonCode);
    const { status, binId } = rollCartonBinStateFromLines(updated, updated.lines ?? []);
    batch.update(warehouseCartonDocRef(input.warehouseId, updated.id), {
      lines: linesToFirestorePayload(updated.lines ?? []),
      status,
      binId,
      quantity:
        updated.lines?.reduce((n, l) => n + (Number(l.quantity) || 0), 0) ?? updated.quantity,
      updatedAt: serverTimestamp(),
    });
  }

  const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");
  batch.set(doc(eventsRef), {
    type: "cycle_count_resolve",
    taskId: input.taskId,
    binId: input.binId,
    sku: input.sku,
    lot: input.lot,
    condition: input.condition,
    quantityDelta: input.delta,
    cartonCodes: touchedCodes,
    operatorId: input.operatorId,
    at: serverTimestamp(),
  });

  await batch.commit();

  return {
    detail: `${input.delta > 0 ? "Added" : "Removed"} ${abs} × ${input.sku} on ${touchedCodes.join(", ")}`,
    clientId,
  };
}

/** Admin resolves a variance line from the cycle count report. */
export async function resolveCycleCountVariance(input: {
  warehouseId: string;
  taskId: string;
  binId: string;
  lineKey: string;
  action: WarehouseCycleCountResolveAction;
  adminId: string;
  notes?: string | null;
  syncClientInventory?: boolean;
}): Promise<{ task: WarehouseCycleCountTaskDoc; detail: string }> {
  const task = await loadCycleCountTask(input.warehouseId, input.taskId);
  if (!task) throw new Error("Count task not found.");

  const binIdx = task.binResults.findIndex((b) => b.binId === input.binId);
  if (binIdx < 0) throw new Error("Bin result not found on this task.");
  const bin = task.binResults[binIdx]!;
  const lineIdx = bin.countedLines.findIndex((l) => l.key === input.lineKey);
  if (lineIdx < 0) throw new Error("Variance line not found.");
  const line = bin.countedLines[lineIdx]!;
  if (line.variance === 0) throw new Error("This line has no variance.");
  if (line.resolveStatus) throw new Error("This variance was already resolved.");

  const notes = input.notes?.trim() || null;
  let detail = "";
  let resolveStatus:
    | "applied"
    | "acknowledged"
    | "miscount"
    | "found_missing_stock"
    | "found_additional_stock";

  if (input.action === "acknowledge") {
    resolveStatus = "acknowledged";
    detail = "Marked acknowledged — no warehouse qty change.";
  } else if (input.action === "found_missing_stock" || input.action === "miscount") {
    resolveStatus = "found_missing_stock";
    detail = "Closed as found missing stock — no warehouse qty change.";
  } else if (input.action === "found_additional_stock") {
    resolveStatus = "found_additional_stock";
    detail = "Closed as found additional stock — no warehouse qty change.";
  } else {
    resolveStatus = "applied";
    const applied = await applyWarehouseQtyDelta({
      warehouseId: input.warehouseId,
      binId: input.binId,
      sku: line.sku,
      lot: line.lot,
      condition: line.condition,
      delta: line.variance,
      operatorId: input.adminId,
      taskId: input.taskId,
    });
    detail = applied.detail;
    if (input.syncClientInventory !== false && applied.clientId) {
      const invNote = await syncClientInventoryForSku({
        clientUserId: applied.clientId,
        sku: line.sku,
        delta: line.variance,
        adminId: input.adminId,
        note: `Cycle count ${input.taskId} · ${bin.binPath}`,
      });
      if (invNote) detail = `${detail}. ${invNote}`;
    } else if (input.syncClientInventory !== false && !applied.clientId) {
      detail = `${detail}. No client on carton — client inventory not changed.`;
    }
  }

  const nextLine: WarehouseCycleCountCountedLine = {
    ...line,
    resolveStatus,
    resolveAction: input.action,
    resolveNotes: notes,
    resolvedAt: Timestamp.now(),
    resolvedBy: input.adminId,
    resolveDetail: detail,
  };

  const nextCounted = [...bin.countedLines];
  nextCounted[lineIdx] = nextLine;
  const nextBin: WarehouseCycleCountBinResult = { ...bin, countedLines: nextCounted };
  const nextResults = [...task.binResults];
  nextResults[binIdx] = nextBin;

  const taskRef = doc(warehouseCycleCountTasksCollectionRef(input.warehouseId), input.taskId);
  await updateDoc(taskRef, {
    binResults: nextResults,
    updatedAt: serverTimestamp(),
  });

  const refreshed = await loadCycleCountTask(input.warehouseId, input.taskId);
  if (!refreshed) throw new Error("Task updated but could not reload.");
  return { task: refreshed, detail };
}
