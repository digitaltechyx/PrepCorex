import type { Metadata } from "next";
import { DigitalBusinessCard } from "@/components/b-card/digital-business-card";
import { B_CARD_PROFILE } from "@/lib/b-card-profile";

export const metadata: Metadata = {
  title: `${B_CARD_PROFILE.name} · Digital Card | ${B_CARD_PROFILE.company}`,
  description: `${B_CARD_PROFILE.title}. ${B_CARD_PROFILE.tagline}`,
  openGraph: {
    title: `${B_CARD_PROFILE.name} · ${B_CARD_PROFILE.company}`,
    description: B_CARD_PROFILE.tagline,
    images: [{ url: B_CARD_PROFILE.photoSrc }],
  },
};

export default function BCardPage() {
  return <DigitalBusinessCard />;
}
