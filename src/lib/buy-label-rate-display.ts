/** Customer-facing carrier labels for Buy Labels / purchased labels. */

export type RateDisplayInput = {
  provider?: string | null;
  servicelevel?: { name?: string | null; token?: string | null } | null;
  serviceLevel?: string | null;
  labelProvider?: string | null;
  object_id?: string | null;
  objectId?: string | null;
  logisticsProductCode?: string | null;
  serviceDescription?: string | null;
};

function rateIdentityBlob(rate: RateDisplayInput): string {
  const provider = String(rate.provider ?? "").trim();
  const serviceName = String(
    rate.servicelevel?.name ?? rate.serviceLevel ?? ""
  ).trim();
  const code = String(
    rate.logisticsProductCode ?? rate.servicelevel?.token ?? ""
  ).trim();
  const desc = String(rate.serviceDescription ?? "").trim();
  return `${provider} ${serviceName} ${code} ${desc}`;
}

export function isShipBestRate(rate: RateDisplayInput): boolean {
  return (
    rate.labelProvider === "shipbest" ||
    String(rate.object_id || rate.objectId || "").startsWith("shipbest:") ||
    /shipbest/i.test(String(rate.provider ?? ""))
  );
}

/** PrepCorex GOFO products from ShipBest (shown to clients). */
export function isPrepCorexGofoRate(rate: RateDisplayInput): boolean {
  if (!isShipBestRate(rate)) return false;
  return /gofo/i.test(rateIdentityBlob(rate));
}

/** ShipBest USPS / other non-GOFO courier rows — hidden from Buy Labels. */
export function isHiddenShipBestCourierRate(rate: RateDisplayInput): boolean {
  return isShipBestRate(rate) && !isPrepCorexGofoRate(rate);
}

export function filterVisibleBuyLabelRates<T extends RateDisplayInput>(rates: T[]): T[] {
  return rates.filter((rate) => !isHiddenShipBestCourierRate(rate));
}

export function assertAllowlistedBuyLabelRate(rate: RateDisplayInput): void {
  if (isHiddenShipBestCourierRate(rate)) {
    throw new Error(
      "This ShipBest courier rate is not available. Choose PrepCorex GOFO or a Shippo rate."
    );
  }
}

export function getBuyLabelRateDisplay(rate: RateDisplayInput): {
  provider: string;
  service: string;
} {
  const provider = String(rate.provider ?? "").trim() || "Unknown";
  const serviceName = String(
    rate.servicelevel?.name ?? rate.serviceLevel ?? ""
  ).trim();
  const blob = rateIdentityBlob(rate);
  const isShipBest = isShipBestRate(rate);

  if (/gofo/i.test(blob)) {
    const service =
      serviceName
        .replace(/shipbest/gi, "")
        .replace(/gofo/gi, "GOFO")
        .replace(/\s+/g, " ")
        .trim() || "GOFO";
    return { provider: "PrepCorex", service };
  }

  // ShipBest USPS rates keep ShipBest branding (not PrepCorex).
  if (isShipBest && /usps/i.test(blob)) {
    return { provider: "ShipBest", service: "USPS" };
  }

  return { provider, service: serviceName || "Standard" };
}
