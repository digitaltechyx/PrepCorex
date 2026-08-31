/**
 * Amazon FBA inbound plan creation (Fulfillment Inbound API v2024-03-20).
 * Supports multi-box packing, SPD / LTL, and partnered or own-carrier shipping.
 */

import { amazonSpApiGet, amazonSpApiPost } from "@/lib/amazon-sp-api";
import type { WarehouseDoc } from "@/types";

const INBOUND = "/inbound/fba/2024-03-20";

export type AmazonInboundShippingMode = "SPD" | "LTL";
export type AmazonInboundShippingSolution = "AMAZON_PARTNERED" | "USE_YOUR_OWN";

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function payloadRecord(data: unknown): Record<string, unknown> {
  const root = asRecord(data);
  if (root.payload && typeof root.payload === "object" && !Array.isArray(root.payload)) {
    return root.payload as Record<string, unknown>;
  }
  return root;
}

function spApiErrorMessage(data: unknown, fallback: string): string {
  const err = asRecord(data);
  const errors = Array.isArray(err.errors) ? err.errors : [];
  const first = asRecord(errors[0]);
  const problems = Array.isArray(err.operationProblems) ? err.operationProblems : [];
  const problem = asRecord(problems[0]);
  return String(
    problem.message || problem.Message || first.message || first.Message || err.message || fallback
  );
}

