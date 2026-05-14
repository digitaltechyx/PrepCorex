/**
 * Shopify App Store: billing must use Managed Pricing (Partner Dashboard) or the Billing API.
 * This module creates a $0 recurring app subscription via GraphQL so installs use Shopify billing correctly.
 * @see https://shopify.dev/docs/apps/launch/billing
 */

const SHOPIFY_API_VERSION = "2025-04";

const CURRENT_SUBS_QUERY = `
  query ShopifyBillingCurrentSubs {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
      }
    }
  }
`;

const CREATE_SUB_MUTATION = `
  mutation ShopifyBillingCreateSubscription(
    $name: String!
    $returnUrl: URL!
    $lineItems: [AppSubscriptionLineItemInput!]!
    $test: Boolean
  ) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      lineItems: $lineItems
      test: $test
    ) {
      confirmationUrl
      userErrors {
        field
        message
      }
      appSubscription {
        id
        name
        status
      }
    }
  }
`;

type GraphqlEnvelope<T> = {
  data?: T;
  errors?: { message: string }[];
};

async function adminGraphql<T>(
  shop: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as GraphqlEnvelope<T>;
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  if (!res.ok) {
    throw new Error(`Shopify GraphQL HTTP ${res.status}`);
  }
  if (!json.data) {
    throw new Error("Shopify GraphQL returned no data");
  }
  return json.data;
}

export type ShopifyBillingAfterConnectResult =
  | { kind: "confirmation"; confirmationUrl: string }
  | { kind: "skipped"; reason: "disabled" | "no_public_base_url" | "already_subscribed" }
  | { kind: "error"; message: string };

/**
 * After OAuth, ensure the shop has an active app subscription via Shopify Billing API.
 * Uses a $0 / 30-day recurring line item (App Store–friendly free tier).
 * Merchant may be sent to `confirmationUrl` to approve (even for $0 on some stores).
 */
export async function ensureShopifyAppSubscriptionAfterConnect(params: {
  shop: string;
  accessToken: string;
  /** HTTPS app origin, no trailing slash (e.g. https://dev.prepservicesfba.com) */
  appBaseUrl: string;
}): Promise<ShopifyBillingAfterConnectResult> {
  if (process.env.SHOPIFY_BILLING_API === "false") {
    return { kind: "skipped", reason: "disabled" };
  }

  const base = params.appBaseUrl.replace(/\/$/, "");
  if (!base.startsWith("https://") || base.includes("localhost")) {
    return { kind: "skipped", reason: "no_public_base_url" };
  }

  type SubsData = {
    currentAppInstallation: { activeSubscriptions: { id: string }[] } | null;
  };

  const subs = await adminGraphql<SubsData>(params.shop, params.accessToken, CURRENT_SUBS_QUERY);
  const active = subs.currentAppInstallation?.activeSubscriptions ?? [];
  if (active.length > 0) {
    return { kind: "skipped", reason: "already_subscribed" };
  }

  const planName =
    process.env.SHOPIFY_BILLING_PLAN_NAME?.trim() || "PSF Engine — App subscription (free)";
  const returnUrl = `${base}/dashboard/integrations/shopify/billing-complete?shop=${encodeURIComponent(params.shop)}`;
  const testBilling = process.env.SHOPIFY_BILLING_TEST === "true";

  type MutData = {
    appSubscriptionCreate: {
      confirmationUrl: string | null;
      userErrors: { field: string[] | null; message: string }[];
      appSubscription: { id: string } | null;
    } | null;
  };

  const variables = {
    name: planName,
    returnUrl,
    test: testBilling,
    lineItems: [
      {
        plan: {
          appRecurringPricingDetails: {
            price: { amount: 0, currencyCode: "USD" },
            interval: "EVERY_30_DAYS",
          },
        },
      },
    ],
  };

  const created = await adminGraphql<MutData>(
    params.shop,
    params.accessToken,
    CREATE_SUB_MUTATION,
    variables
  );

  const payload = created.appSubscriptionCreate;
  if (!payload) {
    return { kind: "error", message: "appSubscriptionCreate returned null" };
  }
  if (payload.userErrors?.length) {
    const msg = payload.userErrors.map((e) => e.message).join("; ");
    return { kind: "error", message: msg };
  }
  if (!payload.confirmationUrl) {
    return { kind: "error", message: "No confirmationUrl from Shopify (subscription may already be pending)" };
  }

  return { kind: "confirmation", confirmationUrl: payload.confirmationUrl };
}
