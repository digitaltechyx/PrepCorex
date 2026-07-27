import { shopifyAdminRestUrl } from "@/lib/shopify-api";
import { shopifyAdminGraphql } from "@/lib/shopify-graphql";

export type ShopifyLabelPackageInput = {
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  /** Total shipment weight in pounds (package + contents). */
  totalWeightLb: number;
  /** Empty package weight in pounds. Defaults to 0.1 lb. */
  packageWeightLb?: number;
};

export type ShopifyPurchasedLabel = {
  labelId: string;
  trackingNumber?: string;
  trackingCompany?: string;
  documentUrl?: string;
  documentFormat?: string;
};

export type ShopifyLabelPurchaseResult = {
  purchaseResultId: string;
  status: "PENDING_PURCHASE" | "PURCHASED" | "PURCHASE_FAILED";
  labels: ShopifyPurchasedLabel[];
  errors: string[];
};

type RestFulfillmentOrder = {
  id: number;
  status: string;
  supported_actions?: string[];
  requires_shipping?: boolean;
};

const PURCHASE_MUTATION = `
  mutation ShopifyShippingLabelPurchase($input: ShippingLabelPurchaseInput!) {
    shippingLabelPurchase(shippingLabelPurchase: $input) {
      shippingLabelPurchaseResult {
        id
        done
        status
        errors {
          message
        }
        shippingLabels {
          id
          trackingInfo {
            number
            company
          }
          shippingDocuments {
            documentType
            format
            url
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const PURCHASE_STATUS_QUERY = `
  query ShopifyShippingLabelPurchaseStatus($id: ID!) {
    node(id: $id) {
      ... on ShippingLabelPurchaseResult {
        id
        done
        status
        errors {
          message
        }
        shippingLabels {
          id
          trackingInfo {
            number
            company
          }
          shippingDocuments {
            documentType
            format
            url
          }
        }
      }
    }
  }
`;

function fulfillmentOrderGid(id: number | string): string {
  return `gid://shopify/FulfillmentOrder/${id}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shippingDatetimeIso(): string {
  return new Date().toISOString();
}

function mapPurchaseNode(node: {
  id?: string;
  status?: string;
  errors?: Array<{ message?: string }>;
  shippingLabels?: Array<{
    id: string;
    trackingInfo?: { number?: string; company?: string } | null;
    shippingDocuments?: Array<{
      documentType?: string;
      format?: string;
      url?: string;
    }>;
  }>;
} | null): ShopifyLabelPurchaseResult {
  const errors = (node?.errors ?? [])
    .map((e) => e.message?.trim())
    .filter((m): m is string => Boolean(m));
  const labels: ShopifyPurchasedLabel[] = (node?.shippingLabels ?? []).map((label) => {
    const doc =
      label.shippingDocuments?.find((d) => d.url) ??
      label.shippingDocuments?.[0];
    return {
      labelId: label.id,
      trackingNumber: label.trackingInfo?.number ?? undefined,
      trackingCompany: label.trackingInfo?.company ?? undefined,
      documentUrl: doc?.url ?? undefined,
      documentFormat: doc?.format ?? undefined,
    };
  });
  const status =
    node?.status === "PURCHASED" || node?.status === "PURCHASE_FAILED" || node?.status === "PENDING_PURCHASE"
      ? node.status
      : "PENDING_PURCHASE";
  return {
    purchaseResultId: node?.id ?? "",
    status,
    labels,
    errors,
  };
}

export async function getOpenFulfillmentOrderIdForLabel(
  shop: string,
  accessToken: string,
  orderId: string
): Promise<number> {
  const foRes = await fetch(shopifyAdminRestUrl(shop, `/orders/${orderId}/fulfillment_orders.json`), {
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
  });
  if (!foRes.ok) {
    const errText = await foRes.text();
    throw new Error(`Failed to load fulfillment orders (${foRes.status}): ${errText.slice(0, 200)}`);
  }
  const foData = (await foRes.json()) as { fulfillment_orders?: RestFulfillmentOrder[] };
  const fulfillmentOrders = foData.fulfillment_orders ?? [];
  const open = fulfillmentOrders.find(
    (fo) =>
      (fo.status === "open" || fo.status === "scheduled") &&
      fo.requires_shipping !== false &&
      (fo.supported_actions?.includes("create_fulfillment") ?? true)
  );
  if (!open) {
    throw new Error("No open shippable fulfillment order found for this order.");
  }
  return open.id;
}

