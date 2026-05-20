import type { WarehouseCartonStatus } from "@/types";

/** Whether pickers may allocate this carton (FEFO etc. applied elsewhere). */
export function isCartonPickable(status: WarehouseCartonStatus): boolean {
  return status === "available" || status === "reserved";
}

const ALLOWED_TRANSITIONS: Record<WarehouseCartonStatus, WarehouseCartonStatus[]> = {
  receiving: ["available", "quarantine", "damaged", "on_hold", "expired"],
  available: ["reserved", "on_hold", "quarantine", "damaged", "expired"],
  quarantine: ["available", "damaged", "on_hold", "expired"],
  damaged: ["quarantine", "on_hold", "expired"],
  on_hold: ["available", "quarantine", "damaged", "expired"],
  reserved: ["available", "on_hold", "expired"],
  expired: [],
};

export function canTransitionCartonStatus(
  from: WarehouseCartonStatus,
  to: WarehouseCartonStatus
): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertCartonStatusTransition(
  from: WarehouseCartonStatus,
  to: WarehouseCartonStatus
): void {
  if (!canTransitionCartonStatus(from, to)) {
    throw new Error(`Cannot change carton status from "${from}" to "${to}".`);
  }
}

/** True when expiry date (YYYY-MM-DD) is strictly before today (local). */
export function isExpiryPast(expiry: string | null | undefined, today = new Date()): boolean {
  if (!expiry?.trim()) return false;
  const d = expiry.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const [y, m, day] = d.split("-").map(Number);
  const exp = new Date(y, m - 1, day);
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return exp < t;
}

export const CARTON_STATUS_LABELS: Record<WarehouseCartonStatus, string> = {
  receiving: "Receiving",
  available: "Available",
  quarantine: "Quarantine",
  damaged: "Damaged",
  expired: "Expired",
  on_hold: "On hold",
  reserved: "Reserved",
};
