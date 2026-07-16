export const BUSINESS_TYPES = [
  "Amazon Seller",
  "Brand",
  "Wholesale",
  "Distributor",
  "Manufacturer",
  "Agency",
  "Other",
] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const SERVICES_NEEDED_OPTIONS = [
  "Amazon FBA Prep",
  "DTC/FBM Fulfillment",
  "FBM Fulfillment",
  "Storage",
  "Returns",
  "Cross-Dock",
  "Container Unloading",
  "Other",
] as const;

export type ServiceNeeded = (typeof SERVICES_NEEDED_OPTIONS)[number];

export const SALES_VOLUME_OPTIONS = [
  "1-500 units/month",
  "501-2000 units/month",
  "2001-5000 units/month",
  "5001+ units/month",
] as const;

export type SalesVolume = (typeof SALES_VOLUME_OPTIONS)[number];
