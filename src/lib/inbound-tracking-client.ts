import type { User } from "firebase/auth";
import type { InboundTrackingEntry } from "@/types";

export async function addInboundTrackingViaApi(
  user: User,
  input: {
    userId: string;
    requestId: string;
    trackingNumber: string;
    carrier?: string;
  }
): Promise<InboundTrackingEntry[]> {
  const tn = input.trackingNumber.trim();
  if (!tn) return [];

  const token = await user.getIdToken();
  const res = await fetch("/api/inbound-tracking/add", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      userId: input.userId,
      requestId: input.requestId,
      trackingNumber: tn,
      carrier: input.carrier,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to add tracking");
  return data.inboundTrackings as InboundTrackingEntry[];
}

/** Same API as the inventory table "Add tracking" action — updates inboundTrackings on each request. */
export async function addInboundTrackingToRequests(
  user: User,
  userId: string,
  pairs: Array<{ requestId: string; trackingNumber?: string; carrier?: string }>
): Promise<void> {
  const tasks = pairs
    .filter((p) => p.trackingNumber?.trim())
    .map((p) =>
      addInboundTrackingViaApi(user, {
        userId,
        requestId: p.requestId,
        trackingNumber: p.trackingNumber!.trim(),
        carrier: p.carrier,
      })
    );
  if (tasks.length === 0) return;
  await Promise.all(tasks);
}
