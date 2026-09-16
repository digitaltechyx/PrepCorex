"use client";

import { PublicTrackersPinGate } from "@/components/trackers/public-trackers-pin-gate";
import { PublicTrackersShell } from "@/components/trackers/public-trackers-shell";

export function PublicTrackersLayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <PublicTrackersShell>
      <PublicTrackersPinGate>{children}</PublicTrackersPinGate>
    </PublicTrackersShell>
  );
}