function operationIdFrom(data: unknown): string {
  const rec = payloadRecord(data);
  return String(rec.operationId ?? rec.OperationId ?? "").trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shippingModeApiValue(mode: AmazonInboundShippingMode): string {
  return mode === "LTL" ? "FREIGHT_LTL" : "GROUND_SMALL_PARCEL";
}

function shippingSolutionApiValue(solution: AmazonInboundShippingSolution): string {
  return solution === "AMAZON_PARTNERED" ? "AMAZON_PARTNERED_CARRIER" : "USE_YOUR_OWN_CARRIER";
}

export type AmazonInboundAddress = {
  name: string;
  companyName?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  stateOrProvinceCode: string;
  countryCode: string;
  postalCode: string;
  phoneNumber: string;
  email: string;
};

export type AmazonInboundContactInfo = {
  name: string;
  email: string;
  phoneNumber: string;
};

export type AmazonInboundPlanItemInput = {
  msku: string;
  quantity: number;
  labelOwner?: "SELLER" | "AMAZON" | "NONE";
  prepOwner?: "SELLER" | "AMAZON" | "NONE";
};

export type AmazonInboundBoxInput = {
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  weightLb: number;
  boxCount?: number;
  items: AmazonInboundPlanItemInput[];
};

export type AmazonInboundPalletInput = {
  quantity: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  weightLb: number;
  stackability?: "STACKABLE" | "NON_STACKABLE";
};

export type AmazonInboundFreightInput = {
  declaredValueAmount: number;
  declaredValueCurrency?: string;
  freightClass?: string;
};

export type AmazonInboundShippingInput = {
  mode: AmazonInboundShippingMode;
  solution: AmazonInboundShippingSolution;
  contact: AmazonInboundContactInfo;
  freight?: AmazonInboundFreightInput;
  pallets?: AmazonInboundPalletInput[];
};

export type AmazonFbaInboundCreateInput = {
  accessToken: string;
  planName: string;
  marketplaceId: string;
  sourceAddress: AmazonInboundAddress;
  items: AmazonInboundPlanItemInput[];
  boxes: AmazonInboundBoxInput[];
  shipping: AmazonInboundShippingInput;
};

export type AmazonFbaInboundCreateResult = {
  inboundPlanId: string;
  packingOptionId: string;
  packingGroupId: string;
  placementOptionId: string;
  shipmentIds: string[];
  shippingMode: AmazonInboundShippingMode;
  shippingSolution: AmazonInboundShippingSolution;
  transportationSelections: Array<{ shipmentId: string; transportationOptionId: string }>;
  labels: Array<{
    shipmentId: string;
    shipmentConfirmationId: string | null;
    downloadUrl: string | null;
    labelKind: "parcel" | "pallet";
  }>;
};

export function warehouseToAmazonSourceAddress(
  warehouse: WarehouseDoc,
  contact: { name?: string; email?: string; phone?: string }
): AmazonInboundAddress {
  const street1 = String(warehouse.street1 || "").trim();
  const city = String(warehouse.city || "").trim();
  const state = String(warehouse.stateOrProvince || "").trim();
  const zip = String(warehouse.zip || "").trim();
  const country = String(warehouse.country || "US").trim() || "US";
  if (!street1 || !city || !state || !zip) {
    throw new Error(
      `Warehouse "${warehouse.name || warehouse.code}" is missing a complete address (street, city, state, zip).`
    );
  }
  return {
    name: contact.name?.trim() || warehouse.name || warehouse.code,
    companyName: warehouse.name || warehouse.code,
    addressLine1: street1,
    addressLine2: String(warehouse.street2 || "").trim() || undefined,
    city,
    stateOrProvinceCode: state,
    countryCode: country.length === 2 ? country.toUpperCase() : country.slice(0, 2).toUpperCase(),
    postalCode: zip,
    phoneNumber: contact.phone?.trim() || "0000000000",
    email: contact.email?.trim() || "warehouse@prepcorex.com",
  };
}

export function validateInboundBoxesAgainstPlanItems(
  planItems: AmazonInboundPlanItemInput[],
  boxes: AmazonInboundBoxInput[]
): void {
  if (!boxes.length) throw new Error("Add at least one box.");
  const planned = new Map<string, number>();
  for (const item of planItems) {
    const key = item.msku.trim().toLowerCase();
    planned.set(key, (planned.get(key) || 0) + Math.max(1, Math.floor(item.quantity)));
  }
  const packed = new Map<string, number>();
  for (const box of boxes) {
    if (!box.items.length) throw new Error("Each box must include at least one SKU line.");
    for (const item of box.items) {
      const key = item.msku.trim().toLowerCase();
      if (!key) throw new Error("Box contains an empty SKU.");
      const perBox = Math.max(1, Math.floor(item.quantity));
      const copies = Math.max(1, Math.floor(box.boxCount ?? 1));
      packed.set(key, (packed.get(key) || 0) + perBox * copies);
    }
  }
  for (const [sku, qty] of planned) {
    const packedQty = packed.get(sku) || 0;
    if (packedQty !== qty) {
      throw new Error(
        `Box quantities for ${sku} (${packedQty}) must match plan quantity (${qty}).`
      );
    }
  }
  for (const [sku] of packed) {
    if (!planned.has(sku)) {
      throw new Error(`Box includes SKU not in the inbound plan: ${sku}`);
    }
  }
}

export async function waitForAmazonInboundOperation(input: {
  accessToken: string;
  operationId: string;
  maxAttempts?: number;
  delayMs?: number;
}): Promise<void> {
  const maxAttempts = input.maxAttempts ?? 45;
  const delayMs = input.delayMs ?? 2000;
  for (let i = 0; i < maxAttempts; i++) {
    const res = await amazonSpApiGet({
      path: `${INBOUND}/operations/${encodeURIComponent(input.operationId)}`,
      accessToken: input.accessToken,
    });
    if (!res.ok) {
      throw new Error(spApiErrorMessage(res.data, `Operation status HTTP ${res.status}`));
    }
    const rec = payloadRecord(res.data);
    const status = String(rec.operationStatus ?? rec.status ?? "").toUpperCase();
    if (status === "SUCCESS") return;
    if (status === "FAILED") {
      throw new Error(spApiErrorMessage(rec, "Amazon inbound operation failed"));
    }
    await sleep(delayMs);
  }
  throw new Error("Timed out waiting for Amazon inbound operation");
}

async function postAndWait(accessToken: string, path: string, body?: unknown): Promise<void> {
  const res = await amazonSpApiPost({ path, accessToken, body });
  if (!res.ok) {
    throw new Error(spApiErrorMessage(res.data, `Amazon POST failed HTTP ${res.status}`));
  }
  const operationId = operationIdFrom(res.data);
  if (!operationId) return;
  await waitForAmazonInboundOperation({ accessToken, operationId });
}

export async function createAmazonFbaInboundPlan(input: {
  accessToken: string;
  planName: string;
  marketplaceId: string;
  sourceAddress: AmazonInboundAddress;
  items: AmazonInboundPlanItemInput[];
}): Promise<{ inboundPlanId: string }> {
  if (!input.items.length) throw new Error("Add at least one SKU with quantity.");
  const body = {
    name: input.planName.trim(),
    sourceAddress: input.sourceAddress,
    destinationMarketplaces: [input.marketplaceId],
    items: input.items.map((item) => ({
      msku: item.msku.trim(),
      quantity: Math.max(1, Math.floor(item.quantity)),
      labelOwner: item.labelOwner || "SELLER",
      prepOwner: item.prepOwner || "SELLER",
    })),
  };
  const res = await amazonSpApiPost({
    path: `${INBOUND}/inboundPlans`,
    accessToken: input.accessToken,
    body,
  });
  if (!res.ok) {
    throw new Error(spApiErrorMessage(res.data, `createInboundPlan HTTP ${res.status}`));
  }
  const rec = payloadRecord(res.data);
  const inboundPlanIdFromResponse = String(rec.inboundPlanId ?? "").trim();
  const operationId = operationIdFrom(res.data);
  if (operationId) {
    await waitForAmazonInboundOperation({ accessToken: input.accessToken, operationId });
  }
  if (!inboundPlanIdFromResponse) {
    throw new Error("Amazon did not return inboundPlanId");
  }
  return { inboundPlanId: inboundPlanIdFromResponse };
}

export type AmazonPackingOptionSummary = {
  packingOptionId: string;
  packingGroupIds: string[];
};

export async function setupAmazonFbaPackingOption(input: {
  accessToken: string;
  inboundPlanId: string;
}): Promise<AmazonPackingOptionSummary> {
  const base = `${INBOUND}/inboundPlans/${encodeURIComponent(input.inboundPlanId)}`;
  await postAndWait(input.accessToken, `${base}/packingOptions`);

  const listRes = await amazonSpApiGet({
    path: `${base}/packingOptions`,
    accessToken: input.accessToken,
    query: { pageSize: "20" },
  });
  if (!listRes.ok) {
    throw new Error(spApiErrorMessage(listRes.data, "listPackingOptions failed"));
  }
  const payload = payloadRecord(listRes.data);
  const options = payload.packingOptions;
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error("No packing options returned from Amazon");
  }
  const first = asRecord(options[0]);
  const packingOptionId = String(first.packingOptionId ?? "").trim();
  if (!packingOptionId) throw new Error("Packing option missing packingOptionId");

  const packingGroupIds: string[] = [];
  const packingGroupsRaw = first.packingGroups;
  if (Array.isArray(packingGroupsRaw)) {
    for (const g of packingGroupsRaw) {
      const gid = String(asRecord(g).packingGroupId ?? "").trim();
      if (gid) packingGroupIds.push(gid);
    }
  }
  if (!packingGroupIds.length) {
    throw new Error("Packing option has no packing groups");
  }

  await postAndWait(
    input.accessToken,
    `${base}/packingOptions/${encodeURIComponent(packingOptionId)}/confirmation`
  );

  return { packingOptionId, packingGroupIds };
}

