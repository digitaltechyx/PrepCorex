import type {
  AmazonInboundBoxInput,
  AmazonInboundFreightInput,
  AmazonInboundPalletInput,
  AmazonInboundPlanItemInput,
  AmazonInboundShippingInput,
  AmazonInboundShippingMode,
  AmazonInboundShippingSolution,
} from "@/lib/amazon-sp-api-inbound-create";

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function parseInboundItems(raw: unknown): AmazonInboundPlanItemInput[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const rec = asObj(row);
      const msku = String(rec.msku ?? rec.sellerSku ?? rec.sku ?? "").trim();
      const quantity = Math.max(1, Math.floor(Number(rec.quantity ?? 0)));
      if (!msku) return null;
      return { msku, quantity };
    })
    .filter((row): row is AmazonInboundPlanItemInput => row != null);
}

export function parseInboundBoxes(
  raw: unknown,
  legacyBox: unknown,
  planItems: AmazonInboundPlanItemInput[]
): AmazonInboundBoxInput[] {
  if (Array.isArray(raw) && raw.length) {
    return raw.map((row) => {
      const rec = asObj(row);
      const items = parseInboundItems(rec.items);
      return {
        lengthIn: Number(rec.lengthIn ?? rec.length ?? 12) || 12,
        widthIn: Number(rec.widthIn ?? rec.width ?? 10) || 10,
        heightIn: Number(rec.heightIn ?? rec.height ?? 8) || 8,
        weightLb: Number(rec.weightLb ?? rec.weight ?? 5) || 5,
        boxCount: Math.max(1, Math.floor(Number(rec.boxCount ?? 1))),
        items: items.length ? items : planItems,
      };
    });
  }
  const rec = asObj(legacyBox);
  const items = parseInboundItems(rec.items);
  return [
    {
      lengthIn: Number(rec.lengthIn ?? rec.length ?? 12) || 12,
      widthIn: Number(rec.widthIn ?? rec.width ?? 10) || 10,
      heightIn: Number(rec.heightIn ?? rec.height ?? 8) || 8,
      weightLb: Number(rec.weightLb ?? rec.weight ?? 5) || 5,
      boxCount: Math.max(1, Math.floor(Number(rec.boxCount ?? 1))),
      items: items.length ? items : planItems,
    },
  ];
}

function parseShippingMode(raw: unknown): AmazonInboundShippingMode {
  return String(raw || "SPD").trim().toUpperCase() === "LTL" ? "LTL" : "SPD";
}

function parseShippingSolution(raw: unknown): AmazonInboundShippingSolution {
  const v = String(raw || "USE_YOUR_OWN").trim().toUpperCase();
  if (v.includes("PARTNER") || v.includes("AMAZON")) return "AMAZON_PARTNERED";
  return "USE_YOUR_OWN";
}

function parsePallets(raw: unknown): AmazonInboundPalletInput[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const pallets = raw.map((row) => {
    const rec = asObj(row);
    return {
      quantity: Math.max(1, Math.floor(Number(rec.quantity ?? 1))),
      lengthIn: Number(rec.lengthIn ?? rec.length ?? 48) || 48,
      widthIn: Number(rec.widthIn ?? rec.width ?? 40) || 40,
      heightIn: Number(rec.heightIn ?? rec.height ?? 48) || 48,
      weightLb: Number(rec.weightLb ?? rec.weight ?? 500) || 500,
      stackability:
        String(rec.stackability || "STACKABLE").toUpperCase() === "NON_STACKABLE"
          ? ("NON_STACKABLE" as const)
          : ("STACKABLE" as const),
    };
  });
  return pallets.length ? pallets : undefined;
}

function parseFreight(raw: unknown): AmazonInboundFreightInput | undefined {
  const rec = asObj(raw);
  const amount = Number(rec.declaredValueAmount ?? rec.amount ?? 0);
  if (!amount) return undefined;
  return {
    declaredValueAmount: amount,
    declaredValueCurrency: String(rec.declaredValueCurrency ?? rec.currency ?? "USD").trim() || "USD",
    freightClass: String(rec.freightClass ?? "FC_50").trim() || "FC_50",
  };
}

export function parseInboundShipping(
  raw: unknown,
  contactFallback: { name: string; email: string; phone: string }
): AmazonInboundShippingInput {
  const rec = asObj(raw);
  const contactRec = asObj(rec.contact);
  const mode = parseShippingMode(rec.mode);
  const solution = parseShippingSolution(rec.solution);
  const shipping: AmazonInboundShippingInput = {
    mode,
    solution,
    contact: {
      name: String(contactRec.name || contactFallback.name).trim() || contactFallback.name,
      email: String(contactRec.email || contactFallback.email).trim() || contactFallback.email,
      phoneNumber:
        String(contactRec.phoneNumber || contactRec.phone || contactFallback.phone).trim() ||
        contactFallback.phone,
    },
    freight: parseFreight(rec.freight),
    pallets: parsePallets(rec.pallets),
  };
  if (mode === "LTL" && !shipping.pallets?.length) {
    shipping.pallets = [
      {
        quantity: 1,
        lengthIn: 48,
        widthIn: 40,
        heightIn: 48,
        weightLb: 500,
        stackability: "STACKABLE",
      },
    ];
  }
  if (mode === "LTL" && !shipping.freight) {
    shipping.freight = {
      declaredValueAmount: 500,
      declaredValueCurrency: "USD",
      freightClass: "FC_50",
    };
  }
  return shipping;
}

export function parseTransportationSelections(raw: unknown): Array<{ shipmentId: string; transportationOptionId: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const rec = asObj(row);
      const shipmentId = String(rec.shipmentId ?? "").trim();
      const transportationOptionId = String(rec.transportationOptionId ?? "").trim();
      if (!shipmentId || !transportationOptionId) return null;
      return { shipmentId, transportationOptionId };
    })
    .filter((r): r is { shipmentId: string; transportationOptionId: string } => r != null);
}

export function parseDeliveryWindowSelections(
  raw: unknown
): Array<{ shipmentId: string; deliveryWindowOptionId: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const rec = asObj(row);
      const shipmentId = String(rec.shipmentId ?? "").trim();
      const deliveryWindowOptionId = String(rec.deliveryWindowOptionId ?? "").trim();
      if (!shipmentId || !deliveryWindowOptionId) return null;
      return { shipmentId, deliveryWindowOptionId };
    })
    .filter((r): r is { shipmentId: string; deliveryWindowOptionId: string } => r != null);
}
