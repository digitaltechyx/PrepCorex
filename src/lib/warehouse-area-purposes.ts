/** Suggested purposes — admin can pick these or add their own labels per warehouse. */
export const DEFAULT_WAREHOUSE_PURPOSE_SUGGESTIONS = [
  "Storage",
  "Receiving",
  "Quarantine",
  "Damaged",
  "Returns",
  "Packing",
  "Dispatch",
] as const;

export function normalizePurposeLabel(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 64);
}

export function purposeKey(label: string): string {
  return normalizePurposeLabel(label).toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

/** All purpose options shown in pickers: defaults + warehouse custom + already used on areas. */
export function mergePurposeOptions(
  warehouseCustom: string[] | undefined,
  areaPurposes: string[][]
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (label: string) => {
    const n = normalizePurposeLabel(label);
    if (!n) return;
    const k = purposeKey(n);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(n);
  };
  for (const d of DEFAULT_WAREHOUSE_PURPOSE_SUGGESTIONS) push(d);
  for (const c of warehouseCustom || []) push(c);
  for (const list of areaPurposes) {
    for (const p of list) push(p);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/** Read purposes from area doc (new `purposes[]` or legacy single `areaType`). */
export function getAreaPurposes(area: {
  purposes?: string[];
  areaType?: string;
}): string[] {
  if (Array.isArray(area.purposes) && area.purposes.length) {
    return area.purposes.map(normalizePurposeLabel).filter(Boolean);
  }
  const legacy = area.areaType ? normalizePurposeLabel(String(area.areaType)) : "";
  if (!legacy) return [];
  const map: Record<string, string> = {
    storage: "Storage",
    receiving: "Receiving",
    quarantine: "Quarantine",
    damaged: "Damaged",
    returns: "Returns",
    packing: "Packing",
    dispatch: "Dispatch",
  };
  const key = legacy.toLowerCase();
  return [map[key] || legacy];
}

export function formatPurposesList(purposes: string[]): string {
  if (!purposes.length) return "—";
  return purposes.join(", ");
}
