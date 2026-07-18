import { NextRequest, NextResponse } from 'next/server';
import { applyBuyLabelsMarkup } from '@/lib/buy-labels-markup';

const SHIPPO_API_BASE = 'https://api.goshippo.com';

const allowedOrigins = [
  "https://prepservicesfba.com",
  "https://www.prepservicesfba.com",
  "http://localhost:3000", // For local testing
];

function buildCorsHeaders(request: NextRequest) {
  const origin = request.headers.get("origin");
  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "false",
  };

  // Allow requests from allowed origins or if origin matches prepservicesfba.com domain
  if (origin) {
    if (allowedOrigins.includes(origin) || origin.includes('prepservicesfba.com')) {
      corsHeaders["Access-Control-Allow-Origin"] = origin;
    }
  } else {
    // If no origin header (e.g., same-origin request), allow it
    corsHeaders["Access-Control-Allow-Origin"] = "*";
  }

  return corsHeaders;
}

export async function OPTIONS(request: NextRequest) {
  const corsHeaders = buildCorsHeaders(request);
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  const corsHeaders = buildCorsHeaders(request);
  try {
    const body = await request.json();
    const { fromAddress, toAddress, parcel } = body;

    // Validate required fields
    if (!fromAddress || !toAddress || !parcel) {
      return NextResponse.json(
        { error: 'Missing required fields: fromAddress, toAddress, parcel' },
        { status: 400, headers: corsHeaders }
      );
    }

    if (!process.env.SHIPPO_API_KEY) {
      return NextResponse.json(
        { 
          error: 'Shippo API key not configured',
          hint: 'Please add SHIPPO_API_KEY to your environment variables'
        },
        { status: 500, headers: corsHeaders }
      );
    }

    // Prepare Shippo address format
    const shippoFromAddress = {
      name: fromAddress.name,
      street1: fromAddress.street1,
      street2: fromAddress.street2 || '',
      city: fromAddress.city,
      state: fromAddress.state,
      zip: fromAddress.zip,
      country: fromAddress.country,
      phone: fromAddress.phone || '',
      email: fromAddress.email || '',
    };

    const shippoToAddress = {
      name: toAddress.name,
      street1: toAddress.street1,
      street2: toAddress.street2 || '',
      city: toAddress.city,
      state: toAddress.state,
      zip: toAddress.zip,
      country: toAddress.country,
      phone: toAddress.phone || '',
      email: toAddress.email || '',
    };

    // Prepare parcel dimensions
    const shippoParcel = {
      length: parcel.length.toString(),
      width: parcel.width.toString(),
      height: parcel.height.toString(),
      distance_unit: parcel.distanceUnit,
      weight: parcel.weight.toString(),
      mass_unit: parcel.weightUnit,
    };

    // Create shipment in Shippo
    const shipmentResponse = await fetch(`${SHIPPO_API_BASE}/shipments/`, {
      method: 'POST',
      headers: {
        'Authorization': `ShippoToken ${process.env.SHIPPO_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        address_from: shippoFromAddress,
        address_to: shippoToAddress,
        parcels: [shippoParcel],
        async: false,
      }),
    });

    if (!shipmentResponse.ok) {
      const errorData = await shipmentResponse.json();
      console.error('Shippo shipment creation error:', errorData);
      return NextResponse.json(
        { 
          error: 'Failed to create shipment',
          details: errorData.detail || errorData.message || 'Unknown error'
        },
        { status: shipmentResponse.status, headers: corsHeaders }
      );
    }

    const shipment = await shipmentResponse.json();

    // Get rates for the shipment
    const ratesResponse = await fetch(`${SHIPPO_API_BASE}/shipments/${shipment.object_id}/rates/`, {
      method: 'GET',
      headers: {
        'Authorization': `ShippoToken ${process.env.SHIPPO_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!ratesResponse.ok) {
      const errorData = await ratesResponse.json();
      console.error('Shippo rates error:', errorData);
      return NextResponse.json(
        { 
          error: 'Failed to get rates',
          details: errorData.detail || errorData.message || 'Unknown error'
        },
        { status: ratesResponse.status, headers: corsHeaders }
      );
    }

    const ratesData = await ratesResponse.json();
    const rates = Array.isArray(ratesData.results) ? ratesData.results : ratesData;

    // Format rates for frontend and add admin markup (same as ShipBest)
    const formattedRates = rates.map((rate: any) => {
      const baseAmount = parseFloat(rate.amount) || 0;
      const markedUpAmount = applyBuyLabelsMarkup(baseAmount);
      
      return {
        object_id: rate.object_id,
        amount: markedUpAmount,
        originalAmount: rate.amount,
        currency: rate.currency,
        provider: rate.provider,
        servicelevel: {
          name: rate.servicelevel?.name || rate.servicelevel_name || 'Standard',
          token: rate.servicelevel?.token || rate.servicelevel_token || '',
        },
        estimated_days: rate.estimated_days,
        shipment: shipment.object_id,
        labelProvider: 'shippo' as const,
      };
    });

    return NextResponse.json({
      rates: formattedRates,
      shipment_id: shipment.object_id,
    }, { headers: corsHeaders });

  } catch (error: any) {
    console.error('Error getting shipping rates:', error);
    return NextResponse.json(
      { 
        error: 'Failed to get shipping rates',
        details: error.message 
      },
      { status: 500, headers: corsHeaders }
    );
  }
}


