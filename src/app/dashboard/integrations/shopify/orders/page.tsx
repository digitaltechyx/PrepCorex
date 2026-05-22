import { redirect } from "next/navigation";

/** Legacy URL — Shopify orders live on the client sidebar at /dashboard/shopify-orders */
export default async function LegacyShopifyOrdersRedirect({
  searchParams,
}: {
  searchParams: Promise<{ shop?: string }>;
}) {
  const { shop: shopRaw } = await searchParams;
  const shop = shopRaw?.trim();
  const qs = shop ? `?shop=${encodeURIComponent(shop)}` : "";
  redirect(`/dashboard/shopify-orders${qs}`);
}
