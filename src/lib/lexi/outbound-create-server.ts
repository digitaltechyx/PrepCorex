import { adminDb } from "@/lib/firebase-admin";
import { computeOutboundLinePricing } from "@/lib/outbound-bulk-import";
import { loadUserPrepPricingContext } from "@/lib/user-prep-pricing-server";
import type { LexiOutboundCreatePayload, LexiOutboundLinePayload } from "@/lib/lexi/types";
import type { ServiceType } from "@/types";

export type LexiOutboundLineInput = {
  productId: string;
  productName?: string;
  sku?: string;
  quantity: number;
  packOf?: number;
};

const VALID_SERVICES = new Set<ServiceType>(["FBA/WFS/TFS", "DTC/FBM"]);

function normalizeService(raw: string): ServiceType | null {
  const value = String(raw ?? "").trim();
  if (value === "FBA" || value === "WFS" || value === "TFS" || value === "FBA/WFS/TFS") {
    return "FBA/WFS/TFS";
  }
  if (value === "DTC/FBM" || value === "FBM" || value === "DTC" || value === "Merchant") {
    return "DTC/FBM";
  }
  return VALID_SERVICES.has(value as ServiceType) ? (value as ServiceType) : null;
}

function normalizeShipmentPreference(raw: string): "box" | "pallet" | null {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "box" || value === "spd" || value === "small parcel") return "box";
  if (value === "pallet" || value === "ltl") return "pallet";
  return null;
}

/** Validate lines, pricing, and stock; return a client-ready outbound create payload. */
export async function prepareLexiOutboundCreate(opts: {
  clientUserId: string;
  clientUserName: string;
  service: string;
  shipmentPreference: string;
  productType?: string;
  shipTo?: string;
  remarks?: string;
  lines: LexiOutboundLineInput[];
}): Promise<LexiOutboundCreatePayload> {
  const service = normalizeService(opts.service);
  if (!service) {
    throw new Error(
      'service is required. Ask the admin: "FBA/WFS/TFS" for Amazon/Walmart marketplace prep, or "DTC/FBM" for merchant-fulfilled.'
    );
  }
  const shipmentPreference = normalizeShipmentPreference(opts.shipmentPreference);
  if (!shipmentPreference) {
    throw new Error(
      'shipmentPreference is required. Ask the admin: "box" (small parcel / SPD) or "pallet" (LTL).'
    );
  }
  if (!opts.lines.length) {
    throw new Error("At least one product line is required.");
  }

  const productTypeRaw = String(opts.productType ?? "Standard").trim();
  const productType =
    productTypeRaw === "Custom" || productTypeRaw === "Large" ? productTypeRaw : "Standard";

  const pricing = await loadUserPrepPricingContext(opts.clientUserId);
  const demandByProduct = new Map<string, number>();
  const preparedLines: LexiOutboundLinePayload[] = [];

  for (const line of opts.lines) {
    const productId = String(line.productId ?? "").trim();
    if (!productId) throw new Error("Each line needs productId from find_products.");

    const productSnap = await adminDb()
      .collection(`users/${opts.clientUserId}/inventory`)
      .doc(productId)
      .get();
    if (!productSnap.exists) {
      throw new Error(`Product ${productId} not found in client inventory.`);
    }
    const product = productSnap.data()!;
    const packOf = Math.max(1, Math.floor(Number(line.packOf) || 1));
    const quantity = Math.floor(Number(line.quantity));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("Each line quantity must be a positive whole number (packs/boxes).");
    }

    const units = quantity * packOf;
    demandByProduct.set(productId, (demandByProduct.get(productId) || 0) + units);

    const { unitPrice, totalPrice } = computeOutboundLinePricing(
      pricing.prepRules,
      service,
      quantity,
      packOf,
      undefined,
      { productId, productPrepRates: pricing.productPrepRates }
    );
    if (unitPrice <= 0) {
      const name = String(product.productName ?? line.productName ?? productId);
      throw new Error(
        `No prep pricing for "${name}" on ${service}. Set the client's pricing tariff before creating outbound.`
      );
    }

    preparedLines.push({
      productId,
      productName: String(product.productName ?? line.productName ?? "Product"),
      sku: line.sku?.trim() || (product.sku ? String(product.sku) : undefined),
      quantity,
      packOf,
      unitPrice,
      totalPrice,
    });
  }

  for (const [productId, totalUnits] of demandByProduct) {
    const productSnap = await adminDb()
      .collection(`users/${opts.clientUserId}/inventory`)
      .doc(productId)
      .get();
    const available = Math.max(0, Number(productSnap.data()?.quantity) || 0);
    if (totalUnits > available) {
      const name = String(productSnap.data()?.productName ?? productId);
      throw new Error(
        `Not enough stock for ${name}. Available: ${available}, requested: ${totalUnits}.`
      );
    }
  }

  return {
    clientUserId: opts.clientUserId,
    clientUserName: opts.clientUserName,
    service,
    shipmentPreference,
    productType,
    shipTo: opts.shipTo?.trim() || undefined,
    remarks: opts.remarks?.trim() || undefined,
    lines: preparedLines,
    fbaLabelWorkflow: service === "FBA/WFS/TFS",
  };
}
