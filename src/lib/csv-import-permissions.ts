import type { UserFeature, UserProfile } from "@/types";
import { hasFeature, hasRole } from "@/lib/permissions";

export type CsvImportKind =
  | "inbound"
  | "outbound"
  | "buy_labels"
  | "dispose"
  | "product_returns";

export const CSV_IMPORT_FEATURE_BY_KIND: Record<CsvImportKind, UserFeature> = {
  inbound: "csv_import_inbound",
  outbound: "csv_import_outbound",
  buy_labels: "csv_import_buy_labels",
  dispose: "csv_import_dispose",
  product_returns: "csv_import_product_returns",
};

export const CSV_IMPORT_FEATURES_CONFIG: {
  value: UserFeature;
  label: string;
  description: string;
}[] = [
  {
    value: "csv_import_inbound",
    label: "Inbound CSV Import",
    description: "Bulk import inventory requests and restock lines from CSV",
  },
  {
    value: "csv_import_outbound",
    label: "Outbound CSV Import",
    description: "Bulk import outbound shipments from CSV",
  },
  {
    value: "csv_import_buy_labels",
    label: "Buy Labels CSV Import",
    description: "Bulk import shipping labels for purchase from CSV",
  },
  {
    value: "csv_import_dispose",
    label: "Dispose CSV Import",
    description: "Bulk import dispose requests from CSV",
  },
  {
    value: "csv_import_product_returns",
    label: "Product Returns CSV Import",
    description: "Bulk import product return requests from CSV",
  },
];

/** Client self-service CSV import — must be explicitly granted by admin. */
export function canUseCsvImport(
  userProfile: UserProfile | null | undefined,
  kind: CsvImportKind
): boolean {
  if (!userProfile) return false;
  if (hasRole(userProfile, "admin")) return true;
  return hasFeature(userProfile, CSV_IMPORT_FEATURE_BY_KIND[kind]);
}

/** Admin/sub-admin acting on behalf of a client may always use CSV import tools. */
export function canUseCsvImportOnBehalf(
  actor: UserProfile | null | undefined,
  kind: CsvImportKind
): boolean {
  if (!actor) return false;
  if (hasRole(actor, "admin") || hasRole(actor, "sub_admin")) return true;
  return canUseCsvImport(actor, kind);
}