export async function purchaseShopifyShippingLabel(params: {
  shop: string;
  accessToken: string;
  fulfillmentOrderId: number;
  notifyCustomer: boolean;
  pkg: ShopifyLabelPackageInput;
}): Promise<ShopifyLabelPurchaseResult> {
  const packageWeightLb = params.pkg.packageWeightLb ?? 0.1;
  const input = {
    fulfillmentOrderId: fulfillmentOrderGid(params.fulfillmentOrderId),
    notifyCustomer: params.notifyCustomer,
    shippingDatetime: shippingDatetimeIso(),
    packageInfo: {
      customPackage: {
        type: "BOX",
        dimensions: {
          length: params.pkg.lengthIn,
          width: params.pkg.widthIn,
          height: params.pkg.heightIn,
          unit: "INCHES",
        },
        weight: {
          value: packageWeightLb,
          unit: "POUNDS",
        },
      },
    },
    totalWeight: {
      value: params.pkg.totalWeightLb,
      unit: "POUNDS",
    },
  };

  const data = await shopifyAdminGraphql<{
    shippingLabelPurchase: {
      shippingLabelPurchaseResult: {
        id: string;
        done: boolean;
        status: string;
        errors?: Array<{ message?: string }>;
        shippingLabels?: Array<{
          id: string;
          trackingInfo?: { number?: string; company?: string } | null;
          shippingDocuments?: Array<{ documentType?: string; format?: string; url?: string }>;
        }>;
      } | null;
      userErrors: Array<{ field?: string[]; message: string }>;
    };
  }>(params.shop, params.accessToken, PURCHASE_MUTATION, { input });

  const payload = data.shippingLabelPurchase;
  const userErrors = payload.userErrors ?? [];
  if (userErrors.length) {
    throw new Error(userErrors.map((e) => e.message).join("; "));
  }
  const result = payload.shippingLabelPurchaseResult;
  if (!result?.id) {
    throw new Error("Shopify did not return a label purchase result.");
  }

  return pollShopifyShippingLabelPurchase({
    shop: params.shop,
    accessToken: params.accessToken,
    purchaseResultId: result.id,
    initial: result,
  });
}

async function pollShopifyShippingLabelPurchase(params: {
  shop: string;
  accessToken: string;
  purchaseResultId: string;
  initial?: {
    id: string;
    done?: boolean;
    status?: string;
    errors?: Array<{ message?: string }>;
    shippingLabels?: Array<{
      id: string;
      trackingInfo?: { number?: string; company?: string } | null;
      shippingDocuments?: Array<{ documentType?: string; format?: string; url?: string }>;
    }>;
  };
}): Promise<ShopifyLabelPurchaseResult> {
  let latest = mapPurchaseNode(params.initial ?? null);
  if (latest.status === "PURCHASED" || latest.status === "PURCHASE_FAILED") {
    return latest;
  }

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(1000);
    const data = await shopifyAdminGraphql<{
      node: {
        id: string;
        done?: boolean;
        status?: string;
        errors?: Array<{ message?: string }>;
        shippingLabels?: Array<{
          id: string;
          trackingInfo?: { number?: string; company?: string } | null;
          shippingDocuments?: Array<{ documentType?: string; format?: string; url?: string }>;
        }>;
      } | null;
    }>(params.shop, params.accessToken, PURCHASE_STATUS_QUERY, {
      id: params.purchaseResultId,
    });
    latest = mapPurchaseNode(data.node);
    if (latest.status === "PURCHASED" || latest.status === "PURCHASE_FAILED") {
      return latest;
    }
  }

  throw new Error("Label purchase is still processing. Try again in a moment.");
}
