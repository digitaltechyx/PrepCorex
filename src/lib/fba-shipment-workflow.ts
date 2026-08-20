import {
  addDoc,
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { FbaMasterCase, FbaPackPhase, FbaPalletPack, FbaShipMode } from "@/types";

export const FBA_SERVICE = "FBA/WFS/TFS" as const;
export const DEFAULT_FBA_PALLET_TARE_LB = 50;

export function isFbaService(service: string | undefined | null): boolean {
  const value = String(service || "").trim();
  return value === FBA_SERVICE || value === "FBA" || value === "WFS" || value === "TFS";
}

export function isFbaLabelWorkflowRequest(data: Record<string, unknown>): boolean {
  return data.fbaLabelWorkflow === true && isFbaService(String(data.service ?? ""));
}

export function fbaPackPhaseFromRequest(
  data: Record<string, unknown>
): FbaPackPhase | null {
  const raw = data.fbaPackPhase;
  if (raw === "awaiting_label" || raw === "awaiting_courier") return raw;
  return null;
}

export function hasFbaPackDimsOnFile(data: {
  fbaMasterCases?: FbaMasterCase[] | null;
  fbaPallets?: FbaPalletPack[] | null;
}): boolean {
  return (data.fbaMasterCases?.length ?? 0) > 0 || (data.fbaPallets?.length ?? 0) > 0;
}

export function preferredFbaShipModeFromRequest(
  data: Record<string, unknown>
): FbaShipMode {
  const stored = String(data.fbaShipMode ?? "").trim().toLowerCase();
  if (stored === "spd" || stored === "ltl") return stored;
  const pref = String(data.shipmentPreference ?? "").trim().toLowerCase();
  if (pref === "pallet") return "ltl";
  return "spd";
}

export function formatFbaMasterCaseSummary(masterCase: FbaMasterCase): string {
  const dims = `${masterCase.length}×${masterCase.width}×${masterCase.height} ${masterCase.dimensionUnit}`;
  return `Case ${masterCase.caseNumber}: ${masterCase.weight} ${masterCase.weightUnit} · ${dims}`;
}

export function formatFbaBoxGroupSummary(
  group: FbaPalletPack["boxGroups"][number],
  index: number
): string {
  const dims = `${group.length}×${group.width}×${group.height} ${group.dimensionUnit}`;
  return `Group ${index + 1}: ${group.boxCount} box${group.boxCount === 1 ? "" : "es"} · ${group.weight} ${group.weightUnit} each · ${dims}`;
}

export function formatFbaPalletSummary(pallet: FbaPalletPack): string {
  const unit = pallet.weightUnit || "lb";
  return `Pallet ${pallet.palletNumber}: ${pallet.boxCount} box${pallet.boxCount === 1 ? "" : "es"} · tare ${pallet.palletTareWeight} ${unit} + boxes ${pallet.boxesWeight} ${unit} = ${pallet.totalWeight} ${unit}`;
}

export function formatFbaPackDimsForClient(data: {
  fbaShipMode?: FbaShipMode | null;
  fbaMasterCases?: FbaMasterCase[] | null;
  fbaPallets?: FbaPalletPack[] | null;
}): string[] {
  const lines: string[] = [];
  if (data.fbaShipMode === "ltl" || (data.fbaPallets?.length ?? 0) > 0) {
    for (const pallet of data.fbaPallets ?? []) {
      lines.push(formatFbaPalletSummary(pallet));
      pallet.boxGroups.forEach((group, index) => {
        lines.push(`  ${formatFbaBoxGroupSummary(group, index)}`);
      });
    }
    return lines;
  }
  for (const masterCase of data.fbaMasterCases ?? []) {
    lines.push(formatFbaMasterCaseSummary(masterCase));
  }
  return lines;
}

export function computePalletWeights(input: {
  palletTareWeight: number;
  boxGroups: Array<{ boxCount: number; weight: number }>;
}): { boxesWeight: number; totalWeight: number } {
  const boxesWeight = input.boxGroups.reduce(
    (sum, g) => sum + Math.max(0, Number(g.boxCount) || 0) * Math.max(0, Number(g.weight) || 0),
    0
  );
  const tare = Math.max(0, Number(input.palletTareWeight) || 0);
  return {
    boxesWeight: Number(boxesWeight.toFixed(2)),
    totalWeight: Number((tare + boxesWeight).toFixed(2)),
  };
}

async function notifyClient(input: {
  clientUserId: string;
  title: string;
  message: string;
  relatedRequestId: string;
  createdBy?: string | null;
}) {
  await addDoc(collection(db, `users/${input.clientUserId}/notifications`), {
    type: "shipment_request",
    title: input.title,
    message: input.message,
    isRead: false,
    targetUrl: "/dashboard",
    relatedRequestId: input.relatedRequestId,
    createdAt: Timestamp.now(),
    createdBy: input.createdBy ?? null,
  });
}

async function notifyWarehouse(input: {
  warehouseId: string;
  title: string;
  message: string;
  clientUserId: string;
  shipmentRequestId: string;
}) {
  await addDoc(collection(db, `warehouses/${input.warehouseId}/opsNotifications`), {
    type: "fba_label_ready",
    title: input.title,
    message: input.message,
    clientUserId: input.clientUserId,
    shipmentRequestId: input.shipmentRequestId,
    isRead: false,
    createdAt: serverTimestamp(),
  });
}

/** After pack verify — warehouse posts SPD master cases or LTL pallet dims; client uploads label next. */
export async function completeFbaPackWithMasterCases(input: {
  clientUserId: string;
  shipmentRequestId: string;
  warehouseId: string;
  operatorId?: string | null;
  verifiedKeys: string[];
  shipMode: FbaShipMode;
  masterCases?: FbaMasterCase[];
  pallets?: FbaPalletPack[];
}): Promise<void> {
  const shipMode = input.shipMode;
  const masterCases = shipMode === "spd" ? input.masterCases ?? [] : [];
  const pallets = shipMode === "ltl" ? input.pallets ?? [] : [];

  if (shipMode === "spd" && masterCases.length === 0) {
    throw new Error("Add at least one master case.");
  }
  if (shipMode === "ltl" && pallets.length === 0) {
    throw new Error("Add at least one pallet.");
  }

  for (const pallet of pallets) {
    const groupBoxes = pallet.boxGroups.reduce((s, g) => s + (Number(g.boxCount) || 0), 0);
    if (groupBoxes !== pallet.boxCount) {
      throw new Error(
        `Pallet ${pallet.palletNumber}: box groups total ${groupBoxes} but pallet has ${pallet.boxCount} boxes.`
      );
    }
    for (const group of pallet.boxGroups) {
      if (
        group.boxCount <= 0 ||
        group.weight <= 0 ||
        group.length <= 0 ||
        group.width <= 0 ||
        group.height <= 0
      ) {
        throw new Error(`Pallet ${pallet.palletNumber} has an incomplete box size group.`);
      }
    }
  }

  const ref = doc(db, `users/${input.clientUserId}/shipmentRequests`, input.shipmentRequestId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Order not found.");

  const data = snap.data() as Record<string, unknown>;
  if (!isFbaLabelWorkflowRequest(data)) {
    throw new Error("This order is not on the FBA label workflow.");
  }
  if (data.status !== "confirmed") {
    throw new Error("Order must be confirmed before completing FBA pack.");
  }
  if (fbaPackPhaseFromRequest(data) === "awaiting_label") {
    throw new Error("Pack dimensions were already submitted.");
  }

  await updateDoc(ref, {
    status: "awaiting_label_upload",
    fbaPackPhase: "awaiting_label",
    fbaShipMode: shipMode,
    fbaMasterCases: masterCases,
    fbaPallets: pallets,
    fbaMasterCaseCompletedAt: serverTimestamp(),
    fbaMasterCaseCompletedBy: input.operatorId ?? null,
    warehouseId: input.warehouseId,
    warehousePackStatus: "packing",
    warehousePackVerifiedKeys: input.verifiedKeys,
    updatedAt: serverTimestamp(),
  });

  await notifyClient({
    clientUserId: input.clientUserId,
    title:
      shipMode === "ltl"
        ? "FBA pallet details ready"
        : "FBA master case details ready",
    message:
      shipMode === "ltl"
        ? "Your FBA shipment has been packed on pallet(s). Review pallet and box dimensions/weights, then upload your shipping label."
        : "Your FBA shipment has been packed. Review master case weight and dimensions, then upload your shipping label.",
    relatedRequestId: input.shipmentRequestId,
    createdBy: input.operatorId ?? null,
  });
}

function mergeLabelUrls(existing: string | undefined | null, newUrls: string[]): string {
  const merged = Array.from(
    new Set(
      [...String(existing || "").split(","), ...newUrls]
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );
  return merged.join(",");
}

/** Client or warehouse uploaded label after master case details. */
export async function recordFbaLabelUpload(input: {
  clientUserId: string;
  shipmentRequestId: string;
  labelUrls: string[];
  uploadedBy: "client" | "warehouse";
  operatorId?: string | null;
  warehouseId?: string | null;
}): Promise<void> {
  if (!input.labelUrls.length) throw new Error("Upload at least one label file.");

  const ref = doc(db, `users/${input.clientUserId}/shipmentRequests`, input.shipmentRequestId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Order not found.");

  const data = snap.data() as Record<string, unknown>;
  if (!isFbaLabelWorkflowRequest(data)) {
    throw new Error("This order is not on the FBA label workflow.");
  }

  const phase = fbaPackPhaseFromRequest(data);
  const canUpload =
    data.status === "awaiting_label_upload" ||
    phase === "awaiting_label" ||
    (data.status === "confirmed" && phase === "awaiting_courier");

  if (!canUpload && data.status !== "pending" && data.status !== "confirmed") {
    throw new Error("This request is not waiting for a label upload.");
  }

  const labelUrl = mergeLabelUrls(String(data.labelUrl ?? ""), input.labelUrls);
  const warehouseId = String(input.warehouseId ?? data.warehouseId ?? "").trim();

  await updateDoc(ref, {
    status: "confirmed",
    fbaPackPhase: "awaiting_courier",
    labelUrl,
    fbaLabelReadyAt: serverTimestamp(),
    fbaLabelUploadedBy: input.uploadedBy,
    ...(input.uploadedBy === "warehouse"
      ? {
          fbaWarehouseLabelUploadedAt: serverTimestamp(),
          fbaWarehouseLabelUploadedBy: input.operatorId ?? null,
        }
      : {
          fbaClientLabelUploadedAt: serverTimestamp(),
        }),
    updatedAt: serverTimestamp(),
  });

  if (warehouseId) {
    await notifyWarehouse({
      warehouseId,
      title: "FBA shipping label ready",
      message:
        input.uploadedBy === "client"
          ? "Client uploaded the FBA shipping label. Scan the courier label to finish pack."
          : "Warehouse uploaded the FBA shipping label. Scan the courier label to finish pack.",
      clientUserId: input.clientUserId,
      shipmentRequestId: input.shipmentRequestId,
    });
  }
}

/**
 * Warehouse will buy/apply the courier label on client's behalf —
 * skip waiting for client label upload and allow finishing pack.
 */
export async function markFbaWarehouseBuysLabel(input: {
  clientUserId: string;
  shipmentRequestId: string;
  operatorId?: string | null;
}): Promise<void> {
  const ref = doc(db, `users/${input.clientUserId}/shipmentRequests`, input.shipmentRequestId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Order not found.");

  const data = snap.data() as Record<string, unknown>;
  if (!isFbaLabelWorkflowRequest(data)) {
    throw new Error("This order is not on the FBA label workflow.");
  }
  if (data.status !== "awaiting_label_upload" && fbaPackPhaseFromRequest(data) !== "awaiting_label") {
    throw new Error("This request is not waiting for a shipping label.");
  }

  await updateDoc(ref, {
    status: "confirmed",
    fbaPackPhase: "awaiting_courier",
    fbaWarehouseBuysLabel: true,
    fbaWarehouseBuysLabelAt: serverTimestamp(),
    fbaWarehouseBuysLabelBy: input.operatorId ?? null,
    updatedAt: serverTimestamp(),
  });
}

/** Warehouse cancels an FBA request waiting for client label. */
export async function cancelFbaAwaitingLabelRequest(input: {
  clientUserId: string;
  shipmentRequestId: string;
  reason: string;
  operatorId?: string | null;
}): Promise<void> {
  const reason = input.reason.trim();
  if (!reason) throw new Error("Cancellation reason is required.");

  const ref = doc(db, `users/${input.clientUserId}/shipmentRequests`, input.shipmentRequestId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Order not found.");

  const data = snap.data() as Record<string, unknown>;
  if (!isFbaLabelWorkflowRequest(data) || data.status !== "awaiting_label_upload") {
    throw new Error("Only FBA requests awaiting label upload can be cancelled here.");
  }

  await updateDoc(ref, {
    status: "cancelled",
    cancelledAt: serverTimestamp(),
    cancelledBy: input.operatorId ?? null,
    cancellationReason: reason,
    fbaPackPhase: null,
    updatedAt: serverTimestamp(),
  });

  await notifyClient({
    clientUserId: input.clientUserId,
    title: "FBA shipment request cancelled",
    message: `Your FBA shipment request was cancelled by the warehouse. Reason: ${reason}`,
    relatedRequestId: input.shipmentRequestId,
    createdBy: input.operatorId ?? null,
  });
}

export type FbaAwaitingLabelOrder = {
  id: string;
  clientUserId: string;
  clientDisplayName?: string;
  service?: string;
  fbaShipMode?: FbaShipMode | null;
  fbaMasterCases?: FbaMasterCase[];
  fbaPallets?: FbaPalletPack[];
  masterCaseCompletedAt: Date | null;
};

function dateFromUnknown(value: unknown): Date | null {
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

/** Orders waiting for client label after master case details were posted. */
export async function loadFbaAwaitingLabelOrders(
  eligibleClientIds: Set<string>
): Promise<FbaAwaitingLabelOrder[]> {
  const out: FbaAwaitingLabelOrder[] = [];
  const pushRow = (d: { id: string; data: () => Record<string, unknown> }, clientUserId: string) => {
    const data = d.data();
    out.push({
      id: d.id,
      clientUserId,
      service: String(data.service ?? ""),
      fbaShipMode: (() => {
        const raw = String(data.fbaShipMode ?? "").trim().toLowerCase();
        if (raw === "spd" || raw === "ltl") return raw;
        return null;
      })(),
      fbaMasterCases: Array.isArray(data.fbaMasterCases)
        ? (data.fbaMasterCases as FbaMasterCase[])
        : [],
      fbaPallets: Array.isArray(data.fbaPallets) ? (data.fbaPallets as FbaPalletPack[]) : [],
      masterCaseCompletedAt:
        dateFromUnknown(data.fbaMasterCaseCompletedAt) ??
        dateFromUnknown(data.updatedAt) ??
        dateFromUnknown(data.confirmedAt),
    });
  };
  try {
    const snap = await getDocs(
      query(
        collectionGroup(db, "shipmentRequests"),
        where("status", "==", "awaiting_label_upload"),
        where("fbaLabelWorkflow", "==", true)
      )
    );
    for (const d of snap.docs) {
      const clientUserId = d.ref.path.split("/")[1] ?? "";
      if (!eligibleClientIds.has(clientUserId)) continue;
      pushRow(d, clientUserId);
    }
  } catch {
    for (const clientUserId of eligibleClientIds) {
      const snap = await getDocs(
        query(
          collection(db, `users/${clientUserId}/shipmentRequests`),
          where("status", "==", "awaiting_label_upload"),
          where("fbaLabelWorkflow", "==", true)
        )
      );
      for (const d of snap.docs) {
        pushRow(d, clientUserId);
      }
    }
  }
  return out;
}
