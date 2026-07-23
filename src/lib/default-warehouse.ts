import { collection, getDocs, doc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { isDefaultNj2Warehouse } from "@/lib/warehouse-display";

/**
 * Legacy seed for Mount Laurel NJ warehouse. Prefer `locations.isDefaultInbound`
 * once an admin sets a default in Roles & Permissions → Assign Location.
 */
export const DEFAULT_WAREHOUSE_SEED = {
  name: "NJ2",
  country: "United States",
  stateOrProvince: "New Jersey",
  shippingName: "",
  street1: "7000 Atrium Way",
  street2: "Unit B05",
  city: "Mount Laurel",
  state: "NJ",
  zip: "08054",
} as const;

function njStateRank(stateOrProvince: string | undefined): number {
  const s = (stateOrProvince ?? "").trim().toLowerCase();
  if (s === "new jersey" || s === "nj") return 0;
  if (!s) return 1;
  return 2;
}

let cachedDefaultWarehouseId: string | null | undefined;
let cachedAt = 0;
const CACHE_TTL_MS = 15_000;

export function invalidateDefaultWarehouseLocationCache(): void {
  cachedDefaultWarehouseId = undefined;
}

type LocRow = {
  id: string;
  name?: string;
  active?: boolean;
  stateOrProvince?: string;
  isDefaultInbound?: boolean;
};

function pickDefaultFromRows(rows: LocRow[]): string | null {
  const active = rows.filter((l) => l.active !== false);
  const flagged = active.filter((l) => l.isDefaultInbound === true);
  if (flagged.length === 1) return flagged[0].id;
  if (flagged.length > 1) {
    return [...flagged].sort(
      (a, b) => njStateRank(a.stateOrProvince) - njStateRank(b.stateOrProvince)
    )[0].id;
  }
  // Legacy fallback: name normalizes to nj2 (NJ-02)
  const legacy = active.filter((l) => isDefaultNj2Warehouse(l.name));
  if (legacy.length === 0) return null;
  return [...legacy].sort(
    (a, b) => njStateRank(a.stateOrProvince) - njStateRank(b.stateOrProvince)
  )[0].id;
}

/**
 * Firestore id of the active default inbound warehouse.
 * Prefers `isDefaultInbound: true`, then legacy NJ-02 name match.
 */
export async function findDefaultWarehouseLocationId(): Promise<string | null> {
  const now = Date.now();
  if (cachedDefaultWarehouseId !== undefined && now - cachedAt < CACHE_TTL_MS) {
    return cachedDefaultWarehouseId ?? null;
  }
  let snap;
  try {
    snap = await getDocs(collection(db, "locations"));
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e?.code === "permission-denied" || String(e?.message || "").includes("permission")) {
      cachedDefaultWarehouseId = null;
      cachedAt = now;
      return null;
    }
    throw err;
  }
  const rows: LocRow[] = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      name: String(data.name ?? ""),
      active: data.active !== false,
      stateOrProvince: String(data.stateOrProvince ?? ""),
      isDefaultInbound: data.isDefaultInbound === true,
    };
  });
  const id = pickDefaultFromRows(rows);
  cachedDefaultWarehouseId = id;
  cachedAt = now;
  return id;
}

/** Resolve default warehouse id from an in-memory list without an extra query. */
export function findDefaultWarehouseLocationIdInList(
  locations: {
    id: string;
    name?: string;
    active?: boolean;
    stateOrProvince?: string;
    isDefaultInbound?: boolean;
  }[]
): string | undefined {
  return pickDefaultFromRows(locations) ?? undefined;
}

/** Mark one location as the system default inbound warehouse (clears others). */
export async function setDefaultInboundLocation(locationId: string): Promise<void> {
  const snap = await getDocs(collection(db, "locations"));
  const batch = writeBatch(db);
  let targetSeen = false;
  snap.docs.forEach((d) => {
    const shouldBeDefault = d.id === locationId;
    if (shouldBeDefault) targetSeen = true;
    const currently = d.data().isDefaultInbound === true;
    if (shouldBeDefault !== currently) {
      batch.update(d.ref, { isDefaultInbound: shouldBeDefault });
    }
  });
  if (!targetSeen) {
    throw new Error("Location not found.");
  }
  await batch.commit();
  invalidateDefaultWarehouseLocationCache();
}

export function isLocationMarkedDefault(
  loc: { id: string; name?: string; isDefaultInbound?: boolean },
  defaultId: string | null | undefined
): boolean {
  if (defaultId && loc.id === defaultId) return true;
  if (loc.isDefaultInbound === true) return true;
  return false;
}
