import type { WarehouseCartonStatus } from "@/types";

/** Whether pickers may allocate this carton (FEFO etc. applied elsewhere). */
export function isCartonPickable(status: WarehouseCartonStatus): boolean {
  return status === "available" || status === "reserved" || status === "stowed";
}

/** Carton statuses that represent "in the building" stock (any allocation state). */
export function isCartonOnHand(status: WarehouseCartonStatus): boolean {
  return (
    status === "receiving" ||
    status === "received" ||
    status === "stowed_partial" ||
    status === "stowed" ||
    status === "available" ||
    status === "reserved" ||
    status === "quarantine" ||
    status === "on_hold" ||
    status === "damaged"
  );
}

const ALLOWED_TRANSITIONS: Record<WarehouseCartonStatus, WarehouseCartonStatus[]> = {
  receiving: ["received", "available", "quarantine", "damaged", "on_hold", "expired"],
  received: ["stowed", "stowed_partial", "split", "available", "quarantine", "damaged", "on_hold", "expired"],
  stowed_partial: ["stowed", "split", "available", "quarantine", "damaged", "on_hold", "expired"],
  stowed: ["split", "available", "reserved", "quarantine", "damaged", "on_hold", "expired", "closed"],
  split: ["closed"],
  available: ["reserved", "on_hold", "quarantine", "damaged", "expired", "closed"],
  quarantine: ["available", "damaged", "on_hold", "expired", "closed"],
  damaged: ["quarantine", "on_hold", "expired", "closed"],
  on_hold: ["available", "quarantine", "damaged", "expired", "closed"],
  reserved: ["available", "on_hold", "expired", "closed"],
  expired: ["closed"],
  closed: [],
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
  received: "Received",
  stowed: "Stowed",
  stowed_partial: "Stowed (partial)",
  split: "Split",
  available: "Available",
  quarantine: "Quarantine",
  damaged: "Damaged",
  expired: "Expired",
  on_hold: "On hold",
  reserved: "Reserved",
  closed: "Closed",
};
