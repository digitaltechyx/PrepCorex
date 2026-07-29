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

    let openQuotes: ShipBestFeeQuote[] = [];
    let productQuotes: ShipBestFeeQuote[] = [];
    let lastQuoteError: string | null = null;

    // Always load both the open quote and every enabled product. Some ShipBest
    // accounts return only one default rate from the open quote even though
    // additional products are available through getProducts.
    const [openResult, productsResult] = await Promise.allSettled([
      shipbestTrialOrderPrice({
        fromAddress,
        toAddress,
        parcel: parcelPayload,
      }),
      shipbestGetProducts(),
    ]);

    if (openResult.status === "fulfilled") {
      openQuotes = openResult.value;
    } else {
      lastQuoteError =
        openResult.reason instanceof Error
          ? openResult.reason.message
          : String(openResult.reason);
      console.warn("ShipBest open trial failed:", lastQuoteError);
    }

    if (productsResult.status === "fulfilled" && productsResult.value.length > 0) {
      const products = productsResult.value;
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
              logisticsProductName:
                row.logisticsProductName || product.name || product.code,
              serviceDescription:
                row.serviceDescription || product.description,
            }));
          } catch (error: unknown) {
            lastQuoteError = error instanceof Error ? error.message : String(error);
            return [] as ShipBestFeeQuote[];
          }
        })
      );
      productQuotes = collected.flat();
    } else if (productsResult.status === "rejected") {
      const productsError =
        productsResult.reason instanceof Error
          ? productsResult.reason.message
          : String(productsResult.reason);
      lastQuoteError ||= productsError;
      console.warn("ShipBest product list failed:", productsError);
    }

    // Product-specific quotes take precedence over duplicate open-quote rows.
    const uniqueQuotes = new Map<string, ShipBestFeeQuote>();
    for (const quote of [...openQuotes, ...productQuotes]) {
      const code = quote.logisticsProductCode?.trim();
      const key =
        code ||
        (quote.logisticsProductId > 0
          ? String(quote.logisticsProductId)
          : `${quote.logisticsProductName}:${quote.totalDiscountShippingFee || quote.totalShippingFee}`);
      uniqueQuotes.set(key, quote);
    }

    // ShipBest can expose the same service under multiple internal product
    // codes. Collapse rows that have the same displayed service and price.
    const uniqueServices = new Map<string, ShipBestFeeQuote>();
    for (const quote of uniqueQuotes.values()) {
      const baseAmount =
        quote.totalDiscountShippingFee || quote.totalShippingFee;
      const serviceName = (
        quote.logisticsProductName ||
        quote.logisticsProductCode ||
        "ShipBest"
      )
        .trim()
        .toLowerCase();
      const currency = (quote.currency || "USD").trim().toUpperCase();
      uniqueServices.set(
        `${serviceName}:${baseAmount.toFixed(4)}:${currency}`,
        quote
      );
    }

    const rates = Array.from(uniqueServices.values())
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
          estimated_days: q.estimatedDays,
          deliveryEstimate: q.deliveryEstimate,
          serviceDescription: q.serviceDescription,
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
