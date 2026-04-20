import type { UserPricing, ServiceType, ProductType } from "@/types";

const DEFAULT_FBA_RATES: Record<string, number> = {
  "1-999|Standard": 0.65,
  "1000-2499|Standard": 0.45,
  "2500+|Standard": 0.35,
  "1-999|Large": 0.85,
  "1000-2499|Large": 0.65,
  "2500+|Large": 0.5,
};
const DEFAULT_FBM_RATES: Record<string, number> = {
  "1-10|Standard": 2.25,
  "11-24|Standard": 2.0,
  "25-49|Standard": 1.75,
  "50+|Standard": 1.5,
  "1-10|Large": 2.5,
  "11-24|Large": 2.25,
  "25-49|Large": 2.0,
  "50+|Large": 1.75,
};

export type FbaPackAddOnConfig = {
  pack2to3?: number;
  pack4to12?: number;
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
  } else if (service === "FBM") {
    if (quantity >= 50) return "50+";
    if (quantity >= 25) return "25-49";
    if (quantity >= 11) return "11-24";
    return "1-10";
  }
  return null;
}

export function getPackAddOn(packOf: number, config?: FbaPackAddOnConfig): number {
  const value = Number(packOf || 1);
  const pack2to3 = Number(config?.pack2to3 ?? 0.35);
  const pack4to12 = Number(config?.pack4to12 ?? 0.75);
  if (value >= 4 && value <= 12) return Number.isFinite(pack4to12) ? pack4to12 : 0.75;
  if (value >= 2 && value <= 3) return Number.isFinite(pack2to3) ? pack2to3 : 0.35;
  return 0;
}

/**
 * Calculate prep unit price based on pricing rules, service, product type, and quantity
 * @param pricingRules - Array of user pricing rules
 * @param service - Service type (FBA/WFS/TFS or FBM)
 * @param productType - Product type (Standard, Large, Custom)
 * @param totalUnits - Total number of units
 * @returns Object with rate and packOf, or null if no matching pricing found
 */
export function calculatePrepUnitPrice(
  pricingRules: UserPricing[],
  service: ServiceType,
  productType: ProductType,
  totalUnits: number,
  packOf: number = 1,
  packConfig?: FbaPackAddOnConfig
): { rate: number; packOf: number } | null {
  const expectedRange = getRangeForQuantity(service, totalUnits);
  const packOfCharge =
    service === "FBA/WFS/TFS" ? getPackAddOn(packOf, packConfig) : 0;
  const defaultRateMap =
    service === "FBA/WFS/TFS" ? DEFAULT_FBA_RATES : service === "FBM" ? DEFAULT_FBM_RATES : null;

  if (defaultRateMap) {
    const defaultRate = expectedRange
      ? defaultRateMap[`${expectedRange}|${productType}`]
      : undefined;
    if ((!pricingRules || pricingRules.length === 0) && defaultRate != null) {
      return { rate: defaultRate, packOf: packOfCharge };
    }
  }

  if (!pricingRules || pricingRules.length === 0) {
    return null;
  }

  // Determine quantity tier based on monthly volume / quantity.
  
  // Find matching pricing rules by service, type, and quantity tier.
  const matchingRules = pricingRules.filter(
    (rule) => {
      const matchesService = rule.service === service;
      const matchesProductType = rule.productType === productType;
      const matchesQuantityRange = expectedRange
        ? normalizeRange(rule.quantityRange) === expectedRange
        : isQuantityInRange(totalUnits, rule.quantityRange);
      
      return matchesService && matchesProductType && matchesQuantityRange;
    }
  );

  if (matchingRules.length === 0) {
    // For FBA/FBM, do not fallback to legacy ranges. Use default new-tier pricing only.
    if (defaultRateMap) {
      const defaultRate = expectedRange
        ? defaultRateMap[`${expectedRange}|${productType}`]
        : undefined;
      if (defaultRate != null) {
        return { rate: defaultRate, packOf: packOfCharge };
      }
      return null;
    }

    // Fallback: try without package filter in case of data inconsistency
    const fallbackRules = pricingRules.filter(
      (rule) =>
        rule.service === service &&
        rule.productType === productType &&
        isQuantityInRange(totalUnits, rule.quantityRange)
    );
    
    if (fallbackRules.length === 0) {
      return null;
    }
    
    // Sort by updatedAt to get the most recent pricing
    const sortedRules = fallbackRules.sort((a, b) => {
      const aUpdated = typeof a.updatedAt === 'string' 
        ? new Date(a.updatedAt).getTime() 
        : (a.updatedAt as any)?.seconds 
          ? (a.updatedAt as any).seconds * 1000 
          : 0;
      const bUpdated = typeof b.updatedAt === 'string' 
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
      packOf: packOfCharge,
    };
  }

  // Sort by updatedAt to get the most recent pricing
  const sortedRules = matchingRules.sort((a, b) => {
    const aUpdated = typeof a.updatedAt === 'string' 
      ? new Date(a.updatedAt).getTime() 
      : (a.updatedAt as any)?.seconds 
        ? (a.updatedAt as any).seconds * 1000 
        : 0;
    const bUpdated = typeof b.updatedAt === 'string' 
      ? new Date(b.updatedAt).getTime() 
      : (b.updatedAt as any)?.seconds 
        ? (b.updatedAt as any).seconds * 1000 
        : 0;
    return bUpdated - aUpdated;
  });

  // Use the most recent pricing rule
  const latestRule = sortedRules[0];

  if (!latestRule) {
    return null;
  }

  // Calculate the rate with packOf pricing
  // The rate already includes the base unit price
  // packOf is an additional charge per pack
  const rate = latestRule.rate || 0;
  // Pack charge is now fixed by pack bucket (not multiplied per extra pack).
  // We still return it in "packOf" field to minimize caller changes.
  return {
    rate,
    packOf: packOfCharge,
  };
}

/**
 * Check if quantity falls within a quantity range
 */
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
  // Handle FBA/WFS/TFS ranges
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
  }
  // Handle FBM ranges
  else if (range === "50+") {
    return quantity >= 50;
  } else if (range === "25-49") {
    return quantity >= 25 && quantity <= 49;
  } else if (range === "11-24") {
    return quantity >= 11 && quantity <= 24;
  } else if (range === "1-10") {
    return quantity >= 1 && quantity <= 10;
  }
  // Handle legacy FBM ranges (backward compatibility)
  else if (range === "101+") {
    return quantity >= 101;
  } else if (range === "25+") {
    return quantity >= 25 && quantity < 50;
  } else if (range === "<25") {
    return quantity < 25;
  }
  // Custom range - always match (admin will handle manually)
  else if (range === "Custom") {
    return true;
  }
  return false;
}

