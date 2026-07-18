import { NextRequest, NextResponse } from "next/server";
import { applyBuyLabelsMarkup } from "@/lib/buy-labels-markup";
import {
  shipbestGetProducts,
  shipbestTrialOrderPrice,
  type ShipBestFeeQuote,
} from "@/lib/shipbest-api";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { fromAddress, toAddress, parcel } = body;

    if (!fromAddress || !toAddress || !parcel) {
      return NextResponse.json(
        { error: "Missing required fields: fromAddress, toAddress, parcel" },
        { status: 400 }
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

    const parcelPayload = {
      length: Number(parcel.length),
      width: Number(parcel.width),
      height: Number(parcel.height),
      weight: Number(parcel.weight),
    };

    let quotes: ShipBestFeeQuote[] = [];
    let lastQuoteError: string | null = null;

    // Open trial (no product code) — some accounts return all products; others reject.
    try {
      quotes = await shipbestTrialOrderPrice({
        fromAddress,
        toAddress,
        parcel: parcelPayload,
      });
    } catch (error: unknown) {
      lastQuoteError = error instanceof Error ? error.message : String(error);
      console.warn("ShipBest open trial failed, falling back to product list:", lastQuoteError);
    }

    // Quote each logistics product configured on the ShipBest account.
    if (quotes.length === 0) {
      const products = await shipbestGetProducts();
      if (products.length === 0) {
        return NextResponse.json(
          {
            error: "No ShipBest logistics products available",
            details:
              "This ShipBest account has no logistics products enabled. Ask GOFO/ShipBest to enable shipping products on the OMS account, then try again.",
          },
          { status: 400 }
        );
      }

      const collected = await Promise.all(
        products.slice(0, 40).map(async (product) => {
          try {
            const rows = await shipbestTrialOrderPrice({
              fromAddress,
              toAddress,
              parcel: parcelPayload,
              logisticsProductCode: product.code,
            });
            return rows.map((row) => ({
              ...row,
              logisticsProductCode: row.logisticsProductCode || product.code,
              logisticsProductName: row.logisticsProductName || product.name,
            }));
          } catch (error: unknown) {
            lastQuoteError = error instanceof Error ? error.message : String(error);
            return [] as ShipBestFeeQuote[];
          }
        })
      );
      quotes = collected.flat();
    }

    const rates = quotes
      .filter((q) => (q.totalDiscountShippingFee || q.totalShippingFee) > 0)
      .map((q) => {
        const baseAmount = q.totalDiscountShippingFee || q.totalShippingFee;
        const code = q.logisticsProductCode || String(q.logisticsProductId || "unknown");
        return {
          object_id: `shipbest:${q.logisticsProductId || 0}:${code}`,
          amount: applyBuyLabelsMarkup(baseAmount),
          originalAmount: baseAmount.toFixed(2),
          currency: (q.currency || "USD").toLowerCase() === "usd" ? "USD" : q.currency || "USD",
          provider: "ShipBest",
          servicelevel: {
            name: q.logisticsProductName || code,
            token: code,
          },
          shipment: "shipbest",
          labelProvider: "shipbest" as const,
          logisticsProductId: q.logisticsProductId || undefined,
          logisticsProductCode: code,
        };
      });

    if (rates.length === 0) {
      return NextResponse.json(
        {
          error: "No ShipBest rates for this shipment",
          details:
            lastQuoteError ||
            "ShipBest returned no priced logistics products for this address/parcel. Check product coverage for this lane or try different dimensions/weight.",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      rates,
      shipment_id: "shipbest",
      provider: "shipbest",
    });
  } catch (error: unknown) {
    console.error("ShipBest rates error:", error);
    return NextResponse.json(
      {
        error: "Failed to get ShipBest shipping rates",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
