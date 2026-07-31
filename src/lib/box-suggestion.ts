/**
 * Optional outbound box recommendation (cartonization).
 * Advisory only — never blocks pack/outbound when measurements are missing.
 */

export type ProductUnitMeasurements = {
  unitLengthIn: number;
  unitWidthIn: number;
  unitHeightIn: number;
  unitWeightLb: number;
};

export type BoxMasterEntry = {
  code: string;
  externalLengthIn: number;
  externalWidthIn: number;
  externalHeightIn: number;
  internalLengthIn: number;
  internalWidthIn: number;
  internalHeightIn: number;
  emptyWeightLb: number;
  maxSafePackedWeightLb: number;
  usableVolumeFactor: number;
};

export type BoxSuggestionLine = {
  productId?: string;
  productName?: string;
  sku?: string;
  quantity: number;
  measurements: ProductUnitMeasurements | null;
};

export type BoxSuggestionResult =
  | {
      status: "recommended";
      box: BoxMasterEntry;
      boxCount: number;
      requiredVolumeIn3: number;
      productWeightLb: number;
      grossWeightLb: number;
      usableVolumeIn3: number;
    }
  | {
      status: "incomplete_measurements";
      missingProductNames: string[];
    }
  | {
      status: "no_fit";
      requiredVolumeIn3: number;
      productWeightLb: number;
    }
  | {
      status: "empty";
    };

export type ParcelBoxSuggestionResult =
  | {
      status: "recommended";
      box: BoxMasterEntry;
      parcelVolumeIn3: number;
      grossWeightLb: number;
      usableVolumeIn3: number;
    }
  | {
      status: "no_fit";
      parcelVolumeIn3: number;
      grossWeightLb: number;
    }
  | {
      status: "empty";
    };

/** PrepCorex approved shipping boxes (from Box Master spreadsheet). */
export const BOX_MASTER: BoxMasterEntry[] = [
  {
    code: "S-1",
    externalLengthIn: 9,
    externalWidthIn: 7,
    externalHeightIn: 5,
    internalLengthIn: 9,
    internalWidthIn: 7,
    internalHeightIn: 5,
    emptyWeightLb: 0.3,
    maxSafePackedWeightLb: 5,
    usableVolumeFactor: 0.65,
  },
  {
    code: "S-2",
    externalLengthIn: 10,
    externalWidthIn: 8,
    externalHeightIn: 6,
    internalLengthIn: 10,
    internalWidthIn: 8,
    internalHeightIn: 6,
    emptyWeightLb: 0.3,
    maxSafePackedWeightLb: 10,
    usableVolumeFactor: 0.65,
  },
  {
    code: "M-1",
    externalLengthIn: 12,
    externalWidthIn: 8,
    externalHeightIn: 8,
    internalLengthIn: 12,
    internalWidthIn: 8,
    internalHeightIn: 8,
    emptyWeightLb: 0.4,
    maxSafePackedWeightLb: 12,
    usableVolumeFactor: 0.65,
  },
  {
    code: "M-2",
    externalLengthIn: 14,
    externalWidthIn: 10,
    externalHeightIn: 8,
    internalLengthIn: 14,
    internalWidthIn: 10,
    internalHeightIn: 8,
    emptyWeightLb: 0.45,
    maxSafePackedWeightLb: 15,
    usableVolumeFactor: 0.65,
  },
  {
    code: "L-1",
    externalLengthIn: 17,
    externalWidthIn: 11,
    externalHeightIn: 12,
    internalLengthIn: 17,
    internalWidthIn: 11,
    internalHeightIn: 12,
    emptyWeightLb: 0.65,
    maxSafePackedWeightLb: 25,
    usableVolumeFactor: 0.65,
  },
  {
    code: "L-2",
    externalLengthIn: 19,
    externalWidthIn: 14,
    externalHeightIn: 17,
    internalLengthIn: 19,
    internalWidthIn: 14,
    internalHeightIn: 17,
    emptyWeightLb: 1,
    maxSafePackedWeightLb: 35,
    usableVolumeFactor: 0.65,
  },
  {
    code: "XL-1",
    externalLengthIn: 18,
    externalWidthIn: 18,
    externalHeightIn: 18,
    internalLengthIn: 18,
    internalWidthIn: 18,
    internalHeightIn: 18,
    emptyWeightLb: 1,
    maxSafePackedWeightLb: 40,
    usableVolumeFactor: 0.65,
  },
  {
    code: "OS-1",
    externalLengthIn: 27,
    externalWidthIn: 15,
    externalHeightIn: 17,
    internalLengthIn: 27,
    internalWidthIn: 15,
    internalHeightIn: 17,
    emptyWeightLb: 1.5,
    maxSafePackedWeightLb: 50,
    usableVolumeFactor: 0.65,
  },
  {
    code: "OS-2",
    externalLengthIn: 24,
    externalWidthIn: 16,
    externalHeightIn: 19,
    internalLengthIn: 24,
    internalWidthIn: 16,
    internalHeightIn: 19,
    emptyWeightLb: 1.5,
    maxSafePackedWeightLb: 55,
    usableVolumeFactor: 0.65,
  },
  {
    code: "OS-3",
    externalLengthIn: 24,
    externalWidthIn: 18,
    externalHeightIn: 18,
    internalLengthIn: 24,
    internalWidthIn: 18,
    internalHeightIn: 18,
    emptyWeightLb: 1.75,
    maxSafePackedWeightLb: 60,
    usableVolumeFactor: 0.65,
  },
];

