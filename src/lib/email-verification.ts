import type { User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import type { UserProfile } from "@/types";

export function getAppBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

/** New registrations after email verification launch. Existing users omit this field (grandfathered). */
export function userRequiresEmailVerification(profile: UserProfile | null | undefined): boolean {
  return profile?.emailVerificationRequired === true;
}

export function isEmailVerificationSatisfied(
  profile: UserProfile | null | undefined,
  firebaseUser: User | null | undefined
): boolean {
  if (!userRequiresEmailVerification(profile)) return true;
  return Boolean(firebaseUser?.emailVerified);
}

export function getEmailVerificationContinueUrl(): string {
  return `${getAppBaseUrl()}/login?verified=1`;
}

export async function sendUserVerificationEmail(firebaseUser: User): Promise<void> {
  const token = await firebaseUser.getIdToken();
  const res = await fetch("/api/auth/send-verification-email", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof data.error === "string" ? data.error : "Failed to send verification email."
    );
  }
}

export async function reloadAuthUser(): Promise<void> {
  if (auth.currentUser) {
    await auth.currentUser.reload();
  }
}