function boxToAmazonPayload(box: AmazonInboundBoxInput) {
  return {
    contentInformationSource: "BOX_CONTENT_PROVIDED",
    dimensions: {
      length: String(box.lengthIn),
      width: String(box.widthIn),
      height: String(box.heightIn),
      unitOfMeasurement: "IN",
    },
    weight: {
      value: String(box.weightLb),
      unit: "LB",
    },
    quantity: Math.max(1, Math.floor(box.boxCount ?? 1)),
    items: box.items.map((item) => ({
      msku: item.msku.trim(),
      quantity: Math.max(1, Math.floor(item.quantity)),
      labelOwner: item.labelOwner || "SELLER",
      prepOwner: item.prepOwner || "SELLER",
    })),
  };
}

export async function setAmazonFbaPackingInformation(input: {
  accessToken: string;
  inboundPlanId: string;
  packingGroupId: string;
  boxes: AmazonInboundBoxInput[];
}): Promise<void> {
  const body = {
    packageGroupings: [
      {
        packingGroupId: input.packingGroupId,
        boxes: input.boxes.map(boxToAmazonPayload),
      },
    ],
  };
  await postAndWait(
    input.accessToken,
    `${INBOUND}/inboundPlans/${encodeURIComponent(input.inboundPlanId)}/packingInformation`,
    body
  );
}

export type AmazonPlacementOptionSummary = {
  placementOptionId: string;
  shipmentIds: string[];
};

export async function setupAmazonFbaPlacementOption(input: {
  accessToken: string;
  inboundPlanId: string;
}): Promise<AmazonPlacementOptionSummary> {
  const base = `${INBOUND}/inboundPlans/${encodeURIComponent(input.inboundPlanId)}`;
  await postAndWait(input.accessToken, `${base}/placementOptions`);

  const listRes = await amazonSpApiGet({
    path: `${base}/placementOptions`,
    accessToken: input.accessToken,
    query: { pageSize: "20" },
  });
  if (!listRes.ok) {
    throw new Error(spApiErrorMessage(listRes.data, "listPlacementOptions failed"));
  }
  const payload = payloadRecord(listRes.data);
  const options = payload.placementOptions;
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error("No placement options returned from Amazon");
  }
  const first = asRecord(options[0]);
  const placementOptionId = String(first.placementOptionId ?? "").trim();
  if (!placementOptionId) throw new Error("Placement option missing placementOptionId");

  const shipmentIds: string[] = [];
  const rawIds = first.shipmentIds;
  if (Array.isArray(rawIds)) {
    for (const id of rawIds) {
      const sid = String(id ?? "").trim();
      if (sid) shipmentIds.push(sid);
    }
  }
  if (!shipmentIds.length) {
    throw new Error("Placement option has no shipment IDs");
  }

  return { placementOptionId, shipmentIds };
}

export type AmazonTransportationOptionRow = {
  shipmentId: string;
  transportationOptionId: string;
  shippingMode: string;
  shippingSolution: string;
  preconditions: string[];
  carrierName: string | null;
};

function transportationOptionsFromPayload(data: unknown): AmazonTransportationOptionRow[] {
  const payload = payloadRecord(data);
  const options = payload.transportationOptions;
  if (!Array.isArray(options)) return [];
  return options.map((opt) => {
    const rec = asRecord(opt);
    const carrier = asRecord(rec.carrier);
    const pre = rec.preconditions;
    return {
      shipmentId: String(rec.shipmentId ?? "").trim(),
      transportationOptionId: String(rec.transportationOptionId ?? "").trim(),
      shippingMode: String(rec.shippingMode ?? "").trim(),
      shippingSolution: String(rec.shippingSolution ?? "").trim(),
      preconditions: Array.isArray(pre) ? pre.map(String) : [],
      carrierName: String(carrier.name ?? "").trim() || null,
    };
  });
}

function pickTransportationOption(
  options: AmazonTransportationOptionRow[],
  shipmentId: string,
  shipping: AmazonInboundShippingInput
): AmazonTransportationOptionRow {
  const wantMode = shippingModeApiValue(shipping.mode);
  const wantSolution = shippingSolutionApiValue(shipping.solution);

  const ranked = options.filter((opt) => opt.shipmentId === shipmentId);
  if (!ranked.length) {
    throw new Error(`No transportation options for shipment ${shipmentId}`);
  }

  const exact = ranked.find(
    (opt) =>
      opt.shippingMode.toUpperCase() === wantMode &&
      opt.shippingSolution.toUpperCase() === wantSolution
  );
  if (exact) return exact;

  const modeMatch = ranked.find((opt) => opt.shippingMode.toUpperCase() === wantMode);
  if (modeMatch) return modeMatch;

  const solutionMatch = ranked.find((opt) => opt.shippingSolution.toUpperCase() === wantSolution);
  if (solutionMatch) return solutionMatch;

  return ranked[0];
}

