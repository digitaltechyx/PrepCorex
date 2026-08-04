/** Customer-facing carrier labels for Buy Labels / purchased labels. */

export type RateDisplayInput = {
  provider?: string | null;
  servicelevel?: { name?: string | null } | null;
  serviceLevel?: string | null;
  labelProvider?: string | null;
  object_id?: string | null;
  objectId?: string | null;
};

export function getBuyLabelRateDisplay(rate: RateDisplayInput): {
  provider: string;
  service: string;
} {
  const provider = String(rate.provider ?? "").trim() || "Unknown";
  const serviceName = String(
    rate.servicelevel?.name ?? rate.serviceLevel ?? ""
  ).trim();
  const blob = `${provider} ${serviceName}`;
  const isShipBest =
    rate.labelProvider === "shipbest" ||
    String(rate.object_id || rate.objectId || "").startsWith("shipbest:") ||
    /shipbest/i.test(provider);

  if (/gofo/i.test(blob)) {
    const service =
      serviceName
        .replace(/shipbest/gi, "")
        .replace(/gofo/gi, "Gofo")
        .replace(/\s+/g, " ")
        .trim() || "Gofo";
    return { provider: "PrepCorex", service };
  }

  // ShipBest USPS → PrepCorex (USPS), same customer branding as Gofo
  if (isShipBest && /usps/i.test(blob)) {
    return { provider: "PrepCorex", service: "USPS" };
  }

  return { provider, service: serviceName || "Standard" };
}
