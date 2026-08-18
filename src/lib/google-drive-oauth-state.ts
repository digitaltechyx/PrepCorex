import { createHmac, timingSafeEqual } from "node:crypto";

type GoogleDriveOAuthState = {
  uid: string;
  expiresAt: number;
};

function stateSecret(): string {
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) throw new Error("GOOGLE_CLIENT_SECRET is not configured");
  return secret;
}

function signature(payload: string): string {
  return createHmac("sha256", stateSecret()).update(payload).digest("base64url");
}

export function createGoogleDriveOAuthState(uid: string): string {
  const payload = Buffer.from(
    JSON.stringify({
      uid,
      expiresAt: Date.now() + 10 * 60 * 1000,
    } satisfies GoogleDriveOAuthState)
  ).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifyGoogleDriveOAuthState(value: string): GoogleDriveOAuthState | null {
  const [payload, suppliedSignature] = value.split(".");
  if (!payload || !suppliedSignature) return null;
  const expected = signature(payload);
  const suppliedBuffer = Buffer.from(suppliedSignature);
  const expectedBuffer = Buffer.from(expected);
  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as GoogleDriveOAuthState;
    if (!parsed.uid || !parsed.expiresAt || parsed.expiresAt < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}
