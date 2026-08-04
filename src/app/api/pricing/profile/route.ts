import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import {
  DEFAULT_PRICING_PROFILE_ID,
  getPricingProfileCollectionPath,
  getPricingProfileLabel,
  isCustomProfileId,
  type PricingDataCategory,
} from "@/lib/pricing-profiles";

export const dynamic = "force-dynamic";

const CATEGORIES: PricingDataCategory[] = [
  "prep",
  "storage",
  "boxForwarding",
  "palletForwarding",
  "containerHandling",
  "additionalServices",
];

function isAdminUser(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  const role = String(data.role || "").trim().toLowerCase();
  const roles = Array.isArray(data.roles)
    ? data.roles.map((r) => String(r).trim().toLowerCase())
    : [];
  return (
    role === "admin" ||
    role === "sub_admin" ||
    roles.includes("admin") ||
    roles.includes("sub_admin")
  );
}

/** Make Firestore values JSON-safe (Timestamps → ISO, rates → number). */
function serializeValue(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof (value as { toDate?: () => Date }).toDate === "function") {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      /* fall through */
    }
  }
  const asTs = value as { _seconds?: number; seconds?: number; nanoseconds?: number };
  if (typeof asTs._seconds === "number" || typeof asTs.seconds === "number") {
    const seconds = asTs._seconds ?? asTs.seconds ?? 0;
    const nanos = asTs.nanoseconds ?? 0;
    return new Date(seconds * 1000 + Math.floor(nanos / 1e6)).toISOString();
  }
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serializeValue(v);
    }
    return out;
  }
  return value;
}

function serializeDoc(id: string, data: Record<string, unknown>) {
  const raw = serializeValue({ id, ...data }) as Record<string, unknown>;
  if (raw.rate !== undefined && raw.rate !== null && typeof raw.rate !== "number") {
    const n = parseFloat(String(raw.rate).trim());
    if (Number.isFinite(n)) raw.rate = n;
  }
  if (raw.price !== undefined && raw.price !== null && typeof raw.price !== "number") {
    const n = parseFloat(String(raw.price).trim());
    if (Number.isFinite(n)) raw.price = n;
  }
  return raw;
}

async function loadCategory(profileId: string, category: PricingDataCategory) {
  const path = getPricingProfileCollectionPath(profileId, category);
  const snap = await adminDb().collection(path).get();
  return snap.docs.map((d) =>
    serializeDoc(d.id, d.data() as Record<string, unknown>)
  );
}

/**
 * GET /api/pricing/profile?userId=
 * Returns pricing tables for the target user's assigned profile.
 * - Clients may only request their own userId.
 * - Admins may request any userId (on-behalf shipment pricing).
 * Uses Admin SDK so Custom profile rates are not blocked by client rules/cache.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let callerUid: string;
  let callerIsAdmin = false;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    callerUid = decoded.uid;
    const callerDoc = await adminDb().collection("users").doc(callerUid).get();
    callerIsAdmin = isAdminUser(callerDoc.data() as Record<string, unknown> | undefined);
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const requestedUserId =
    request.nextUrl.searchParams.get("userId")?.trim() || callerUid;
  if (requestedUserId !== callerUid && !callerIsAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const userSnap = await adminDb().collection("users").doc(requestedUserId).get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    const userData = userSnap.data() || {};
    const rawProfileId =
      typeof userData.pricingProfileId === "string"
        ? userData.pricingProfileId.trim()
        : "";
    const profileId = rawProfileId || DEFAULT_PRICING_PROFILE_ID;

    const result: Record<string, unknown> = {
      userId: requestedUserId,
      profileId,
      profileLabel: getPricingProfileLabel(profileId),
    };

    for (const category of CATEGORIES) {
      let docs = await loadCategory(profileId, category);

      // Custom / assigned profiles: return only that profile's prep docs (never silent Standard).
      if (category === "prep") {
        result[category] = docs;
        result.prepSource = profileId;
      } else if (
        docs.length === 0 &&
        profileId !== DEFAULT_PRICING_PROFILE_ID &&
        !isCustomProfileId(profileId)
      ) {
        docs = await loadCategory(DEFAULT_PRICING_PROFILE_ID, category);
        result[category] = docs;
      } else {
        result[category] = docs;
      }
    }

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (err: unknown) {
    console.error("[pricing/profile]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
