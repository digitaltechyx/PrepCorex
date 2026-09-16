import type { Metadata } from "next";
import { PublicTrackersLayoutClient } from "@/components/trackers/public-trackers-layout-client";

export const metadata: Metadata = {
  title: "Trackers | PrepCorex",
  description: "Public inbound and outbound parcel tracking for PrepCorex warehouse operations.",
};

export default function TrackersLayout({ children }: { children: React.ReactNode }) {
  return <PublicTrackersLayoutClient>{children}</PublicTrackersLayoutClient>;
}
