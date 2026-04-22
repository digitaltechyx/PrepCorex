import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { isDefaultNj1Warehouse } from "@/lib/warehouse-display";

/**
 * Seed fields for the primary inbound warehouse (Mount Laurel, NJ).
 * Create a `locations` doc with `name` normalizing to **nj1** (e.g. `NJ1` or `nj1`) so it is auto-assigned to clients.
 */
export const DEFAULT_WAREHOUSE_SEED = {
  name: "NJ1",
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

/**
 * Firestore id of the active default warehouse (`nj1` by name), preferring New Jersey when multiple match.
 */
export async function findDefaultWarehouseLocationId(): Promise<string | null> {
  const now = Date.now();
  if (cachedDefaultWarehouseId !== undefined && now - cachedAt < CACHE_TTL_MS) {
    return cachedDefaultWarehouseId ?? null;
  }
  const snap = await getDocs(collection(db, "locations"));
  const matches: { id: string; stateOrProvince?: string }[] = [];
  snap.forEach((d) => {
    const data = d.data();
    if (data.active === false) return;
    const n = String(data.name ?? "");
    if (!isDefaultNj1Warehouse(n)) return;
    matches.push({ id: d.id, stateOrProvince: String(data.stateOrProvince ?? "") });
  });
  if (matches.length === 0) {
    cachedDefaultWarehouseId = null;
    cachedAt = now;
    return null;
  }
  matches.sort((a, b) => njStateRank(a.stateOrProvince) - njStateRank(b.stateOrProvince));
  const id = matches[0].id;
  cachedDefaultWarehouseId = id;
  cachedAt = now;
  return id;
}

/** Resolve default warehouse id from an in-memory list (e.g. sidebar) without an extra query. */
export function findDefaultWarehouseLocationIdInList(
  locations: { id: string; name?: string; active?: boolean; stateOrProvince?: string }[]
): string | undefined {
  const active = locations.filter((l) => l.active !== false);
  const matches = active.filter((l) => isDefaultNj1Warehouse(l.name));
  if (matches.length === 0) return undefined;
  return [...matches].sort(
    (a, b) => njStateRank(a.stateOrProvince) - njStateRank(b.stateOrProvince)
  )[0].id;
}