export function parsePositiveMeasurement(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function readProductUnitMeasurements(
  source: Record<string, unknown> | null | undefined
): ProductUnitMeasurements | null {
  if (!source) return null;
  const unitLengthIn = parsePositiveMeasurement(source.unitLengthIn);
  const unitWidthIn = parsePositiveMeasurement(source.unitWidthIn);
  const unitHeightIn = parsePositiveMeasurement(source.unitHeightIn);
  const unitWeightLb = parsePositiveMeasurement(source.unitWeightLb);
  if (
    unitLengthIn == null ||
    unitWidthIn == null ||
    unitHeightIn == null ||
    unitWeightLb == null
  ) {
    return null;
  }
  return { unitLengthIn, unitWidthIn, unitHeightIn, unitWeightLb };
}

/** Partial measurement fields for Firestore writes (omit empties). */
export function measurementFieldsForWrite(input: {
  unitLengthIn?: unknown;
  unitWidthIn?: unknown;
  unitHeightIn?: unknown;
  unitWeightLb?: unknown;
}): Partial<ProductUnitMeasurements> {
  const out: Partial<ProductUnitMeasurements> = {};
  const l = parsePositiveMeasurement(input.unitLengthIn);
  const w = parsePositiveMeasurement(input.unitWidthIn);
  const h = parsePositiveMeasurement(input.unitHeightIn);
  const wt = parsePositiveMeasurement(input.unitWeightLb);
  if (l != null) out.unitLengthIn = l;
  if (w != null) out.unitWidthIn = w;
  if (h != null) out.unitHeightIn = h;
  if (wt != null) out.unitWeightLb = wt;
  return out;
}

export function formatUnitDimensions(m: Partial<ProductUnitMeasurements> | null | undefined): string {
  const l = parsePositiveMeasurement(m?.unitLengthIn);
  const w = parsePositiveMeasurement(m?.unitWidthIn);
  const h = parsePositiveMeasurement(m?.unitHeightIn);
  if (l == null || w == null || h == null) return "";
  return `${trimNum(l)} × ${trimNum(w)} × ${trimNum(h)} in`;
}

export function formatUnitWeight(m: Partial<ProductUnitMeasurements> | null | undefined): string {
  const wt = parsePositiveMeasurement(m?.unitWeightLb);
  if (wt == null) return "";
  return `${trimNum(wt)} lb`;
}

function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

export function usableVolumeIn3(box: BoxMasterEntry): number {
  return (
    box.internalLengthIn *
    box.internalWidthIn *
    box.internalHeightIn *
    box.usableVolumeFactor
  );
}

function sortedDims(a: number, b: number, c: number): [number, number, number] {
  return [a, b, c].sort((x, y) => x - y) as [number, number, number];
}

/** True if a single unit can fit in the box under some orientation. */
export function unitFitsInBox(unit: ProductUnitMeasurements, box: BoxMasterEntry): boolean {
  const u = sortedDims(unit.unitLengthIn, unit.unitWidthIn, unit.unitHeightIn);
  const b = sortedDims(box.internalLengthIn, box.internalWidthIn, box.internalHeightIn);
  return u[0] <= b[0] && u[1] <= b[1] && u[2] <= b[2];
}

/**
 * Suggest a standard carton from Buy Labels parcel inputs.
 * Entered package weight already includes packaging, so carton tare is not added again.
 */
export function suggestBoxForParcel(input: {
  lengthIn: unknown;
  widthIn: unknown;
  heightIn: unknown;
  grossWeightLb: unknown;
}): ParcelBoxSuggestionResult {
  const lengthIn = parsePositiveMeasurement(input.lengthIn);
  const widthIn = parsePositiveMeasurement(input.widthIn);
  const heightIn = parsePositiveMeasurement(input.heightIn);
  const grossWeightLb = parsePositiveMeasurement(input.grossWeightLb);
  if (
    lengthIn == null ||
    widthIn == null ||
    heightIn == null ||
    grossWeightLb == null
  ) {
    return { status: "empty" };
  }

  const parcelVolumeIn3 = lengthIn * widthIn * heightIn;
  const parcelMeasurements: ProductUnitMeasurements = {
    unitLengthIn: lengthIn,
    unitWidthIn: widthIn,
    unitHeightIn: heightIn,
    unitWeightLb: grossWeightLb,
  };

  for (const box of BOX_MASTER) {
    const usable = usableVolumeIn3(box);
    if (!unitFitsInBox(parcelMeasurements, box)) continue;
    if (parcelVolumeIn3 > usable) continue;
    if (grossWeightLb > box.maxSafePackedWeightLb) continue;
    return {
      status: "recommended",
      box,
      parcelVolumeIn3,
      grossWeightLb,
      usableVolumeIn3: usable,
    };
  }

  return { status: "no_fit", parcelVolumeIn3, grossWeightLb };
}

export function suggestBox(lines: BoxSuggestionLine[]): BoxSuggestionResult {
  const active = lines.filter((l) => Math.max(0, Math.floor(l.quantity)) > 0);
  if (active.length === 0) return { status: "empty" };

  const missing: string[] = [];
  let requiredVolumeIn3 = 0;
  let productWeightLb = 0;

  for (const line of active) {
    const qty = Math.max(0, Math.floor(line.quantity));
    if (!line.measurements) {
      missing.push(line.productName || line.sku || line.productId || "Product");
      continue;
    }
    const { unitLengthIn, unitWidthIn, unitHeightIn, unitWeightLb } = line.measurements;
    requiredVolumeIn3 += unitLengthIn * unitWidthIn * unitHeightIn * qty;
    productWeightLb += unitWeightLb * qty;
  }

  if (missing.length > 0) {
    return { status: "incomplete_measurements", missingProductNames: [...new Set(missing)] };
  }

  for (const box of BOX_MASTER) {
    const usable = usableVolumeIn3(box);
    const gross = productWeightLb + box.emptyWeightLb;
    if (requiredVolumeIn3 > usable) continue;
    if (gross > box.maxSafePackedWeightLb) continue;

    const allUnitsFit = active.every(
      (line) => line.measurements && unitFitsInBox(line.measurements, box)
    );
    if (!allUnitsFit) continue;

    return {
      status: "recommended",
      box,
      boxCount: 1,
      requiredVolumeIn3,
      productWeightLb,
      grossWeightLb: gross,
      usableVolumeIn3: usable,
    };
  }

  // When one carton cannot hold the order, recommend repeated approved cartons.
  // Prefer the fewest cartons, then the least total unused capacity.
  const multiBoxOptions = BOX_MASTER.flatMap((box) => {
    const allUnitsFit = active.every(
      (line) => line.measurements && unitFitsInBox(line.measurements, box)
    );
    if (!allUnitsFit) return [];

    const usable = usableVolumeIn3(box);
    const productWeightCapacity = box.maxSafePackedWeightLb - box.emptyWeightLb;
    if (usable <= 0 || productWeightCapacity <= 0) return [];

    const boxesForVolume = Math.ceil(requiredVolumeIn3 / usable);
    const boxesForWeight = Math.ceil(productWeightLb / productWeightCapacity);
    const boxCount = Math.max(2, boxesForVolume, boxesForWeight);

    return [
      {
        box,
        boxCount,
        usable,
        totalUsableVolumeIn3: usable * boxCount,
        grossWeightLb: productWeightLb + box.emptyWeightLb * boxCount,
      },
    ];
  }).sort(
    (a, b) =>
      a.boxCount - b.boxCount ||
      a.totalUsableVolumeIn3 - b.totalUsableVolumeIn3 ||
      a.grossWeightLb - b.grossWeightLb
  );

  const bestMultiBox = multiBoxOptions[0];
  if (bestMultiBox) {
    return {
      status: "recommended",
      box: bestMultiBox.box,
      boxCount: bestMultiBox.boxCount,
      requiredVolumeIn3,
      productWeightLb,
      grossWeightLb: bestMultiBox.grossWeightLb,
      usableVolumeIn3: bestMultiBox.totalUsableVolumeIn3,
    };
  }

  return { status: "no_fit", requiredVolumeIn3, productWeightLb };
}
