/** Public digital business card profile (Prep Services FBA / PrepCorex). */

export const B_CARD_PROFILE = {
  name: "Arshad Iqbal",
  title: "Founder & Managing Director",
  company: "Prep Services FBA LLC",
  tagline: "The Partner Behind Your Fulfillment",
  email: "arshad@prepservicesfba.com",
  phoneDisplay: "+1 347 661 3010",
  phoneE164: "+13476613010",
  location: "New Jersey, USA",
  website: "https://www.prepservicesfba.com",
  websiteDisplay: "www.prepservicesfba.com",
  photoSrc: "/b-card/arshad-iqbal.jpg",
  heroBadgeSrc: "/b-card/partner-behind-fulfillment.jpg",
  prepcorexLogoSrc: "/b-card/prepcorex-logo.png",
  companyLogoSrc: "/b-card/prep-services-logo.png",
  socials: [
    {
      id: "linkedin",
      label: "LinkedIn",
      href: "https://www.linkedin.com/in/arshadibl",
    },
    {
      id: "facebook",
      label: "Facebook",
      href: "https://www.facebook.com/PrepServicesFBA/",
    },
    {
      id: "instagram",
      label: "Instagram",
      href: "https://www.instagram.com/prepservicesfba",
    },
    {
      id: "tiktok",
      label: "TikTok",
      href: "https://www.tiktok.com/@prepservicesfba",
    },
  ],
} as const;

export function bCardWhatsAppUrl(message?: string): string {
  const text =
    message?.trim() ||
    `Hi Arshad — I found your digital card and would like to connect about fulfillment.`;
  return `https://wa.me/${B_CARD_PROFILE.phoneE164.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

export function buildBCardVCard(): string {
  const p = B_CARD_PROFILE;
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${p.name}`,
    `N:Iqbal;Arshad;;;`,
    `TITLE:${p.title}`,
    `ORG:${p.company}`,
    `TEL;TYPE=CELL,VOICE:${p.phoneE164}`,
    `EMAIL;TYPE=INTERNET:${p.email}`,
    `ADR;TYPE=WORK:;;${p.location};;;;`,
    `URL:${p.website}`,
    `NOTE:${p.tagline}`,
    "END:VCARD",
  ];
  return lines.join("\r\n");
}
