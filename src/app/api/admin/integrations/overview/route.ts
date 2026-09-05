import { NextRequest, NextResponse } from "next/server";
import type { DocumentSnapshot, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import {
  INTEGRATION_PLATFORMS,
  type IntegrationPlatformId,
} from "@/lib/integration-permissions";

export const dynamic = "force-dynamic";

function isAdminOrSubAdmin(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  const role = data.role as string;
  const roles = data.roles as string[] | undefined;
  return (
    role === "admin" ||
    role === "sub_admin" ||
    (Array.isArray(roles) && (roles.includes("admin") || roles.includes("sub_admin")))
  );
}

type PlatformCounts = Record<IntegrationPlatformId, number>;

type AdminIntegrationUserRow = {
  uid: string;
  email: string;
  displayName: string;
  clientId: string;
  counts: PlatformCounts;
  totalConnections: number;
};

type PlatformStat = {
  id: IntegrationPlatformId;
  connectionCount: number;
  userCount: number;
};

type AdminConnectionRow = {
  platform: IntegrationPlatformId;
  connectionId: string;
  uid: string;
  userEmail: string;
  userDisplayName: string;
  clientId: string;
  label: string;
  sublabel: string;
  connectedAt: { seconds: number } | string | null;
};

const PLATFORM_COLLECTIONS: { platform: IntegrationPlatformId; group: string }[] = [
  { platform: "shopify", group: "shopifyConnections" },
  { platform: "ebay", group: "ebayConnections" },
  { platform: "amazon", group: "amazonConnections" },
  { platform: "tiktok", group: "tiktokConnections" },
  { platform: "woocommerce", group: "woocommerceConnections" },
  { platform: "shipstation", group: "shipstationConnections" },
];

function emptyPlatformCounts(): PlatformCounts {
  return INTEGRATION_PLATFORMS.reduce((acc, p) => {
    acc[p.id] = 0;
    return acc;
  }, {} as PlatformCounts);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function connectionLabel(
  platform: IntegrationPlatformId,
  data: Record<string, unknown>
): { label: string; sublabel: string } {
  switch (platform) {
    case "shopify": {
      const shop = String(data.shop ?? "");
      const shopName = String(data.shopName ?? "");
      return {
        label: shopName || shop || "Shopify store",
        sublabel: shop || "",
      };
    }
    case "ebay":
      return {
        label: String(data.environment ?? "eBay account"),
        sublabel: "Seller account",
      };
    case "amazon": {
      const storeName = String(data.storeName ?? data.businessName ?? "");
      const spId = String(data.sellingPartnerId ?? "");
      const env = String(data.environment ?? "");
      return {
        label: storeName || spId || "Amazon seller",
        sublabel: env ? `${env}${spId ? ` · ${spId}` : ""}` : spId,
      };
    }
    case "tiktok":
      return {
        label: String(data.shopName ?? data.sellerName ?? "TikTok Shop"),
        sublabel: String(data.shopId ?? data.region ?? ""),
      };
    case "woocommerce":
      return {
        label: String(data.accountLabel ?? "WooCommerce"),
        sublabel: String(data.storeUrl ?? ""),
      };
    case "shipstation":
      return {
        label: String(data.accountLabel ?? "ShipStation"),
        sublabel: data.apiKeyHint ? `Key ${String(data.apiKeyHint)}` : "API account",
      };
    default:
      return { label: "Connection", sublabel: "" };
  }
}

function parseConnectedAt(raw: unknown): AdminConnectionRow["connectedAt"] {
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && raw !== null && "seconds" in raw) {
    const s = (raw as { seconds?: number }).seconds;
    if (typeof s === "number") return { seconds: s };
  }
  return null;
}

/** GET: admin overview of all client integration connections. */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const decoded = await adminAuth().verifyIdToken(token);
    const callerUid = decoded.uid;
    if (!callerUid) throw new Error("No uid");
    const callerDoc = await adminDb().collection("users").doc(callerUid).get();
    if (!isAdminOrSubAdmin(callerDoc.data() as Record<string, unknown> | undefined)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  try {
    const db = adminDb();
    const snaps = await Promise.all(
      PLATFORM_COLLECTIONS.map(({ group }) => db.collectionGroup(group).get())
    );

    const userCounts = new Map<string, PlatformCounts>();
    const platformStats = INTEGRATION_PLATFORMS.reduce(
      (acc, p) => {
        acc[p.id] = { connectionCount: 0, userIds: new Set<string>() };
        return acc;
      },
      {} as Record<IntegrationPlatformId, { connectionCount: number; userIds: Set<string> }>
    );

    const connections: AdminConnectionRow[] = [];
    const uidSet = new Set<string>();

    snaps.forEach((snap, idx) => {
      const { platform } = PLATFORM_COLLECTIONS[idx];
      for (const d of snap.docs as QueryDocumentSnapshot[]) {
        const userRef = d.ref.parent.parent;
        if (!userRef || userRef.id === "_") continue;
        const uid = userRef.id;
        uidSet.add(uid);

        const cur = userCounts.get(uid) ?? emptyPlatformCounts();
        cur[platform] += 1;
        userCounts.set(uid, cur);

        const stat = platformStats[platform];
        stat.connectionCount += 1;
        stat.userIds.add(uid);

        const data = d.data() as Record<string, unknown>;
        const { label, sublabel } = connectionLabel(platform, data);
        connections.push({
          platform,
          connectionId: d.id,
          uid,
          userEmail: "",
          userDisplayName: "",
          clientId: "",
          label,
          sublabel,
          connectedAt: parseConnectedAt(data.connectedAt),
        });
      }
    });

    const uids = [...uidSet];
    const userMeta = new Map<
      string,
      { email: string; displayName: string; clientId: string }
    >();

    if (uids.length > 0) {
      const refs = uids.map((uid) => db.collection("users").doc(uid));
      const userSnaps: DocumentSnapshot[] = [];
      for (const group of chunk(refs, 10)) {
        const batch = await db.getAll(...group);
        userSnaps.push(...batch);
      }
      for (const snap of userSnaps) {
        if (!snap.exists) continue;
        const data = snap.data() as Record<string, unknown>;
        const email = String(data.email ?? data.userEmail ?? "");
        userMeta.set(snap.id, {
          email,
          displayName: String(
            data.displayName ?? data.name ?? data.fullName ?? email.split("@")[0] ?? "User"
          ),
          clientId: String(data.clientId ?? ""),
        });
      }
    }

    for (const row of connections) {
      const meta = userMeta.get(row.uid);
      if (meta) {
        row.userEmail = meta.email;
        row.userDisplayName = meta.displayName;
        row.clientId = meta.clientId;
      }
    }

    connections.sort((a, b) => {
      const nameCmp = a.userDisplayName.localeCompare(b.userDisplayName, undefined, {
        sensitivity: "base",
      });
      if (nameCmp !== 0) return nameCmp;
      return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
    });

    const users: AdminIntegrationUserRow[] = [];
    for (const [uid, counts] of userCounts) {
      const meta = userMeta.get(uid);
      if (!meta) continue;
      const totalConnections = INTEGRATION_PLATFORMS.reduce((sum, p) => sum + counts[p.id], 0);
      users.push({
        uid,
        email: meta.email,
        displayName: meta.displayName,
        clientId: meta.clientId,
        counts,
        totalConnections,
      });
    }
    users.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));

    const platforms: PlatformStat[] = INTEGRATION_PLATFORMS.map((p) => ({
      id: p.id,
      connectionCount: platformStats[p.id].connectionCount,
      userCount: platformStats[p.id].userIds.size,
    }));

    const totalConnections = platforms.reduce((sum, p) => sum + p.connectionCount, 0);
    const livePlatformsWithConnections = platforms.filter((p) => p.connectionCount > 0).length;

    return NextResponse.json({
      totalConnections,
      totalUsersWithIntegrations: users.length,
      livePlatformsWithConnections,
      platforms,
      connections,
      users,
    });
  } catch (err: unknown) {
    console.error("[admin/integrations/overview GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
