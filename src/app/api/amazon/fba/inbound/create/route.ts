import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import {
  getAmazonConnectionTokensOrThrow,
  resolveAmazonMarketplaceIds,
} from "@/lib/amazon-sp-api-orders";
import {
  runAmazonFbaInboundCreation,
  warehouseToAmazonSourceAddress,
  type AmazonInboundBoxInput,
  type AmazonInboundFreightInput,
  type AmazonInboundPalletInput,
  type AmazonInboundPlanItemInput,
  type AmazonInboundShippingInput,
  type AmazonInboundShippingMode,
  type AmazonInboundShippingSolution,
} from "@/lib/amazon-sp-api-inbound-create";
import { requireAdminAmazonRoute } from "@/lib/amazon-route-auth";
import type { WarehouseDoc } from "@/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function parseItems(raw: unknown): AmazonInboundPlanItemInput[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const rec = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      const msku = String(rec.msku ?? rec.sellerSku ?? rec.sku ?? "").trim();
      const quantity = Math.max(1, Math.floor(Number(rec.quantity ?? 0)));
      if (!msku) return null;
      return { msku, quantity };
    })
    .filter((row): row is AmazonInboundPlanItemInput => row != null);
}

function parseBoxItems(raw: unknown): AmazonInboundPlanItemInput[] {
  return parseItems(raw);
}

function parseBoxes(raw: unknown, legacyBox: unknown, planItems: AmazonInboundPlanItemInput[]): AmazonInboundBoxInput[] {
  if (Array.isArray(raw) && raw.length) {
    return raw.map((row) => {
      const rec = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
      const lengthIn = Number(rec.lengthIn ?? rec.length ?? 12);
      const widthIn = Number(rec.widthIn ?? rec.width ?? 10);
      const heightIn = Number(rec.heightIn ?? rec.height ?? 8);
      const weightLb = Number(rec.weightLb ?? rec.weight ?? 5);
      const boxCount = Math.max(1, Math.floor(Number(rec.boxCount ?? 1)));
      const items = parseBoxItems(rec.items);
      return {
        lengthIn: lengthIn > 0 ? lengthIn : 12,
        widthIn: widthIn > 0 ? widthIn : 10,
        heightIn: heightIn > 0 ? heightIn : 8,
        weightLb: weightLb > 0 ? weightLb : 5,
        boxCount,
        items: items.length ? items : planItems,
      };
    });
  }

  const rec = legacyBox && typeof legacyBox === "object" ? (legacyBox as Record<string, unknown>) : {};
  const lengthIn = Number(rec.lengthIn ?? rec.length ?? 12);
  const widthIn = Number(rec.widthIn ?? rec.width ?? 10);
  const heightIn = Number(rec.heightIn ?? rec.height ?? 8);
  const weightLb = Number(rec.weightLb ?? rec.weight ?? 5);
  const boxCount = Math.max(1, Math.floor(Number(rec.boxCount ?? 1)));
  const items = parseBoxItems(rec.items);
  return [
    {
      lengthIn: lengthIn > 0 ? lengthIn : 12,
      widthIn: widthIn > 0 ? widthIn : 10,
      heightIn: heightIn > 0 ? heightIn : 8,
      weightLb: weightLb > 0 ? weightLb : 5,
      boxCount,
      items: items.length ? items : planItems,
    },
  ];
}

function parseShippingMode(raw: unknown): AmazonInboundShippingMode {
  const v = String(raw || "SPD").trim().toUpperCase();
  return v === "LTL" ? "LTL" : "SPD";
}

function parseShippingSolution(raw: unknown): AmazonInboundShippingSolution {
  const v = String(raw || "USE_YOUR_OWN").trim().toUpperCase();
  if (v.includes("PARTNER") || v.includes("AMAZON")) return "AMAZON_PARTNERED";
  return "USE_YOUR_OWN";
}

function parsePallets(raw: unknown): AmazonInboundPalletInput[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const pallets = raw
    .map((row) => {
      const rec = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
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
    })
    .filter(Boolean);
  return pallets.length ? pallets : undefined;
}

function parseFreight(raw: unknown): AmazonInboundFreightInput | undefined {
  const rec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const amount = Number(rec.declaredValueAmount ?? rec.amount ?? 0);
  if (!amount) return undefined;
  return {
    declaredValueAmount: amount,
    declaredValueCurrency: String(rec.declaredValueCurrency ?? rec.currency ?? "USD").trim() || "USD",
    freightClass: String(rec.freightClass ?? "FC_50").trim() || "FC_50",
  };
}

