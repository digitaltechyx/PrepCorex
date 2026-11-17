import { NextRequest, NextResponse } from "next/server";
import { assertAllowlistedBuyLabelRate } from "@/lib/buy-label-rate-display";
import {
  buildShipBestCustomNo,
  purchaseLabelFromShipBest,
} from "@/lib/shipbest-purchase";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      labelPurchaseId,
      userId,
      logisticsProductCode,
      logisticsProductId,
      fromAddress,
      toAddress,
      parcel,
      customNo,
    } = body;

    if (
      !labelPurchaseId ||
      !userId ||
      !logisticsProductCode ||
      !fromAddress ||
      !toAddress ||
      !parcel
    ) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: labelPurchaseId, userId, logisticsProductCode, fromAddress, toAddress, parcel",
        },
        { status: 400 }
      );
    }

    try {
      assertAllowlistedBuyLabelRate({
        labelProvider: "shipbest",
        provider: "ShipBest",
        logisticsProductCode: String(logisticsProductCode),
        servicelevel: { token: String(logisticsProductCode) },
      });
    } catch (allowlistErr: unknown) {
      return NextResponse.json(
        {
          error:
            allowlistErr instanceof Error
              ? allowlistErr.message
              : "This ShipBest courier rate is not available.",
        },
        { status: 403 }
      );
    }

    if (!process.env.SHIPBEST_API_ID || !process.env.SHIPBEST_ACCESS_TOKEN) {
      return NextResponse.json(
        {
          error: "ShipBest API credentials not configured",
          hint: "Add SHIPBEST_API_ID and SHIPBEST_ACCESS_TOKEN to environment variables",
        },
        { status: 500 }
      );
    }

    const resolvedCustomNo =
      customNo || buildShipBestCustomNo(userId, labelPurchaseId);

    const result = await purchaseLabelFromShipBest({
      labelPurchaseId,
      userId,
      customNo: resolvedCustomNo,
      logisticsProductCode,
      logisticsProductId:
        logisticsProductId != null ? Number(logisticsProductId) : undefined,
      fromAddress,
      toAddress,
      parcel: {
        length: Number(parcel.length),
        width: Number(parcel.width),
        height: Number(parcel.height),
        weight: Number(parcel.weight),
      },
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("ShipBest purchase-label error:", error);
    return NextResponse.json(
      {
        error: "Failed to purchase ShipBest label",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