async function confirmDeliveryWindowIfRequired(input: {
  accessToken: string;
  inboundPlanId: string;
  shipmentId: string;
  preconditions: string[];
}): Promise<void> {
  const needsWindow = input.preconditions.some((p) =>
    p.toUpperCase().includes("DELIVERY_WINDOW")
  );
  if (!needsWindow) return;

  const base = `${INBOUND}/inboundPlans/${encodeURIComponent(input.inboundPlanId)}/shipments/${encodeURIComponent(input.shipmentId)}`;
  await postAndWait(input.accessToken, `${base}/deliveryWindowOptions`);

  const listRes = await amazonSpApiGet({
    path: `${base}/deliveryWindowOptions`,
    accessToken: input.accessToken,
    query: { pageSize: "10" },
  });
  if (!listRes.ok) {
    throw new Error(spApiErrorMessage(listRes.data, "listDeliveryWindowOptions failed"));
  }
  const payload = payloadRecord(listRes.data);
  const windows = payload.deliveryWindowOptions;
  if (!Array.isArray(windows) || !windows.length) {
    throw new Error(`No delivery windows for shipment ${input.shipmentId}`);
  }
  const first = asRecord(windows[0]);
  const deliveryWindowOptionId = String(first.deliveryWindowOptionId ?? "").trim();
  if (!deliveryWindowOptionId) {
    throw new Error("Delivery window option missing deliveryWindowOptionId");
  }

  await postAndWait(
    input.accessToken,
    `${base}/deliveryWindowOptions/${encodeURIComponent(deliveryWindowOptionId)}/confirmation`
  );
}

function palletToAmazonPayload(pallet: AmazonInboundPalletInput) {
  return {
    quantity: Math.max(1, Math.floor(pallet.quantity)),
    dimensions: {
      length: String(pallet.lengthIn),
      width: String(pallet.widthIn),
      height: String(pallet.heightIn),
      unitOfMeasurement: "IN",
    },
    weight: {
      value: String(pallet.weightLb),
      unit: "LB",
    },
    stackability: pallet.stackability || "STACKABLE",
  };
}

function buildShipmentTransportationConfiguration(input: {
  shipmentId: string;
  shipping: AmazonInboundShippingInput;
  readyStart: Date;
  readyEnd: Date;
}) {
  const { shipmentId, shipping, readyStart, readyEnd } = input;
  const config: Record<string, unknown> = {
    shipmentId,
    readyToShipWindow: {
      start: readyStart.toISOString(),
      end: readyEnd.toISOString(),
    },
    contactInformation: {
      name: shipping.contact.name,
      email: shipping.contact.email,
      phoneNumber: shipping.contact.phoneNumber,
    },
  };

  if (shipping.mode === "LTL") {
    const freight = shipping.freight || {
      declaredValueAmount: 500,
      declaredValueCurrency: "USD",
      freightClass: "FC_50",
    };
    config.freightInformation = {
      declaredValue: {
        amount: freight.declaredValueAmount,
        code: freight.declaredValueCurrency || "USD",
      },
      freightClass: freight.freightClass || "FC_50",
    };
    const pallets = shipping.pallets?.length
      ? shipping.pallets
      : [
          {
            quantity: 1,
            lengthIn: 48,
            widthIn: 40,
            heightIn: 48,
            weightLb: 500,
            stackability: "STACKABLE" as const,
          },
        ];
    config.pallets = pallets.map(palletToAmazonPayload);
  }

  return config;
}

export type AmazonTransportationSelection = {
  shipmentId: string;
  transportationOptionId: string;
  shippingMode: string;
  shippingSolution: string;
  carrierName: string | null;
};

export async function setupAmazonFbaTransportation(input: {
  accessToken: string;
  inboundPlanId: string;
  placementOptionId: string;
  shipmentIds: string[];
  shipping: AmazonInboundShippingInput;
}): Promise<AmazonTransportationSelection[]> {
  const base = `${INBOUND}/inboundPlans/${encodeURIComponent(input.inboundPlanId)}`;
  const readyStart = new Date();
  readyStart.setDate(readyStart.getDate() + 1);
  readyStart.setHours(0, 0, 0, 0);
  const readyEnd = new Date(readyStart);
  readyEnd.setDate(readyEnd.getDate() + 7);

  const genBody = {
    placementOptionId: input.placementOptionId,
    shipmentTransportationConfigurations: input.shipmentIds.map((shipmentId) =>
      buildShipmentTransportationConfiguration({
        shipmentId,
        shipping: input.shipping,
        readyStart,
        readyEnd,
      })
    ),
  };
  await postAndWait(input.accessToken, `${base}/transportationOptions`, genBody);

  const listRes = await amazonSpApiGet({
    path: `${base}/transportationOptions`,
    accessToken: input.accessToken,
    query: {
      pageSize: "30",
      placementOptionId: input.placementOptionId,
    },
  });
  if (!listRes.ok) {
    throw new Error(spApiErrorMessage(listRes.data, "listTransportationOptions failed"));
  }

  const allOptions = transportationOptionsFromPayload(listRes.data);
  if (!allOptions.length) {
    throw new Error("No transportation options returned from Amazon");
  }

  const picked: AmazonTransportationSelection[] = [];
  for (const shipmentId of input.shipmentIds) {
    const choice = pickTransportationOption(allOptions, shipmentId, input.shipping);
    if (!choice.transportationOptionId) {
      throw new Error(`No transportation option for shipment ${shipmentId}`);
    }
    await confirmDeliveryWindowIfRequired({
      accessToken: input.accessToken,
      inboundPlanId: input.inboundPlanId,
      shipmentId,
      preconditions: choice.preconditions,
    });
    picked.push({
      shipmentId: choice.shipmentId,
      transportationOptionId: choice.transportationOptionId,
      shippingMode: choice.shippingMode,
      shippingSolution: choice.shippingSolution,
      carrierName: choice.carrierName,
    });
  }

  const deliveryDate =
    input.shipping.solution === "USE_YOUR_OWN"
      ? readyEnd.toISOString().slice(0, 10)
      : undefined;

  await postAndWait(input.accessToken, `${base}/transportationOptions/confirmation`, {
    transportationSelections: picked.map((row) => ({
      shipmentId: row.shipmentId,
      transportationOptionId: row.transportationOptionId,
      contactInformation: {
        name: input.shipping.contact.name,
        email: input.shipping.contact.email,
        phoneNumber: input.shipping.contact.phoneNumber,
      },
      ...(deliveryDate ? { deliveryDate } : {}),
    })),
  });

  await postAndWait(
    input.accessToken,
    `${base}/placementOptions/${encodeURIComponent(input.placementOptionId)}/confirmation`
  );

  return picked;
}

