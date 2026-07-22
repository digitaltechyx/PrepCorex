/** Normalize TikTok product image fields (search / get product detail). */

type TikTokImageLike = {
  url?: string;
  urls?: string[];
  url_list?: string[];
  thumb_urls?: string[];
  thumb_url_list?: string[];
};

type TikTokProductImageSource = {
  main_images?: TikTokImageLike[];
  images?: TikTokImageLike[];
  product_images?: TikTokImageLike[];
  image?: TikTokImageLike | string;
};

function urlsFromImage(img: TikTokImageLike | string | undefined | null): string[] {
  if (!img) return [];
  if (typeof img === "string") {
    const u = img.trim();
    return u.startsWith("http") ? [u] : [];
  }
  const lists = [img.urls, img.url_list, img.thumb_urls, img.thumb_url_list];
  const out: string[] = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const u of list) {
      if (typeof u === "string" && u.trim().startsWith("http")) out.push(u.trim());
    }
  }
  if (typeof img.url === "string" && img.url.trim().startsWith("http")) {
    out.push(img.url.trim());
  }
  return out;
}

/** First usable product image URL from a TikTok product payload. */
export function firstTikTokProductImageUrl(product: TikTokProductImageSource | null | undefined): string | undefined {
  return collectTikTokProductImageUrls(product)[0];
}

/** All unique http(s) image URLs from a TikTok product payload. */
export function collectTikTokProductImageUrls(
  product: TikTokProductImageSource | null | undefined
): string[] {
  if (!product) return [];
  const buckets = [product.main_images, product.images, product.product_images];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of buckets) {
    if (!Array.isArray(list)) continue;
    for (const img of list) {
      for (const u of urlsFromImage(img)) {
        if (seen.has(u)) continue;
        seen.add(u);
        out.push(u);
      }
    }
  }
  for (const u of urlsFromImage(product.image)) {
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}
