import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Trackers | PrepCorex",
  description: "Public inbound and outbound parcel tracking for PrepCorex warehouse operations.",
};

export default function TrackersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
