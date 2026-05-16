import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Remove undefined values so Firestore addDoc/setDoc accepts the payload. */
export function stripUndefined<T>(value: T): T {
  if (value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => stripUndefined(v)) as T;
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}
