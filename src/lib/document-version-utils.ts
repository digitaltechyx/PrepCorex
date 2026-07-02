import type { UserProfile } from "@/types";

export function parseDocumentVersionInput(value: string): number {
  const trimmed = value.trim().replace(/^v/i, "");
  if (!trimmed) {
    throw new Error("Version is required.");
  }
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error("Version must be a positive number (e.g. 2.0 or 3).");
  }
  return num;
}

export function suggestNextDocumentVersion(current?: number): string {
  const next = (current || 1) + 1;
  return Number.isInteger(next) ? `${next}.0` : String(next);
}

export function formatDocumentVersionInput(version?: number): string {
  if (version == null) return "";
  return Number.isInteger(version) ? `${version}.0` : String(version);
}

export function getAcceptedMsaVersion(profile: UserProfile | null | undefined): number | null {
  if (!profile) return null;
  if (typeof profile.msaAcceptance?.version === "number") {
    return profile.msaAcceptance.version;
  }
  if (typeof profile.msaDocumentSnapshot?.version === "number") {
    return profile.msaDocumentSnapshot.version;
  }
  return null;
}

export function isMsaVersionBehind(
  acceptedVersion: number | null,
  currentVersion: number | null | undefined
): boolean {
  if (acceptedVersion == null || currentVersion == null) return false;
  return acceptedVersion < currentVersion;
}
