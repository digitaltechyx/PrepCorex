import { NextRequest, NextResponse } from "next/server";
import { requireFullAdmin } from "@/lib/api-admin-auth";
import {
  gofoCancelOrder,
  gofoCostEstimation,
  gofoCreateOrder,
  gofoGetLabel,
  gofoOk,
  gofoTrack,
  gofoVerifyDelivery,
  getGofoConfig,
  type GofoCreateOrderPayload,
} from "@/lib/gofo-api";

export const dynamic = "force-dynamic";

type Action =
  | "status"
  | "verify"
  | "rate"
  | "create"
  | "label"
  | "track"
  | "cancel";

/**
 * Admin-only GOFO sandbox proxy. Credentials never leave the server.
 * Not exposed on client Buy Labels.
 */
export async function POST(request: NextRequest) {
  const auth = await requireFullAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: {
    action?: Action;
    orderNo?: string;
    remarks?: string;
    payload?: GofoCreateOrderPayload;
    consignee?: {
      consigneeCountry: string;
      consigneeState?: string;
      consigneeCity?: string;
      consigneeArea?: string;
      consigneeStreet?: string;
      consigneeCode: string;
    };
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const action = body.action;
  if (!action) {
    return NextResponse.json({ error: "action is required." }, { status: 400 });
  }

  try {
    if (action === "status") {
      try {
        const cfg = getGofoConfig();
        return NextResponse.json({
          configured: true,
          baseUrl: cfg.baseUrl,
          username: cfg.username,
          productCode: cfg.productCode,
          entryPort: cfg.entryPort,
          environment: cfg.baseUrl.includes("uat") || cfg.baseUrl.includes("eminxing")
            ? "sandbox"
            : "production-or-custom",
        });
      } catch (e) {
        return NextResponse.json({
          configured: false,
          error: e instanceof Error ? e.message : "GOFO env not configured",
        });
      }
    }

    // Ensure env exists for live calls
    getGofoConfig();

    if (action === "verify") {
      if (!body.consignee?.consigneeCountry || !body.consignee?.consigneeCode) {
        return NextResponse.json(
          { error: "consignee.consigneeCountry and consignee.consigneeCode are required." },
          { status: 400 }
        );
      }
      const result = await gofoVerifyDelivery(body.consignee);
      return NextResponse.json({ ok: gofoOk(result), result });
    }

    if (action === "rate" || action === "create") {
      if (!body.payload) {
        return NextResponse.json({ error: "payload is required." }, { status: 400 });
      }
      const result =
        action === "rate"
          ? await gofoCostEstimation(body.payload)
          : await gofoCreateOrder(body.payload);
      return NextResponse.json({ ok: gofoOk(result), result });
    }

    if (action === "label" || action === "track" || action === "cancel") {
      const orderNo = body.orderNo?.trim();
      if (!orderNo) {
        return NextResponse.json({ error: "orderNo is required." }, { status: 400 });
      }
      if (action === "label") {
        const result = await gofoGetLabel(orderNo);
        const b64 =
          result.data?.base64code ||
          result.data?.base64Code ||
          "";
        return NextResponse.json({
          ok: gofoOk(result),
          result: {
            ...result,
            data: b64
              ? {
                  base64Length: String(b64).length,
                  base64code: b64,
                }
              : result.data,
          },
        });
      }
      if (action === "track") {
        const result = await gofoTrack(orderNo);
        return NextResponse.json({ ok: gofoOk(result), result });
      }
      const result = await gofoCancelOrder(orderNo, body.remarks);
      return NextResponse.json({ ok: gofoOk(result), result });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e) {
    console.error("[admin/gofo/sandbox]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "GOFO request failed." },
      { status: 500 }
    );
  }
}
