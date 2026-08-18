import { adminDb } from "@/lib/firebase-admin";
import {
  PREP_SAVINGS_BENCHMARKS_PATH,
  normalizePrepSavingsBenchmarks,
  type PrepSavingsBenchmarks,
} from "@/lib/prep-savings-benchmarks";

export async function loadPrepSavingsBenchmarks(): Promise<PrepSavingsBenchmarks> {
  try {
    const snap = await adminDb().doc(PREP_SAVINGS_BENCHMARKS_PATH).get();
    if (!snap.exists) return normalizePrepSavingsBenchmarks(null);
    return normalizePrepSavingsBenchmarks(snap.data() as Partial<PrepSavingsBenchmarks>);
  } catch {
    return normalizePrepSavingsBenchmarks(null);
  }
}

export async function savePrepSavingsBenchmarks(
  input: Partial<PrepSavingsBenchmarks>
): Promise<PrepSavingsBenchmarks> {
  const next = normalizePrepSavingsBenchmarks(input);
  await adminDb().doc(PREP_SAVINGS_BENCHMARKS_PATH).set({
    ...next,
    updatedAt: new Date().toISOString(),
  });
  return next;
}