export type AmazonFbaShipmentLabel = {
  shipmentId: string;
  shipmentConfirmationId: string | null;
  downloadUrl: string | null;
  labelKind: "parcel" | "pallet";
};

// --- Wizard UI types (user picks options before ship) ---

export type InboundPackingOptionUi = {
  packingOptionId: string;
  status: string | null;
  feesLabel: string | null;
  packingGroupIds: string[];
  description: string;
};

export type InboundPlacementOptionUi = {
  placementOptionId: string;
  status: string | null;
  shipmentIds: string[];
  feesLabel: string | null;
  expiration: string | null;
  description: string;
};

export type InboundTransportationOptionUi = {
  transportationOptionId: string;
  shipmentId: string;
  shippingMode: string;
  shippingSolution: string;
  carrierName: string | null;
  quoteLabel: string | null;
  preconditions: string[];
  needsDeliveryWindow: boolean;
  description: string;
};

export type InboundDeliveryWindowOptionUi = {
  deliveryWindowOptionId: string;
  shipmentId: string;
  startDate: string | null;
  endDate: string | null;
  validUntil: string | null;
  description: string;
};

function moneyLabel(raw: unknown): string | null {
  const m = asRecord(raw);
  const amount = m.amount ?? m.Amount;
  const code = m.code ?? m.currencyCode ?? m.CurrencyCode ?? "USD";
  if (amount == null || amount === "") return null;
  return `${amount} ${code}`;
}

