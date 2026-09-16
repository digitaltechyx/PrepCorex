import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";

export const PUBLIC_TRACKERS_SETTINGS_PATH = "appSettings/publicTrackers";

export type PublicTrackersSettingsDoc = {
  pinEnabled: boolean;
  pinSalt: string | null;
  pinHash: string | null;
  sessionVersion: number;
  updatedAt?: FirebaseFirestore.Timestamp;
  updatedBy?: string | null;
  updatedByName?: string | null;
};

export type PublicTrackersSettingsPublic = {
  pinEnabled: boolean;
  pinConfigured: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
};

const PIN_MIN_LEN = 4;
const PIN_MAX_LEN = 12;

function hashPin(pin: string, salt: string): string {
  return scryptSync(pin, salt, 32).toString("hex");
}

function verifyPinHash(pin: string, salt: string, expectedHash: string): boolean {
  try {
    const derived = scryptSync(pin, salt, 32);
    const expected = Buffer.from(expectedHash, "hex");
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function normalizePublicTrackersPin(raw: unknown): string | null {
  const pin = String(raw ?? "").trim();
  if (!pin) return null;
  if (pin.length < PIN_MIN_LEN || pin.length > PIN_MAX_LEN) {
    throw new Error(`PIN must be ${PIN_MIN_LEN}–${PIN_MAX_LEN} characters.`);
  }
  if (!/^[0-9A-Za-z]+$/.test(pin)) {
    throw new Error("PIN may only contain letters and numbers.");
  }
  return pin;
}

function docFromFirestore(data: FirebaseFirestore.DocumentData | undefined): PublicTrackersSettingsDoc {
  return {
    pinEnabled: data?.pinEnabled === true,
    pinSalt: data?.pinSalt ? String(data.pinSalt) : null,
    pinHash: data?.pinHash ? String(data.pinHash) : null,
    sessionVersion: Math.max(1, Number(data?.sessionVersion) || 1),
    updatedAt: data?.updatedAt as FirebaseFirestore.Timestamp | undefined,
    updatedBy: data?.updatedBy != null ? String(data.updatedBy) : null,
    updatedByName: data?.updatedByName != null ? String(data.updatedByName) : null,
  };
}

export function isPublicTrackersPinConfigured(settings: PublicTrackersSettingsDoc): boolean {
  return Boolean(settings.pinEnabled && settings.pinSalt && settings.pinHash);
}

export async function loadPublicTrackersSettings(): Promise<PublicTrackersSettingsDoc> {
  const snap = await adminDb().doc(PUBLIC_TRACKERS_SETTINGS_PATH).get();
  if (!snap.exists) {
    return {
      pinEnabled: false,
      pinSalt: null,
      pinHash: null,
      sessionVersion: 1,
    };
  }
  return docFromFirestore(snap.data());
}

export function toPublicTrackersSettingsView(
  settings: PublicTrackersSettingsDoc
): PublicTrackersSettingsPublic {
  let updatedAt: string | null = null;
  if (settings.updatedAt && typeof settings.updatedAt.toDate === "function") {
    updatedAt = settings.updatedAt.toDate().toISOString();
  }
  return {
    pinEnabled: isPublicTrackersPinConfigured(settings),
    pinConfigured: isPublicTrackersPinConfigured(settings),
    updatedAt,
    updatedByName: settings.updatedByName ?? null,
  };
}

export async function verifyPublicTrackersPin(pin: string): Promise<boolean> {
  const settings = await loadPublicTrackersSettings();
  if (!isPublicTrackersPinConfigured(settings)) return true;
  return verifyPinHash(pin, settings.pinSalt!, settings.pinHash!);
}

export async function savePublicTrackersPin(input: {
  pin: string;
  adminUid: string;
  adminName: string;
}): Promise<PublicTrackersSettingsDoc> {
  const pin = normalizePublicTrackersPin(input.pin);
  if (!pin) throw new Error("PIN is required.");

  const current = await loadPublicTrackersSettings();
  const salt = randomBytes(16).toString("hex");
  const pinHash = hashPin(pin, salt);

  const next: PublicTrackersSettingsDoc = {
    pinEnabled: true,
    pinSalt: salt,
    pinHash,
    sessionVersion: current.sessionVersion + 1,
    updatedAt: Timestamp.now(),
    updatedBy: input.adminUid,
    updatedByName: input.adminName,
  };

  await adminDb().doc(PUBLIC_TRACKERS_SETTINGS_PATH).set(next, { merge: true });
  return next;
}

export async function disablePublicTrackersPin(input: {
  adminUid: string;
  adminName: string;
}): Promise<PublicTrackersSettingsDoc> {
  const current = await loadPublicTrackersSettings();
  const next: PublicTrackersSettingsDoc = {
    pinEnabled: false,
    pinSalt: null,
    pinHash: null,
    sessionVersion: current.sessionVersion + 1,
    updatedAt: Timestamp.now(),
    updatedBy: input.adminUid,
    updatedByName: input.adminName,
  };
  await adminDb().doc(PUBLIC_TRACKERS_SETTINGS_PATH).set(next, { merge: true });
  return next;
}
