import {
  buildWarehouseCartonLabelsPdf,
  downloadUint8ArrayAsFile,
} from "@/lib/warehouse-carton-label-pdf";
import { buildWarehousePackageLabelsPdf } from "@/lib/warehouse-package-label-pdf";
import { buildWarehousePalletLabelsPdf } from "@/lib/warehouse-pallet-label-pdf";
import { printContainerLabels } from "@/lib/warehouse-container-label-pdf";
import type { WarehouseCartonDoc, WarehousePalletDoc } from "@/types";

/**
 * Re-download receive labels for cartons and/or pallets (Log / Last batch reprint).
 * Splits packages, containers, and regular cartons into the correct PDF builders.
 */
export async function downloadReceiveLabels(input: {
  warehouseCode: string;
  cartons?: WarehouseCartonDoc[];
  pallets?: WarehousePalletDoc[];
}): Promise<{ files: number }> {
  const cartons = (input.cartons ?? []).filter((c) => c.status !== "voided" && c.cartonCode);
  const pallets = (input.pallets ?? []).filter((p) => p.palletCode);
  if (cartons.length === 0 && pallets.length === 0) {
    throw new Error("No labels available to download.");
  }

  let files = 0;
  const code = input.warehouseCode || "WH";

  const containers = cartons.filter((c) => c.isContainer);
  const packages = cartons.filter((c) => c.isPackage && !c.isContainer);
  const regular = cartons.filter((c) => !c.isPackage && !c.isContainer);

  if (containers.length > 0) {
    await printContainerLabels(containers);
    files += 1;
  }
  if (packages.length > 0) {
    const pdf = await buildWarehousePackageLabelsPdf({
      title: `${code} — ${packages.length} PKG label${packages.length > 1 ? "s" : ""}`,
      packages,
    });
    downloadUint8ArrayAsFile(
      pdf,
      `pkg-labels-${packages[0]!.cartonCode}-${packages.length}.pdf`
    );
    files += 1;
  }
  if (regular.length > 0) {
    const pdf = await buildWarehouseCartonLabelsPdf({
      title: `${code} — ${regular.length} label${regular.length > 1 ? "s" : ""}`,
      // Closed cross-dock may have empty SKU — label builder requires a non-empty sku field.
      cartons: regular.map((c) => ({
        ...c,
        sku: c.sku?.trim() || c.receiveLot?.trim() || "CLOSED",
      })),
    });
    downloadUint8ArrayAsFile(
      pdf,
      `labels-${regular[0]!.cartonCode}-${regular.length}.pdf`
    );
    files += 1;
  }
  if (pallets.length > 0) {
    const pdf = await buildWarehousePalletLabelsPdf({
      title: `${code} — pallet label${pallets.length > 1 ? "s" : ""}`,
      pallets,
    });
    const name =
      pallets.length === 1
        ? `${pallets[0]!.palletCode}-reprint.pdf`
        : `pallet-labels-${pallets[0]!.palletCode}-${pallets.length}.pdf`;
    downloadUint8ArrayAsFile(pdf, name);
    files += 1;
  }

  return { files };
}
