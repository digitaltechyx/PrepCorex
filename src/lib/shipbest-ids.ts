/** Stable ShipBest customNo for a label purchase (max 50 chars). */
export function buildShipBestCustomNo(userId: string, labelPurchaseId: string): string {
  return `PCX-${userId.slice(0, 6)}-${labelPurchaseId}`.slice(0, 50);
}
