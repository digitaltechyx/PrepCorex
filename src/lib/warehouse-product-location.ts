import type { WarehouseCartonDoc, WarehouseCartonLine } from "@/types";

export type ProductLocationKind =
  | "bin"
  | "area"
  | "receiving"
  | "picked"
  | "quarantine"
  | "pack"
  | "other";

export type ProductLocationInfo = {
  label: string;
  kind: ProductLocationKind;
  stagingArea: string | null;
};

const CARTON_STATUS_LABEL: Record<string, string> = {
  received: "Awaiting putaway",
  stowed: "In storage bin",
  stowed_partial: "Partially stowed",
  split: "Split across bins",
  quarantine: "Quarantine",
  on_hold: "On hold",
  picked: "Picked",
  packed: "Packed",
  ready_to_dispatch: "Ready to dispatch",
  damaged: "Damaged hold",
};

export function describeProductLineLocation(input: {
  line: WarehouseCartonLine;
  carton: WarehouseCartonDoc;
  binPath: string | null;
}): ProductLocationInfo {
  const { line, carton, binPath } = input;
  const stagingArea =
    (line.stagingArea ?? carton.stagingArea ?? "").trim() || null;
  const lineStatus = line.allocationStatus ?? "unallocated";

  if (lineStatus === "picked") {
    return {
      kind: "picked",
      stagingArea,
      label: stagingArea
        ? `Picked · staging ${stagingArea}`
        : "Picked · en route to pack / outbound",
    };
  }

  const isDamaged =
    line.condition === "damaged" ||
    carton.status === "quarantine" ||
    carton.status === "damaged";

  if (isDamaged) {
    if (binPath) {
      return { kind: "quarantine", stagingArea, label: `Quarantine · ${binPath}` };
    }
    if (stagingArea) {
      return { kind: "quarantine", stagingArea, label: `Quarantine · area ${stagingArea}` };
    }
    return { kind: "quarantine", stagingArea, label: "Quarantine · awaiting placement" };
  }

  if (binPath) {
    return { kind: "bin", stagingArea, label: binPath };
  }

  if (stagingArea) {
    return { kind: "area", stagingArea, label: `Floor area ${stagingArea}` };
  }

  if (carton.status === "received" || carton.status === "receiving") {
    return {
      kind: "receiving",
      stagingArea: stagingArea ?? "RCV-STAGE",
      label: stagingArea
        ? `Receiving · ${stagingArea}`
        : "Receiving dock · awaiting putaway",
    };
  }

  if (
    (carton.status as string) === "ready_to_dispatch" ||
    (carton.status as string) === "packed"
  ) {
    return {
      kind: "pack",
      stagingArea,
      label: stagingArea ? `Dispatch · ${stagingArea}` : "Pack / dispatch staging",
    };
  }

  const statusHint = CARTON_STATUS_LABEL[carton.status] ?? carton.status;
  return {
    kind: "other",
    stagingArea,
    label: statusHint,
  };
}

export function locationKindMatchesStage(
  kind: ProductLocationKind,
  stage: string
): boolean {
  if (stage === "all") return true;
  if (stage === "receiving") return kind === "receiving";
  if (stage === "bin") return kind === "bin";
  if (stage === "area") return kind === "area";
  if (stage === "picked") return kind === "picked";
  if (stage === "quarantine") return kind === "quarantine";
  if (stage === "pack") return kind === "pack";
  return true;
}

export function matchesProductSearchQuery(input: {
  query: string;
  sku: string;
  productTitle?: string | null;
  cartonCode: string;
  binPath?: string | null;
  locationLabel?: string;
}): boolean {
  const q = input.query.trim().toUpperCase();
  if (!q) return true;
  const hay = [
    input.sku,
    input.productTitle ?? "",
    input.cartonCode,
    input.binPath ?? "",
    input.locationLabel ?? "",
  ]
    .join(" ")
    .toUpperCase();
  return hay.includes(q);
}
