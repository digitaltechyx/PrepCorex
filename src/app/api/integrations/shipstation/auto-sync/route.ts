import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { syncShipStationOrdersForConnection } from "@/lib/shipstation-sync";
import { ensureShipStationWebhooks } from "@/lib/shipstation-webhooks";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_CONNECTIONS_PER_RUN = 40;

function isAuthorizedCron(request: NextRequest): boolean {
  const secret =
    process.env.SHIPSTATION_CRON_SECRET ||
    process.env.CRON_SECRET ||
    process.env.EBAY_CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;

  const secretParam = request.nextUrl.searchParams.get("secret");
  if (secretParam === secret) return true;

  return false;
}

/** Periodic backup sync so PrepCorex stays near real-time even if a webhook is missed. */
export async function runShipStationAutoSync(options?: { maxConnections?: number }) {
  const maxConnections = options?.maxConnections ?? MAX_CONNECTIONS_PER_RUN;
  const snap = await adminDb()
    .collectionGroup("shipstationConnections")
    .limit(maxConnections)
    .get();

  let scanned = 0;
  let syncedConnections = 0;
  let totalOrders = 0;
  let totalLabeled = 0;
  let webhooksEnsured = 0;
  const errors: string[] = [];

  for (const connDoc of snap.docs) {
    scanned += 1;
    const uid = connDoc.ref.parent.parent?.id;
    if (!uid) continue;
    const data = connDoc.data() || {};
    const apiKey = String(data.apiKey || "").trim();
    const apiSecret = String(data.apiSecret || "").trim();
    if (!apiKey || !apiSecret) {
      errors.push(`${uid}/${connDoc.id}: missing credentials`);
      continue;
    }

    const creds = { apiKey, apiSecret };
    try {
      // Heal missing webhooks (e.g. connected before webhook support, or APP_URL was localhost).
      if (!data.webhookToken || !Array.isArray(data.webhookIds) || data.webhookIds.length === 0) {
        const wh = await ensureShipStationWebhooks({
          userId: uid,
          connectionId: connDoc.id,
          creds,
          accountLabel: String(data.accountLabel || "ShipStation"),
        });
        if (wh.ok) webhooksEnsured += 1;
      }

      const result = await syncShipStationOrdersForConnection({
        userId: uid,
        connectionId: connDoc.id,
        creds,
        lookbackDays: 30,
      });
      syncedConnections += 1;
      totalOrders += result.synced;
      totalLabeled += result.withLabels;
    } catch (e) {
      errors.push(
        `${uid}/${connDoc.id}: ${e instanceof Error ? e.message : "sync failed"}`
      );
    }
  }

  return {
    scanned,
    syncedConnections,
    totalOrders,
    totalLabeled,
    webhooksEnsured,
    errors,
  };
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runShipStationAutoSync();
  return NextResponse.json({ ok: true, ...result });
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runShipStationAutoSync();
  return NextResponse.json({ ok: true, ...result });
}
