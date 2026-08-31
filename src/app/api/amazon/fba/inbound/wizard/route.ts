import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import {
  parseDeliveryWindowSelections,
  parseInboundBoxes,
  parseInboundItems,
  parseInboundShipping,
  parseTransportationSelections,
} from "@/lib/amazon-fba-inbound-request-parse";
import {
  getAmazonConnectionTokensOrThrow,
  resolveAmazonMarketplaceIds,
} from "@/lib/amazon-sp-api-orders";
import {
  confirmInboundPackingOption,
  createAmazonFbaInboundPlan,
  finalizeInboundWizardShipment,
  generateInboundDeliveryWindowOptionsUi,
  generateInboundPackingOptionsUi,
  generateInboundPlacementOptionsUi,
  generateInboundTransportationOptionsUi,
  setAmazonFbaPackingInformation,
  validateInboundBoxesAgainstPlanItems,
  warehouseToAmazonSourceAddress,
  type InboundTransportationOptionUi,
} from "@/lib/amazon-sp-api-inbound-create";
import { requireAdminAmazonRoute } from "@/lib/amazon-route-auth";
import type { WarehouseDoc } from "@/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

/** POST /api/amazon/fba/inbound/wizard — admin-only step-by-step inbound wizard. */
export async function POST(request: NextRequest) {
  const denied = await requireAdminAmazonRoute(request);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "").trim();
  const userId = String(body.userId || "").trim();
  const connectionId = String(body.connectionId || "").trim() || undefined;

  if (!userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }
  if (!action) {
    return NextResponse.json({ error: "Missing action" }, { status: 400 });
  }

  try {
    const tokens = await getAmazonConnectionTokensOrThrow(userId, connectionId);

    if (action === "create_plan") {
      const warehouseId = String(body.warehouseId || "").trim();
      const planName = String(body.planName || "").trim();
      const items = parseInboundItems(body.items);
      if (!warehouseId) {
        return NextResponse.json({ error: "Select a warehouse" }, { status: 400 });
      }
      if (!items.length) {
        return NextResponse.json({ error: "Add at least one SKU" }, { status: 400 });
      }

      const [warehouse, userSnap] = await Promise.all([
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

      const { inboundPlanId } = await createAmazonFbaInboundPlan({
        accessToken: tokens.accessToken,
        planName: planName || `PrepCorex FBA inbound ${new Date().toISOString().slice(0, 10)}`,
        marketplaceId,
        sourceAddress,
        items,
      });

      const packingOptions = await generateInboundPackingOptionsUi({
        accessToken: tokens.accessToken,
        inboundPlanId,
      });

      return NextResponse.json({
        ok: true,
        inboundPlanId,
        marketplaceId,
        packingOptions,
      });
    }

    if (action === "apply_packing") {
      const inboundPlanId = String(body.inboundPlanId || "").trim();
      const packingOptionId = String(body.packingOptionId || "").trim();
      const items = parseInboundItems(body.items);
      const boxes = parseInboundBoxes(body.boxes, body.box, items);

      if (!inboundPlanId || !packingOptionId) {
        return NextResponse.json({ error: "Missing inboundPlanId or packingOptionId" }, { status: 400 });
      }
      validateInboundBoxesAgainstPlanItems(items, boxes);

      const { packingGroupIds } = await confirmInboundPackingOption({
        accessToken: tokens.accessToken,
        inboundPlanId,
        packingOptionId,
      });

      await setAmazonFbaPackingInformation({
        accessToken: tokens.accessToken,
        inboundPlanId,
        packingGroupId: packingGroupIds[0],
        boxes,
      });

      const placementOptions = await generateInboundPlacementOptionsUi({
        accessToken: tokens.accessToken,
        inboundPlanId,
      });

      return NextResponse.json({
        ok: true,
        packingGroupId: packingGroupIds[0],
        packingGroupIds,
        placementOptions,
      });
    }

    if (action === "load_transportation") {
      const inboundPlanId = String(body.inboundPlanId || "").trim();
      const placementOptionId = String(body.placementOptionId || "").trim();
      const shipmentIds = Array.isArray(body.shipmentIds)
        ? body.shipmentIds.map(String).filter(Boolean)
        : [];

      const userSnap = await adminDb().collection("users").doc(userId).get();
      const userData = userSnap.data() || {};
      const shipping = parseInboundShipping(body.shipping, {
        name: String(userData.displayName || userData.name || ""),
        email: String(userData.email || ""),
        phone: String(userData.phone || userData.phoneNumber || ""),
      });

      if (!inboundPlanId || !placementOptionId || !shipmentIds.length) {
        return NextResponse.json(
          { error: "Missing inboundPlanId, placementOptionId, or shipmentIds" },
          { status: 400 }
        );
      }

      const transportationOptions = await generateInboundTransportationOptionsUi({
        accessToken: tokens.accessToken,
        inboundPlanId,
        placementOptionId,
        shipmentIds,
        shipping,
      });

      const deliveryWindowOptions: Awaited<ReturnType<typeof generateInboundDeliveryWindowOptionsUi>>[] = [];
      const needsWindowShipments = new Set<string>();
      for (const opt of transportationOptions) {
        if (opt.needsDeliveryWindow) needsWindowShipments.add(opt.shipmentId);
      }
      if (shipping.solution === "USE_YOUR_OWN") {
        for (const sid of shipmentIds) needsWindowShipments.add(sid);
      }

      for (const shipmentId of needsWindowShipments) {
        try {
          const windows = await generateInboundDeliveryWindowOptionsUi({
            accessToken: tokens.accessToken,
            inboundPlanId,
            shipmentId,
          });
          if (windows.length) deliveryWindowOptions.push(...windows);
        } catch {
          // Some shipments may not require windows until transport is selected
        }
      }

      return NextResponse.json({
        ok: true,
        transportationOptions,
        deliveryWindowOptions,
      });
    }

    if (action === "load_delivery_windows") {
      const inboundPlanId = String(body.inboundPlanId || "").trim();
      const shipmentIds = Array.isArray(body.shipmentIds)
        ? body.shipmentIds.map(String).filter(Boolean)
        : [];
      if (!inboundPlanId || !shipmentIds.length) {
        return NextResponse.json({ error: "Missing inboundPlanId or shipmentIds" }, { status: 400 });
      }
      const deliveryWindowOptions: Awaited<ReturnType<typeof generateInboundDeliveryWindowOptionsUi>>[] = [];
      for (const shipmentId of shipmentIds) {
        const windows = await generateInboundDeliveryWindowOptionsUi({
          accessToken: tokens.accessToken,
          inboundPlanId,
          shipmentId,
        });
        deliveryWindowOptions.push(...windows);
      }
      return NextResponse.json({ ok: true, deliveryWindowOptions });
    }

    if (action === "confirm_ship") {
      const inboundPlanId = String(body.inboundPlanId || "").trim();
      const placementOptionId = String(body.placementOptionId || "").trim();
      const shipmentIds = Array.isArray(body.shipmentIds)
        ? body.shipmentIds.map(String).filter(Boolean)
        : [];
      const transportationSelections = parseTransportationSelections(body.transportationSelections);
      const deliveryWindowSelections = parseDeliveryWindowSelections(body.deliveryWindowSelections);
      const transportationOptions = Array.isArray(body.transportationOptions)
        ? (body.transportationOptions as InboundTransportationOptionUi[])
        : [];

      const userSnap = await adminDb().collection("users").doc(userId).get();
      const userData = userSnap.data() || {};
      const shipping = parseInboundShipping(body.shipping, {
        name: String(userData.displayName || userData.name || ""),
        email: String(userData.email || ""),
        phone: String(userData.phone || userData.phoneNumber || ""),
      });

      if (!inboundPlanId || !placementOptionId || !shipmentIds.length) {
        return NextResponse.json({ error: "Missing plan context" }, { status: 400 });
      }
      if (!transportationSelections.length) {
        return NextResponse.json({ error: "Select transportation for each shipment" }, { status: 400 });
      }
      for (const sid of shipmentIds) {
        if (!transportationSelections.some((t) => t.shipmentId === sid)) {
          return NextResponse.json(
            { error: `Select transportation for shipment ${sid}` },
            { status: 400 }
          );
        }
      }

      const result = await finalizeInboundWizardShipment({
        accessToken: tokens.accessToken,
        inboundPlanId,
        placementOptionId,
        shipmentIds,
        shipping,
        transportationSelections,
        deliveryWindowSelections,
        transportationOptions,
      });

      return NextResponse.json({
        ok: true,
        inboundPlanId,
        placementOptionId,
        shipmentIds,
        shippingMode: shipping.mode,
        shippingSolution: shipping.solution,
        ...result,
      });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: unknown) {
    console.error("[amazon/fba/inbound/wizard POST]", action, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Wizard step failed" },
      { status: 500 }
    );
  }
}
