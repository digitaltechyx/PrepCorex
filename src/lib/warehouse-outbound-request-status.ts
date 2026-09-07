import type { WarehousePickStatus } from "@/lib/warehouse-pick";

export type WarehousePackStatus = "pending" | "packing" | "ready_to_dispatch";

export type WarehouseDispatchStatus = "ready" | "dispatched";

export function pickStatusFromRequest(data: Record<string, unknown>): WarehousePickStatus {
  const raw = data.warehousePickStatus;
  if (raw === "picking" || raw === "picked" || raw === "ready" || raw === "skipped") {
    return raw;
  }
  return "ready";
}

export function packStatusFromRequest(data: Record<string, unknown>): WarehousePackStatus {
  const raw = data.warehousePackStatus;
  if (raw === "packing" || raw === "ready_to_dispatch") return raw;
  return "pending";
}

export function dispatchStatusFromRequest(data: Record<string, unknown>): WarehouseDispatchStatus {
  return data.warehouseDispatchStatus === "dispatched" ? "dispatched" : "ready";
}

/** True once warehouse has handed the parcel to the carrier (client sync may lag). */
export function isWarehouseDispatchedRequest(data: Record<string, unknown>): boolean {
  if (dispatchStatusFromRequest(data) === "dispatched") return true;
  if (data.warehouseDispatchedAt) return true;
  if (data.warehouseDispatchedClientSyncAt) return true;
  return false;
}
