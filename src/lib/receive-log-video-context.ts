import type { UserProfile, WarehouseCartonDoc, WarehouseCartonLine, WarehousePalletDoc } from "@/types";
import type { WarehouseCameraRequestSummary } from "@/lib/warehouse-camera-types";

export type ReceiveLogVideoContext = {
  canUpload: boolean;
  disabledReason?: string;
  clientUserId: string | null;
  clientDisplayName: string;
  inventoryRequestIds: string[];
  requestSummaries: WarehouseCameraRequestSummary[];
};

function collectRequestIds(
  carton?: WarehouseCartonDoc,
  pallet?: WarehousePalletDoc
): string[] {
  const ids = new Set<string>();
  if (carton?.inventoryRequestId?.trim()) {
    ids.add(carton.inventoryRequestId.trim());
  }
  carton?.lines?.forEach((line) => {
    if (line.inventoryRequestId?.trim()) ids.add(line.inventoryRequestId.trim());
  });
  if (pallet && "inventoryRequestId" in pallet) {
    const palletRequestId = (pallet as { inventoryRequestId?: string | null }).inventoryRequestId?.trim();
    if (palletRequestId) ids.add(palletRequestId);
  }
  return [...ids];
}

function summariesFromLines(
  requestIds: string[],
  lines: WarehouseCartonLine[]
): WarehouseCameraRequestSummary[] {
  if (lines.length === 0) {
    return requestIds.map((id) => ({
      id,
      productName: "Inbound receive",
      sku: null,
      quantity: 0,
    }));
  }
  const primaryId = requestIds[0];
  return lines.map((line, index) => ({
    id: line.inventoryRequestId?.trim() || primaryId || `line-${index}`,
    productName: line.productTitle?.trim() || line.sku,
    sku: line.sku,
    quantity: line.quantity,
  }));
}

export function buildReceiveLogVideoContext(input: {
  carton?: WarehouseCartonDoc;
  pallet?: WarehousePalletDoc;
  clientLabel: string | null;
  lines: Array<{
    sku: string;
    productTitle: string | null;
    quantity: number;
    inventoryRequestId?: string | null;
  }>;
  users: UserProfile[];
}): ReceiveLogVideoContext {
  const clientUserId =
    input.carton?.clientId?.trim() ||
    input.pallet?.clientId?.trim() ||
    null;

  const inventoryRequestIds = collectRequestIds(input.carton, input.pallet);
  input.lines.forEach((line) => {
    if (line.inventoryRequestId?.trim()) {
      inventoryRequestIds.push(line.inventoryRequestId.trim());
    }
  });
  const uniqueRequestIds = [...new Set(inventoryRequestIds)];

  const matchedUser = clientUserId
    ? input.users.find((user) => user.uid === clientUserId)
    : undefined;
  const clientDisplayName =
    matchedUser?.companyName?.trim() ||
    matchedUser?.name?.trim() ||
    input.clientLabel?.trim() ||
    "Client";

  if (!clientUserId) {
    return {
      canUpload: false,
      disabledReason: "Link a PrepCorex client on this receive first",
      clientUserId: null,
      clientDisplayName,
      inventoryRequestIds: uniqueRequestIds,
      requestSummaries: [],
    };
  }

  if (uniqueRequestIds.length === 0) {
    return {
      canUpload: false,
      disabledReason: "No inbound request linked to this receive",
      clientUserId,
      clientDisplayName,
      inventoryRequestIds: [],
      requestSummaries: [],
    };
  }

  const cartonLines: WarehouseCartonLine[] =
    input.carton?.lines ??
    input.lines.map((line, index) => ({
      lineId: `line-${index}`,
      sku: line.sku,
      productTitle: line.productTitle,
      quantity: line.quantity,
      condition: "good" as const,
      inventoryRequestId: line.inventoryRequestId ?? null,
    }));

  return {
    canUpload: true,
    clientUserId,
    clientDisplayName,
    inventoryRequestIds: uniqueRequestIds,
    requestSummaries: summariesFromLines(uniqueRequestIds, cartonLines),
  };
}
