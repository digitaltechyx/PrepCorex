import type { UserProfile, WarehouseDoc } from "@/types";

/**
 * Whether a client user's inbound/outbound should appear for this warehouse.
 * - No warehouse link → all clients.
 * - Client with no locations assigned → all warehouses (until admin assigns one).
 * - Otherwise client.locations must include warehouse.linkedLocationId.
 */
export function clientMatchesWarehouse(
  client: UserProfile,
  warehouse: WarehouseDoc
): boolean {
  const linked = String(warehouse.linkedLocationId ?? "").trim();
  if (!linked) return true;
  const locs = Array.isArray(client.locations)
    ? client.locations.map(String).filter(Boolean)
    : [];
  if (locs.length === 0) return true;
  return locs.includes(linked);
}
