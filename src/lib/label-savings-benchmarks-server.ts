import { adminDb } from "@/lib/firebase-admin";
import {
  LABEL_SAVINGS_BENCHMARKS_PATH,
  normalizeLabelSavingsBenchmarks,
  type LabelSavingsBenchmarks,
  type LabelSavingsBenchmarksInput,
} from "@/lib/label-savings-benchmarks";

export async function loadLabelSavingsBenchmarks(): Promise<LabelSavingsBenchmarks> {
  try {
    const snap = await adminDb().doc(LABEL_SAVINGS_BENCHMARKS_PATH).get();
    if (!snap.exists) return normalizeLabelSavingsBenchmarks(null);
    return normalizeLabelSavingsBenchmarks(snap.data() as LabelSavingsBenchmarksInput);
  } catch {
    return normalizeLabelSavingsBenchmarks(null);
  }
}

export async function saveLabelSavingsBenchmarks(
  input: LabelSavingsBenchmarksInput
): Promise<LabelSavingsBenchmarks> {
  const next = normalizeLabelSavingsBenchmarks(input);
  await adminDb().doc(LABEL_SAVINGS_BENCHMARKS_PATH).set({
    bands: next.bands,
    updatedAt: new Date().toISOString(),
  });
  return next;
}