function parseShipping(raw: unknown, contactFallback: { name: string; email: string; phone: string }): AmazonInboundShippingInput {
  const rec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const contactRec = asObj(rec.contact);
  const mode = parseShippingMode(rec.mode);
  const solution = parseShippingSolution(rec.solution);
  return {
    mode,
    solution,
    contact: {
      name: String(contactRec.name || contactFallback.name).trim() || contactFallback.name,
      email: String(contactRec.email || contactFallback.email).trim() || contactFallback.email,
      phoneNumber: String(contactRec.phoneNumber || contactRec.phone || contactFallback.phone).trim() || contactFallback.phone,
    },
    freight: parseFreight(rec.freight),
    pallets: parsePallets(rec.pallets),
  };
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

async function loadWarehouse(warehouseId: string): Promise<WarehouseDoc> {
  const snap = await adminDb().collection("warehouses").doc(warehouseId).get();
  if (!snap.exists) throw new Error("Warehouse not found");
  const data = snap.data() || {};
  return {
    id: snap.id,
    code: String(data.code || ""),
    name: String(data.name || ""),
    active: data.active !== false,
    linkedLocationId: data.linkedLocationId ?? null,
    country: data.country ? String(data.country) : undefined,
    stateOrProvince: data.stateOrProvince ? String(data.stateOrProvince) : undefined,
    street1: data.street1 ? String(data.street1) : undefined,
    street2: data.street2 ? String(data.street2) : undefined,
    city: data.city ? String(data.city) : undefined,
    zip: data.zip ? String(data.zip) : undefined,
  };
}

/** POST /api/amazon/fba/inbound/create — admin-only FBA inbound plan creation. */
export async function POST(request: NextRequest) {
  const denied = await requireAdminAmazonRoute(request);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || "").trim();
  const connectionId = String(body.connectionId || "").trim() || undefined;
  const warehouseId = String(body.warehouseId || "").trim();
  const planName = String(body.planName || "").trim();
  const items = parseItems(body.items);

  if (!userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }
  if (!warehouseId) {
    return NextResponse.json({ error: "Select a warehouse (ship-from address)" }, { status: 400 });
  }
  if (!items.length) {
    return NextResponse.json({ error: "Add at least one SKU with quantity" }, { status: 400 });
  }

  try {
    const [tokens, warehouse, userSnap] = await Promise.all([
      getAmazonConnectionTokensOrThrow(userId, connectionId),
      loadWarehouse(warehouseId),
      adminDb().collection("users").doc(userId).get(),
    ]);
    const userData = userSnap.data() || {};
    const marketplaceIds = resolveAmazonMarketplaceIds(tokens.marketplaces);
    const marketplaceId = marketplaceIds[0] || "ATVPDKIKX0DER";

    const sourceAddress = warehouseToAmazonSourceAddress(warehouse, {
      name: String(userData.displayName || userData.name || userData.companyName || ""),
      email: String(userData.email || ""),
      phone: String(userData.phone || userData.phoneNumber || ""),
    });

    const contactFallback = {
      name: sourceAddress.name,
      email: sourceAddress.email,
      phone: sourceAddress.phoneNumber,
    };
    const shipping = parseShipping(body.shipping, contactFallback);
    const boxes = parseBoxes(body.boxes, body.box, items);

    if (shipping.mode === "LTL" && !shipping.pallets?.length) {
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
    if (shipping.mode === "LTL" && !shipping.freight) {
      shipping.freight = {
        declaredValueAmount: 500,
        declaredValueCurrency: "USD",
        freightClass: "FC_50",
      };
    }

    const name =
      planName ||
      `PrepCorex FBA inbound ${new Date().toISOString().slice(0, 10)}`;

    const result = await runAmazonFbaInboundCreation({
      accessToken: tokens.accessToken,
      planName: name,
      marketplaceId,
      sourceAddress,
      items,
      boxes,
      shipping,
    });

    return NextResponse.json({
      ok: true,
      connectionId: tokens.connectionId,
      storeName:
        tokens.marketplaces.map((m) => m.storeName || m.name).find(Boolean) || "Amazon",
      marketplaceId,
      warehouse: { id: warehouse.id, name: warehouse.name, code: warehouse.code },
      ...result,
    });
  } catch (err: unknown) {
    console.error("[amazon/fba/inbound/create POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create FBA inbound plan" },
      { status: 500 }
    );
  }
}
