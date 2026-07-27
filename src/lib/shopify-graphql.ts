import { shopifyAdminGraphqlUrl } from "@/lib/shopify-api";

type GraphqlEnvelope<T> = {
  data?: T;
  errors?: { message: string }[];
};

export async function shopifyAdminGraphql<T>(
  shop: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(shopifyAdminGraphqlUrl(shop), {
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
