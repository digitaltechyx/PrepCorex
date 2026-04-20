export type AdditionalServiceCatalogItem = {
  key: string;
  name: string;
  price: number;
  description?: string;
  isDefault?: boolean;
};

export const LEGACY_ADDITIONAL_SERVICE_KEYS = ["bubbleWrap", "stickerRemoval", "warningLabels"] as const;
export type LegacyAdditionalServiceKey = (typeof LEGACY_ADDITIONAL_SERVICE_KEYS)[number];

export const DEFAULT_ADDITIONAL_SERVICES: AdditionalServiceCatalogItem[] = [
  { key: "bubbleWrap", name: "Bubble Wrap", price: 0.35, description: "Per foot", isDefault: true },
  { key: "stickerRemoval", name: "Sticker Removal", price: 0.15, description: "Per item", isDefault: true },
  { key: "warningLabels", name: "Warning Labels", price: 0.15, description: "Per label", isDefault: true },
  { key: "polybag", name: "Polybag", price: 0, description: "Per item", isDefault: true },
  { key: "bubbleMailer", name: "Bubble Mailer", price: 0.35, description: "Per item", isDefault: true },
  { key: "boxSmall", name: "Box (Small)", price: 1, description: "Per item", isDefault: true },
  { key: "boxLarge", name: "Box (Large)", price: 3, description: "Per item", isDefault: true },
];

export type AdditionalServicesPricingLike = {
  bubbleWrapPrice?: number;
  stickerRemovalPrice?: number;
  warningLabelPrice?: number;
  extraServices?: unknown;
};

/** Merge Firestore `extraServices` onto defaults (same rules as admin pricing tab). */
export function mergeAdditionalServicesCatalog(extraRaw?: unknown): AdditionalServiceCatalogItem[] {
  const existing = Array.isArray(extraRaw)
    ? (extraRaw as Partial<AdditionalServiceCatalogItem>[])
    : [];
  const merged = DEFAULT_ADDITIONAL_SERVICES.map((d) => ({ ...d }));
  existing.forEach((svc) => {
    if (!svc || typeof svc.key !== "string" || !svc.key.trim()) return;
    const idx = merged.findIndex((m) => m.key === svc.key);
    if (idx >= 0) {
      merged[idx] = {
        ...merged[idx],
        ...svc,
        key: svc.key,
        name: typeof svc.name === "string" && svc.name.trim() ? svc.name : merged[idx].name,
        price:
          typeof svc.price === "number" && Number.isFinite(svc.price) ? svc.price : merged[idx].price,
      };
    } else {
      merged.push({
        key: svc.key,
        name: typeof svc.name === "string" && svc.name.trim() ? svc.name : svc.key,
        price: typeof svc.price === "number" && Number.isFinite(svc.price) ? svc.price : 0,
        description: typeof svc.description === "string" ? svc.description : undefined,
        isDefault: false,
      });
    }
  });
  return merged;
}

/** Full catalog for a user doc: merged extras, with legacy top-level prices applied to the three core rows. */
export function catalogFromPricingDoc(
  doc: AdditionalServicesPricingLike | null | undefined
): AdditionalServiceCatalogItem[] {
  const base = mergeAdditionalServicesCatalog(doc?.extraServices);
  if (!doc) return base;
  return base.map((row) => {
    if (row.key === "bubbleWrap" && doc.bubbleWrapPrice != null && Number.isFinite(Number(doc.bubbleWrapPrice))) {
      return { ...row, price: Number(doc.bubbleWrapPrice) };
    }
    if (row.key === "stickerRemoval" && doc.stickerRemovalPrice != null && Number.isFinite(Number(doc.stickerRemovalPrice))) {
      return { ...row, price: Number(doc.stickerRemovalPrice) };
    }
    if (row.key === "warningLabels" && doc.warningLabelPrice != null && Number.isFinite(Number(doc.warningLabelPrice))) {
      return { ...row, price: Number(doc.warningLabelPrice) };
    }
    return row;
  });
}

export function unitPriceForServiceKey(
  key: string,
  catalogRows: AdditionalServiceCatalogItem[]
): number {
  const row = catalogRows.find((r) => r.key === key);
  return row && Number.isFinite(row.price) ? row.price : 0;
}

export function isLegacyAdditionalServiceKey(key: string): key is LegacyAdditionalServiceKey {
  return (LEGACY_ADDITIONAL_SERVICE_KEYS as readonly string[]).includes(key);
}
