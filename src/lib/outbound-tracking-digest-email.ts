import { sendServerEmail } from "@/lib/server-smtp";
import { formatOutboundTrackerDate } from "@/lib/outbound-tracking";
import type { OutboundDigestFirstChange, OutboundDigestStale } from "@/lib/outbound-tracking-service";

const DEFAULT_TO = "info@prepservicesfba.com";

function formatDateHeading(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
}

export async function sendOutboundTrackerDigestEmail(input: {
  firstChanges: OutboundDigestFirstChange[];
  stale: OutboundDigestStale[];
}): Promise<void> {
  const to = (process.env.OUTBOUND_TRACKER_DIGEST_EMAIL || DEFAULT_TO).trim();
  const lines: string[] = [
    "PrepCorex Outbound Tracker — daily update",
    formatDateHeading(),
    "",
  ];

  if (input.firstChanges.length > 0) {
    lines.push("STATUS CHANGED (first time since scan)");
    lines.push("--------------------------------------");
    for (const row of input.firstChanges) {
      lines.push(`Tracking: ${row.trackingNumber}`);
      lines.push(`  Was: ${row.fromLabel}`);
      lines.push(`  Now: ${row.toLabel}`);
      lines.push(`  Added: ${formatOutboundTrackerDate(row.addedAt)}`);
      lines.push("");
    }
  }

  if (input.stale.length > 0) {
    lines.push("NO STATUS CHANGE (48+ hours since scan — one-time notice)");
    lines.push("--------------------------------------------------------");
    for (const row of input.stale) {
      lines.push(`Tracking: ${row.trackingNumber}`);
      lines.push(`  Status since scan: ${row.statusLabel}`);
      lines.push(`  Added: ${formatOutboundTrackerDate(row.addedAt)}`);
      lines.push("");
    }
  }

  lines.push("—");
  lines.push("PrepCorex Outbound Tracker");
  lines.push("https://crm.prepservicesfba.com/admin/dashboard/outbound-tracker");

  await sendServerEmail({
    to,
    subject: `Outbound Tracker — daily update (${formatDateHeading()})`,
    message: lines.join("\n"),
  });
}
