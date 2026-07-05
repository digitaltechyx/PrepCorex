import type { UserPricing, ServiceType, ProductType } from "@/types";
import { isDtcFbmService, servicesMatch } from "@/types";

const DEFAULT_FBA_RATES: Record<string, number> = {
  "1-999|Standard": 0.65,
  "1000-2499|Standard": 0.45,
  "2500+|Standard": 0.35,
};
const DEFAULT_FBM_RATES: Record<string, number> = {
  "1-10|Standard": 2.25,
  "11-24|Standard": 2.0,
  "25-49|Standard": 1.75,
  "50+|Standard": 1.5,
};

/**
 * Determine the quantity tier used for pricing lookup.
 * FBA/WFS/TFS now uses simple monthly-volume tiers.
 */
function getRangeForQuantity(service: ServiceType, quantity: number): string | null {
  if (service === "FBA/WFS/TFS") {
    if (quantity >= 2500) return "2500+";
    if (quantity >= 1000) return "1000-2499";
    return "1-999";
  } else if (isDtcFbmService(service)) {
    if (quantity >= 50) return "50+";
    if (quantity >= 25) return "25-49";
    if (quantity >= 11) return "11-24";
    return "1-10";
  }
  return null;
}

/**
 * Calculate prep unit price based on pricing rules, service, product type, and quantity.
 */
export function calculatePrepUnitPrice(
  pricingRules: UserPricing[],
  service: ServiceType,
  productType: ProductType,
  totalUnits: number
): { rate: number } | null {
  const expectedRange = getRangeForQuantity(service, totalUnits);
  const defaultRateMap =
    service === "FBA/WFS/TFS" ? DEFAULT_FBA_RATES : isDtcFbmService(service) ? DEFAULT_FBM_RATES : null;

  if (defaultRateMap) {
    const defaultRate = expectedRange
      ? defaultRateMap[`${expectedRange}|${productType}`]
      : undefined;
    if ((!pricingRules || pricingRules.length === 0) && defaultRate != null) {
      return { rate: defaultRate };
    }
  }

  if (!pricingRules || pricingRules.length === 0) {
    return null;
  }

  const matchingRules = pricingRules.filter(
    (rule) => {
      const matchesService = servicesMatch(rule.service, service);
      const matchesProductType = rule.productType === productType;
      const matchesQuantityRange = expectedRange
        ? normalizeRange(rule.quantityRange) === expectedRange
        : isQuantityInRange(totalUnits, rule.quantityRange);

      return matchesService && matchesProductType && matchesQuantityRange;
    }
  );

  if (matchingRules.length === 0) {
    if (defaultRateMap) {
      const defaultRate = expectedRange
        ? defaultRateMap[`${expectedRange}|${productType}`]
        : undefined;
      if (defaultRate != null) {
        return { rate: defaultRate };
      }
      return null;
    }

    const fallbackRules = pricingRules.filter(
      (rule) =>
        servicesMatch(rule.service, service) &&
        rule.productType === productType &&
        isQuantityInRange(totalUnits, rule.quantityRange)
    );

    if (fallbackRules.length === 0) {
      return null;
    }

    const sortedRules = fallbackRules.sort((a, b) => {
      const aUpdated = typeof a.updatedAt === "string"
        ? new Date(a.updatedAt).getTime()
        : (a.updatedAt as any)?.seconds
          ? (a.updatedAt as any).seconds * 1000
          : 0;
      const bUpdated = typeof b.updatedAt === "string"
        ? new Date(b.updatedAt).getTime()
        : (b.updatedAt as any)?.seconds
          ? (b.updatedAt as any).seconds * 1000
          : 0;
      return bUpdated - aUpdated;
    });

    const latestRule = sortedRules[0];
    if (!latestRule) {
      return null;
    }

    return {
      rate: latestRule.rate || 0,
    };
  }

  const sortedRules = matchingRules.sort((a, b) => {
    const aUpdated = typeof a.updatedAt === "string"
      ? new Date(a.updatedAt).getTime()
      : (a.updatedAt as any)?.seconds
        ? (a.updatedAt as any).seconds * 1000
        : 0;
    const bUpdated = typeof b.updatedAt === "string"
      ? new Date(b.updatedAt).getTime()
      : (b.updatedAt as any)?.seconds
        ? (b.updatedAt as any).seconds * 1000
        : 0;
    return bUpdated - aUpdated;
  });

  const latestRule = sortedRules[0];

  if (!latestRule) {
    return null;
  }

  return {
    rate: latestRule.rate || 0,
  };
}

function normalizeRange(range: string | undefined | null): string {
  const value = String(range || "").trim();
  if (!value) return "";
  if (value === "2500+") return "2500+";
  if (value === "1000-2499") return "1000-2499";
  if (value === "1-999") return "1-999";
  if (value === "50+") return "50+";
  if (value === "25-49") return "25-49";
  if (value === "11-24") return "11-24";
  if (value === "1-10") return "1-10";
  return value;
}

function isQuantityInRange(quantity: number, range: string): boolean {
  if (range === "2500+") {
    return quantity >= 2500;
  } else if (range === "1000-2499") {
    return quantity >= 1000 && quantity <= 2499;
  } else if (range === "1-999") {
    return quantity >= 1 && quantity <= 999;
  } else if (range === "1001+") {
    return quantity >= 1001;
  } else if (range === "501-1000") {
    return quantity >= 501 && quantity <= 1000;
  } else if (range === "50-500") {
    return quantity >= 50 && quantity <= 500;
  } else if (range === "<50") {
    return quantity < 50;
  } else if (range === "50+") {
    return quantity >= 50;
  } else if (range === "25-49") {
    return quantity >= 25 && quantity <= 49;
  } else if (range === "11-24") {
    return quantity >= 11 && quantity <= 24;
  } else if (range === "1-10") {
    return quantity >= 1 && quantity <= 10;
  } else if (range === "101+") {
    return quantity >= 101;
  } else if (range === "25+") {
    return quantity >= 25 && quantity < 50;
  } else if (range === "<25") {
    return quantity < 25;
  } else if (range === "Custom") {
    return true;
  }
  return false;
}

