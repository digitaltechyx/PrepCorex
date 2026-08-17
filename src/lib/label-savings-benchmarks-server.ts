import { adminDb } from "@/lib/firebase-admin";
import {
  DEFAULT_LABEL_SAVINGS_BENCHMARKS,
  LABEL_SAVINGS_BENCHMARKS_PATH,
  normalizeLabelSavingsBenchmarks,
  type LabelSavingsBenchmarks,
} from "@/lib/label-savings-benchmarks";

export async function loadLabelSavingsBenchmarks(): Promise<LabelSavingsBenchmarks> {
  try {
    const snap = await adminDb().doc(LABEL_SAVINGS_BENCHMARKS_PATH).get();
    if (!snap.exists) return { ...DEFAULT_LABEL_SAVINGS_BENCHMARKS };
    return normalizeLabelSavingsBenchmarks(snap.data() as Partial<LabelSavingsBenchmarks>);
  } catch {
    return { ...DEFAULT_LABEL_SAVINGS_BENCHMARKS };
  }
}

export async function saveLabelSavingsBenchmarks(
  input: Partial<LabelSavingsBenchmarks>
): Promise<LabelSavingsBenchmarks> {
  const next = normalizeLabelSavingsBenchmarks(input);
  await adminDb().doc(LABEL_SAVINGS_BENCHMARKS_PATH).set(
    {
      ...next,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
  return next;
}