function feesLabelFromOption(rec: Record<string, unknown>): string | null {
  const fees = rec.fees;
  if (!Array.isArray(fees) || !fees.length) return null;
  const parts = fees
    .map((f) => {
      const fee = asRecord(f);
      const target = String(fee.target ?? fee.type ?? "Fee").trim();
      const value = moneyLabel(fee.value ?? fee.amount ?? fee.cost);
      return value ? `${target}: ${value}` : null;
    })
    .filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

function packingGroupsFromOption(rec: Record<string, unknown>): string[] {
  const ids: string[] = [];
  const groups = rec.packingGroups;
  if (Array.isArray(groups)) {
    for (const g of groups) {
      const gid = String(asRecord(g).packingGroupId ?? "").trim();
      if (gid) ids.push(gid);
    }
  }
  return ids;
}

export async function generateInboundPackingOptionsUi(input: {
  accessToken: string;
  inboundPlanId: string;
}): Promise<InboundPackingOptionUi[]> {
  const base = `${INBOUND}/inboundPlans/${encodeURIComponent(input.inboundPlanId)}`;
  await postAndWait(input.accessToken, `${base}/packingOptions`);

  const listRes = await amazonSpApiGet({
    path: `${base}/packingOptions`,
    accessToken: input.accessToken,
    query: { pageSize: "20" },
  });
  if (!listRes.ok) {
    throw new Error(spApiErrorMessage(listRes.data, "listPackingOptions failed"));
  }
  const payload = payloadRecord(listRes.data);
  const options = payload.packingOptions;
  if (!Array.isArray(options) || !options.length) {
    throw new Error("No packing options returned from Amazon");
  }

  return options.map((opt, index) => {
    const rec = asRecord(opt);
    const packingGroupIds = packingGroupsFromOption(rec);
    const fees = feesLabelFromOption(rec);
    const status = String(rec.status ?? "").trim() || null;
    return {
      packingOptionId: String(rec.packingOptionId ?? "").trim(),
      status,
      feesLabel: fees,
      packingGroupIds,
      description: [
        `Option ${index + 1}`,
        `${packingGroupIds.length} packing group(s)`,
        fees,
        status,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  }).filter((o) => o.packingOptionId);
}

export async function confirmInboundPackingOption(input: {
  accessToken: string;
  inboundPlanId: string;
  packingOptionId: string;
}): Promise<{ packingGroupIds: string[] }> {
  const base = `${INBOUND}/inboundPlans/${encodeURIComponent(input.inboundPlanId)}`;
  await postAndWait(
    input.accessToken,
    `${base}/packingOptions/${encodeURIComponent(input.packingOptionId)}/confirmation`
  );

  const listRes = await amazonSpApiGet({
    path: `${base}/packingOptions`,
    accessToken: input.accessToken,
    query: { pageSize: "20" },
  });
  if (!listRes.ok) {
    throw new Error(spApiErrorMessage(listRes.data, "listPackingOptions failed"));
  }
  const payload = payloadRecord(listRes.data);
  const options = payload.packingOptions;
  const match = Array.isArray(options)
    ? options.find(
        (o) => String(asRecord(o).packingOptionId ?? "") === input.packingOptionId
      )
    : null;
  const packingGroupIds = match ? packingGroupsFromOption(asRecord(match)) : [];
  if (!packingGroupIds.length) {
    throw new Error("Confirmed packing option has no packing groups");
  }
  return { packingGroupIds };
}

export async function generateInboundPlacementOptionsUi(input: {
  accessToken: string;
  inboundPlanId: string;
}): Promise<InboundPlacementOptionUi[]> {
  const base = `${INBOUND}/inboundPlans/${encodeURIComponent(input.inboundPlanId)}`;
  await postAndWait(input.accessToken, `${base}/placementOptions`);

  const listRes = await amazonSpApiGet({
    path: `${base}/placementOptions`,
    accessToken: input.accessToken,
    query: { pageSize: "20" },
  });
  if (!listRes.ok) {
    throw new Error(spApiErrorMessage(listRes.data, "listPlacementOptions failed"));
  }
  const payload = payloadRecord(listRes.data);
  const options = payload.placementOptions;
  if (!Array.isArray(options) || !options.length) {
    throw new Error("No placement options returned from Amazon");
  }

  return options.map((opt, index) => {
    const rec = asRecord(opt);
    const shipmentIds: string[] = [];
    const rawIds = rec.shipmentIds;
    if (Array.isArray(rawIds)) {
      for (const id of rawIds) {
        const sid = String(id ?? "").trim();
        if (sid) shipmentIds.push(sid);
      }
    }
    const fees = feesLabelFromOption(rec);
    const expiration = String(rec.expiration ?? rec.expirationDate ?? "").trim() || null;
    const status = String(rec.status ?? "").trim() || null;
    return {
      placementOptionId: String(rec.placementOptionId ?? "").trim(),
      status,
      shipmentIds,
      feesLabel: fees,
      expiration,
      description: [
        `Option ${index + 1}`,
        `${shipmentIds.length} shipment(s)`,
        fees,
        expiration ? `expires ${expiration}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  }).filter((o) => o.placementOptionId);
}

function transportationOptionsUiFromPayload(
  data: unknown,
  shipmentIds: string[]
): InboundTransportationOptionUi[] {
  const rows = transportationOptionsFromPayload(data);
  return rows.map((row) => {
    const needsDeliveryWindow = row.preconditions.some((p) =>
      p.toUpperCase().includes("DELIVERY_WINDOW")
    );
    return {
      transportationOptionId: row.transportationOptionId,
      shipmentId: row.shipmentId,
      shippingMode: row.shippingMode,
      shippingSolution: row.shippingSolution,
      carrierName: row.carrierName,
      quoteLabel: extractQuoteLabel(data, row.transportationOptionId),
      preconditions: row.preconditions,
      needsDeliveryWindow,
      description: [
        row.carrierName || "Carrier",
        row.shippingMode.replace(/_/g, " "),
        row.shippingSolution.replace(/_/g, " "),
        extractQuoteLabel(data, row.transportationOptionId),
        needsDeliveryWindow ? "delivery window required" : null,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  }).filter((o) => o.transportationOptionId && shipmentIds.includes(o.shipmentId));
}

function extractQuoteLabel(data: unknown, transportationOptionId: string): string | null {
  const payload = payloadRecord(data);
  const options = payload.transportationOptions;
  if (!Array.isArray(options)) return null;
  for (const opt of options) {
    const rec = asRecord(opt);
    if (String(rec.transportationOptionId ?? "") !== transportationOptionId) continue;
    const quote = asRecord(rec.quote);
    const cost = moneyLabel(quote.cost ?? quote.amount);
    if (cost) return cost;
  }
  return null;
}

export async function generateInboundTransportationOptionsUi(input: {
  accessToken: string;
  inboundPlanId: string;
  placementOptionId: string;
  shipmentIds: string[];
  shipping: AmazonInboundShippingInput;
}): Promise<InboundTransportationOptionUi[]> {
  const base = `${INBOUND}/inboundPlans/${encodeURIComponent(input.inboundPlanId)}`;
  const readyStart = new Date();
  readyStart.setDate(readyStart.getDate() + 1);
  readyStart.setHours(0, 0, 0, 0);
  const readyEnd = new Date(readyStart);
  readyEnd.setDate(readyEnd.getDate() + 7);

  const genBody = {
    placementOptionId: input.placementOptionId,
    shipmentTransportationConfigurations: input.shipmentIds.map((shipmentId) =>
      buildShipmentTransportationConfiguration({
        shipmentId,
        shipping: input.shipping,
        readyStart,
        readyEnd,
      })
    ),
  };
  await postAndWait(input.accessToken, `${base}/transportationOptions`, genBody);

  const listRes = await amazonSpApiGet({
    path: `${base}/transportationOptions`,
    accessToken: input.accessToken,
    query: { pageSize: "50", placementOptionId: input.placementOptionId },
  });
  if (!listRes.ok) {
    throw new Error(spApiErrorMessage(listRes.data, "listTransportationOptions failed"));
  }
  const ui = transportationOptionsUiFromPayload(listRes.data, input.shipmentIds);
  if (!ui.length) {
    throw new Error("No transportation options returned from Amazon");
  }
  return ui;
}

export async function generateInboundDeliveryWindowOptionsUi(input: {
  accessToken: string;
  inboundPlanId: string;
  shipmentId: string;
}): Promise<InboundDeliveryWindowOptionUi[]> {
  const base = `${INBOUND}/inboundPlans/${encodeURIComponent(input.inboundPlanId)}/shipments/${encodeURIComponent(input.shipmentId)}`;
  await postAndWait(input.accessToken, `${base}/deliveryWindowOptions`);

  const listRes = await amazonSpApiGet({
    path: `${base}/deliveryWindowOptions`,
    accessToken: input.accessToken,
    query: { pageSize: "20" },
  });
  if (!listRes.ok) {
    throw new Error(spApiErrorMessage(listRes.data, "listDeliveryWindowOptions failed"));
  }
  const payload = payloadRecord(listRes.data);
  const windows = payload.deliveryWindowOptions;
  if (!Array.isArray(windows) || !windows.length) return [];

  return windows.map((w, index) => {
    const rec = asRecord(w);
    const window = asRecord(rec.deliveryWindow ?? rec.window);
    const startDate = String(window.start ?? rec.startDate ?? "").trim() || null;
    const endDate = String(window.end ?? rec.endDate ?? "").trim() || null;
    const validUntil = String(rec.validUntil ?? rec.expiration ?? "").trim() || null;
    return {
      deliveryWindowOptionId: String(rec.deliveryWindowOptionId ?? "").trim(),
      shipmentId: input.shipmentId,
      startDate,
      endDate,
      validUntil,
      description: [
        `Window ${index + 1}`,
        startDate && endDate ? `${startDate} → ${endDate}` : startDate || endDate,
        validUntil ? `valid until ${validUntil}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  }).filter((o) => o.deliveryWindowOptionId);
}

export async function confirmInboundDeliveryWindows(input: {
  accessToken: string;
  inboundPlanId: string;
  selections: Array<{ shipmentId: string; deliveryWindowOptionId: string }>;
}): Promise<void> {
  for (const sel of input.selections) {
    const base = `${INBOUND}/inboundPlans/${encodeURIComponent(input.inboundPlanId)}/shipments/${encodeURIComponent(sel.shipmentId)}`;
    await postAndWait(
      input.accessToken,
      `${base}/deliveryWindowOptions/${encodeURIComponent(sel.deliveryWindowOptionId)}/confirmation`
    );
  }
}

export async function confirmInboundTransportationAndPlacement(input: {
  accessToken: string;
  inboundPlanId: string;
  placementOptionId: string;
  shipping: AmazonInboundShippingInput;
  transportationSelections: Array<{ shipmentId: string; transportationOptionId: string }>;
}): Promise<void> {
  const base = `${INBOUND}/inboundPlans/${encodeURIComponent(input.inboundPlanId)}`;
  const readyEnd = new Date();
  readyEnd.setDate(readyEnd.getDate() + 8);
  const deliveryDate =
    input.shipping.solution === "USE_YOUR_OWN"
      ? readyEnd.toISOString().slice(0, 10)
      : undefined;

  await postAndWait(input.accessToken, `${base}/transportationOptions/confirmation`, {
    transportationSelections: input.transportationSelections.map((row) => ({
      shipmentId: row.shipmentId,
      transportationOptionId: row.transportationOptionId,
      contactInformation: {
        name: input.shipping.contact.name,
        email: input.shipping.contact.email,
        phoneNumber: input.shipping.contact.phoneNumber,
      },
      ...(deliveryDate ? { deliveryDate } : {}),
    })),
  });

  await postAndWait(
    input.accessToken,
    `${base}/placementOptions/${encodeURIComponent(input.placementOptionId)}/confirmation`
  );
}

export async function finalizeInboundWizardShipment(input: {
  accessToken: string;
  inboundPlanId: string;
  placementOptionId: string;
  shipmentIds: string[];
  shipping: AmazonInboundShippingInput;
  transportationSelections: Array<{ shipmentId: string; transportationOptionId: string }>;
  deliveryWindowSelections: Array<{ shipmentId: string; deliveryWindowOptionId: string }>;
  transportationOptions: InboundTransportationOptionUi[];
}): Promise<{
  transportationSelections: AmazonTransportationSelection[];
  labels: AmazonFbaShipmentLabel[];
}> {
  if (input.deliveryWindowSelections.length) {
    await confirmInboundDeliveryWindows({
      accessToken: input.accessToken,
      inboundPlanId: input.inboundPlanId,
      selections: input.deliveryWindowSelections,
    });
  } else {
    for (const sel of input.transportationSelections) {
      const opt = input.transportationOptions.find(
        (o) => o.transportationOptionId === sel.transportationOptionId
      );
      if (opt?.needsDeliveryWindow) {
        throw new Error(
          `Shipment ${sel.shipmentId} requires a delivery window before confirming transportation.`
        );
      }
    }
  }

  await confirmInboundTransportationAndPlacement({
    accessToken: input.accessToken,
    inboundPlanId: input.inboundPlanId,
    placementOptionId: input.placementOptionId,
    shipping: input.shipping,
    transportationSelections: input.transportationSelections,
  });

  const picked: AmazonTransportationSelection[] = input.transportationSelections.map((sel) => {
    const opt = input.transportationOptions.find(
      (o) => o.transportationOptionId === sel.transportationOptionId
    );
    return {
      shipmentId: sel.shipmentId,
      transportationOptionId: sel.transportationOptionId,
      shippingMode: opt?.shippingMode || "",
      shippingSolution: opt?.shippingSolution || "",
      carrierName: opt?.carrierName || null,
    };
  });

  const palletCount = input.shipping.pallets?.reduce(
    (sum, p) => sum + Math.max(1, Math.floor(p.quantity)),
    0
  );

  const labels = await fetchAmazonFbaInboundLabels({
    accessToken: input.accessToken,
    inboundPlanId: input.inboundPlanId,
    shipmentIds: input.shipmentIds,
    shippingMode: input.shipping.mode,
    palletCount,
  });

  return { transportationSelections: picked, labels };
}

export async function fetchAmazonFbaInboundLabels(input: {
  accessToken: string;
  inboundPlanId: string;
  shipmentIds: string[];
  shippingMode: AmazonInboundShippingMode;
  palletCount?: number;
}): Promise<AmazonFbaShipmentLabel[]> {
  const isLtl = input.shippingMode === "LTL";
  const labels: AmazonFbaShipmentLabel[] = [];

  for (const shipmentId of input.shipmentIds) {
    const shipRes = await amazonSpApiGet({
      path: `${INBOUND}/inboundPlans/${encodeURIComponent(input.inboundPlanId)}/shipments/${encodeURIComponent(shipmentId)}`,
      accessToken: input.accessToken,
    });
    if (!shipRes.ok) {
      throw new Error(spApiErrorMessage(shipRes.data, `getShipment failed for ${shipmentId}`));
    }
    const ship = payloadRecord(shipRes.data);
    const shipmentConfirmationId =
      String(ship.shipmentConfirmationId ?? ship.ShipmentConfirmationId ?? "").trim() || null;

    let downloadUrl: string | null = null;
    if (shipmentConfirmationId) {
      const query: Record<string, string> = isLtl
        ? {
            PageType: "PackageLabel_Plain_Paper",
            LabelType: "PALLET",
            PageSize: "1",
            NumberOfPallets: String(Math.max(1, input.palletCount ?? 1)),
          }
        : {
            PageType: "PackageLabel_Letter_2",
            LabelType: "DEFAULT",
            PageSize: "1",
          };

      const labelRes = await amazonSpApiGet({
        path: `/fba/inbound/v0/shipments/${encodeURIComponent(shipmentConfirmationId)}/labels`,
        accessToken: input.accessToken,
        query,
      });
      if (labelRes.ok) {
        const labelPayload = payloadRecord(labelRes.data);
        downloadUrl =
          String(labelPayload.DownloadURL ?? labelPayload.downloadUrl ?? "").trim() || null;
      }
    }

    labels.push({
      shipmentId,
      shipmentConfirmationId,
      downloadUrl,
      labelKind: isLtl ? "pallet" : "parcel",
    });
  }
  return labels;
}

/** Full inbound creation with multi-box packing and shipping mode selection. */
export async function runAmazonFbaInboundCreation(
  input: AmazonFbaInboundCreateInput
): Promise<AmazonFbaInboundCreateResult> {
  validateInboundBoxesAgainstPlanItems(input.items, input.boxes);

  if (input.shipping.mode === "LTL") {
    if (!input.shipping.pallets?.length) {
      throw new Error("LTL shipments require at least one pallet configuration.");
    }
  }

  const { inboundPlanId } = await createAmazonFbaInboundPlan({
    accessToken: input.accessToken,
    planName: input.planName,
    marketplaceId: input.marketplaceId,
    sourceAddress: input.sourceAddress,
    items: input.items,
  });

  const { packingOptionId, packingGroupIds } = await setupAmazonFbaPackingOption({
    accessToken: input.accessToken,
    inboundPlanId,
  });

  await setAmazonFbaPackingInformation({
    accessToken: input.accessToken,
    inboundPlanId,
    packingGroupId: packingGroupIds[0],
    boxes: input.boxes,
  });

  const { placementOptionId, shipmentIds } = await setupAmazonFbaPlacementOption({
    accessToken: input.accessToken,
    inboundPlanId,
  });

  const transportationSelections = await setupAmazonFbaTransportation({
    accessToken: input.accessToken,
    inboundPlanId,
    placementOptionId,
    shipmentIds,
    shipping: input.shipping,
  });

  const palletCount = input.shipping.pallets?.reduce(
    (sum, p) => sum + Math.max(1, Math.floor(p.quantity)),
    0
  );

  const labels = await fetchAmazonFbaInboundLabels({
    accessToken: input.accessToken,
    inboundPlanId,
    shipmentIds,
    shippingMode: input.shipping.mode,
    palletCount,
  });

  return {
    inboundPlanId,
    packingOptionId,
    packingGroupId: packingGroupIds[0],
    placementOptionId,
    shipmentIds,
    shippingMode: input.shipping.mode,
    shippingSolution: input.shipping.solution,
    transportationSelections,
    labels,
  };
}
