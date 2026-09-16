import { createHmac, timingSafeEqual } from "crypto";
import type { NextRequest, NextResponse } from "next/server";

export const PUBLIC_TRACKERS_COOKIE = "pcx_trackers_unlock";
/** Keep unlocked for 7 days on the same browser. */
export const PUBLIC_TRACKERS_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 7;

type SessionPayload = {
  exp: number;
  v: number;
};

function sessionSecret(): string {
  return (
    process.env.TRACKERS_SESSION_SECRET ||
    process.env.INVOICE_CRON_SECRET ||
    process.env.FIREBASE_ADMIN_PRIVATE_KEY?.slice(0, 80) ||
    "prepcorex-trackers-session"
  );
}

function signPayload(encoded: string): string {
  return createHmac("sha256", sessionSecret()).update(encoded).digest("base64url");
}

function encodeSession(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = signPayload(body);
  return `${body}.${sig}`;
}

function decodeSession(token: string): SessionPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = signPayload(body);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (!parsed || typeof parsed.exp !== "number" || typeof parsed.v !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function readPublicTrackersSession(
  request: NextRequest,
  sessionVersion: number
): boolean {
  const raw = request.cookies.get(PUBLIC_TRACKERS_COOKIE)?.value;
  if (!raw) return false;
  const payload = decodeSession(raw);
  if (!payload) return false;
  if (payload.v !== sessionVersion) return false;
  if (payload.exp <= Math.floor(Date.now() / 1000)) return false;
  return true;
}

export function setPublicTrackersSessionCookie(
  response: NextResponse,
  sessionVersion: number
): void {
  const exp = Math.floor(Date.now() / 1000) + PUBLIC_TRACKERS_COOKIE_MAX_AGE_SEC;
  const token = encodeSession({ exp, v: sessionVersion });
  response.cookies.set(PUBLIC_TRACKERS_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PUBLIC_TRACKERS_COOKIE_MAX_AGE_SEC,
  });
}

export function clearPublicTrackersSessionCookie(response: NextResponse): void {
  response.cookies.set(PUBLIC_TRACKERS_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
