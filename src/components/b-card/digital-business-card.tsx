"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import html2canvas from "html2canvas";
import { ImageDown, Linkedin, Loader2, Plus, Share2, X } from "lucide-react";
import {
  B_CARD_PROFILE,
  bCardWhatsAppUrl,
  buildBCardVCard,
} from "@/lib/b-card-profile";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SheetMode = "actions" | "share-form" | null;

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M14 8h2V5h-2c-2.2 0-4 1.8-4 4v2H8v3h2v7h3v-7h2.2l.8-3H13V9c0-.6.4-1 1-1z" />
    </svg>
  );
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm10 2H7a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3zm-5 3.5A4.5 4.5 0 1 1 7.5 12 4.5 4.5 0 0 1 12 7.5zm0 2A2.5 2.5 0 1 0 14.5 12 2.5 2.5 0 0 0 12 9.5zm5.25-3.75a1 1 0 1 1-1 1 1 1 0 0 1 1-1z" />
    </svg>
  );
}

function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .55.04.81.1v-3.5a6.37 6.37 0 0 0-.81-.05A6.34 6.34 0 0 0 3.16 15.28 6.34 6.34 0 0 0 9.5 21.62a6.34 6.34 0 0 0 6.34-6.34V8.87a8.2 8.2 0 0 0 4.76 1.52V6.94a4.85 4.85 0 0 1-1.01-.25z" />
    </svg>
  );
}

function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.893 3.488" />
    </svg>
  );
}

const SOCIAL_STYLES: Record<string, string> = {
  linkedin: "bg-[#0A66C2] text-white",
  facebook: "bg-[#1877F2] text-white",
  instagram: "bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#8134af] text-white",
  tiktok: "bg-black text-white",
  whatsapp: "bg-[#25D366] text-white",
};

function socialIcon(id: string) {
  if (id === "linkedin") return Linkedin;
  if (id === "facebook") return FacebookIcon;
  if (id === "instagram") return InstagramIcon;
  if (id === "whatsapp") return WhatsAppGlyph;
  return TikTokIcon;
}

function isMobileBrowser() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const iPadOs = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || iPadOs;
}

function isIosBrowser() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const iPadOs = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/i.test(ua) || iPadOs;
}

function isAndroidBrowser() {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent || "");
}

function buildContactVCardFile() {
  return new File([buildBCardVCard()], "Arshad-Iqbal-Prep-Services-FBA.vcf", {
    type: "text/vcard",
  });
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
}

export function DigitalBusinessCard() {
  const { toast } = useToast();
  const cardRef = useRef<HTMLElement | null>(null);
  const [cardUrl, setCardUrl] = useState("https://crm.prepservicesfba.com/b-card");
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [sheet, setSheet] = useState<SheetMode>("actions");
  const [savingLead, setSavingLead] = useState(false);
  const [savingCard, setSavingCard] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [cardPreviewUrl, setCardPreviewUrl] = useState<string | null>(null);
  const [isAndroid, setIsAndroid] = useState(false);
  const [lead, setLead] = useState({
    name: "",
    phone: "",
    email: "",
    company: "",
  });

  useEffect(() => {
    setIsAndroid(isAndroidBrowser());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/b-card`;
    setCardUrl(url);
    void QRCode.toDataURL(url, {
      width: 220,
      margin: 1,
      color: { dark: "#1a1208", light: "#ffffff" },
    }).then(setQrDataUrl);
  }, []);

  useEffect(() => {
    return () => {
      if (cardPreviewUrl) URL.revokeObjectURL(cardPreviewUrl);
    };
  }, [cardPreviewUrl]);

  const whatsappUrl = useMemo(() => bCardWhatsAppUrl(), []);

  const socialItems = useMemo(
    () => [
      ...B_CARD_PROFILE.socials,
      { id: "whatsapp" as const, label: "WhatsApp", href: whatsappUrl },
    ],
    [whatsappUrl]
  );

  /**
   * Chrome Android blocks websites from opening New Contact directly.
   * Sharing a .vcf file lets the user tap Contacts → opens New Contact pre-filled.
   * iOS Safari can open the .vcf as Create New Contact.
   */
  const saveOurContact = async () => {
    setSavingContact(true);
    try {
      const file = buildContactVCardFile();

      // Android Chrome: only reliable path is share → Contacts (Intent is blocked).
      if (isAndroidBrowser()) {
        try {
          if (navigator.canShare?.({ files: [file] })) {
            setSheet(null);
            await navigator.share({
              files: [file],
              title: B_CARD_PROFILE.name,
              text: `${B_CARD_PROFILE.name} · ${B_CARD_PROFILE.company}`,
            });
            toast({
              title: "Choose Contacts",
              description: "In the share menu tap Contacts (or Save to Contacts), then Done.",
            });
            return;
          }
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") return;
        }
        // Last resort if share files unsupported
        setSheet(null);
        window.location.assign(`${window.location.origin}/api/b-card/vcard`);
        return;
      }

      if (isIosBrowser() || isMobileBrowser()) {
        setSheet(null);
        window.location.assign(`${window.location.origin}/b-card/arshad-iqbal.vcf`);
        return;
      }

      setSheet(null);
      const href = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = href;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      toast({
        title: "Contact file ready",
        description: "Open the .vcf to add Arshad to your contacts.",
      });
    } finally {
      setSavingContact(false);
    }
  };

  /** Capture card PNG and prompt gallery save — never opens the share sheet. */
  const saveCardImage = async () => {
    if (!cardRef.current || savingCard) return;
    setSavingCard(true);
    const previousSheet = sheet;
    setSheet(null);
    await new Promise((r) => window.setTimeout(r, 160));

    try {
      const canvas = await html2canvas(cardRef.current, {
        scale: Math.min(3, window.devicePixelRatio || 2),
        useCORS: true,
        allowTaint: false,
        backgroundColor: "#ffffff",
        logging: false,
        ignoreElements: (el) =>
          el instanceof HTMLElement && el.hasAttribute("data-html2canvas-ignore"),
      });
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png")
      );
      if (!blob) throw new Error("Could not create card image.");

      if (cardPreviewUrl) URL.revokeObjectURL(cardPreviewUrl);
      const previewUrl = URL.createObjectURL(blob);
      setCardPreviewUrl(previewUrl);

      // Direct download → phone Downloads / Gallery (Android). iOS uses long-press on preview.
      triggerBlobDownload(blob, "Arshad-Iqbal-PrepCorex-card.png");

      toast({
        title: isIosBrowser() ? "Long-press to save" : "Card downloading",
        description: isIosBrowser()
          ? "Long-press the card image → Save to Photos."
          : "Check Downloads / Gallery for the card image.",
      });
    } catch (err: unknown) {
      setSheet(previousSheet);
      toast({
        variant: "destructive",
        title: "Could not save card",
        description: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setSavingCard(false);
    }
  };

  const shareCard = async () => {
    const payload = {
      title: `${B_CARD_PROFILE.name} · ${B_CARD_PROFILE.company}`,
      text: `${B_CARD_PROFILE.title} — ${B_CARD_PROFILE.tagline}`,
      url: cardUrl,
    };
    try {
      if (navigator.share) {
        await navigator.share(payload);
        return;
      }
      await navigator.clipboard.writeText(cardUrl);
      toast({
        title: "Link copied",
        description: "Digital card link copied — paste it anywhere.",
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(cardUrl);
        toast({ title: "Link copied", description: cardUrl });
      } catch {
        toast({
          variant: "destructive",
          title: "Could not share",
          description: "Copy this link manually: " + cardUrl,
        });
      }
    }
  };

  const openWhatsApp = () => {
    window.open(whatsappUrl, "_blank", "noopener,noreferrer");
  };

  const openShareContactForm = () => {
    setSheet("share-form");
  };

  const submitLead = async () => {
    setSavingLead(true);
    try {
      const res = await fetch("/api/b-card/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...lead, source: "b_card" }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Could not save.");
      toast({
        title: "Thanks — contact saved",
        description: "Your details were added to our CRM address book.",
      });
      setLead({ name: "", phone: "", email: "", company: "" });
      setSheet(null);
    } catch (err: unknown) {
      toast({
        variant: "destructive",
        title: "Could not save contact",
        description: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setSavingLead(false);
    }
  };

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-[#1a120c]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_#3a2418_0%,_#1a120c_55%,_#0d0a08_100%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-20 top-24 h-64 w-64 rounded-full bg-orange-500/20 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 bottom-32 h-72 w-72 rounded-full bg-orange-600/15 blur-3xl"
      />

      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-md items-center justify-center px-3 py-6">
        <article
          ref={cardRef}
          className="relative w-full overflow-hidden rounded-[28px] bg-white shadow-[0_30px_80px_-20px_rgba(0,0,0,0.55)]"
        >
          <header className="relative overflow-hidden px-5 pb-16 pt-6 text-white">
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-br from-[#ff7a2f] via-[#ff4d12] to-[#e03d00]"
            />
            <svg
              aria-hidden
              className="absolute bottom-0 left-0 w-full"
              viewBox="0 0 400 48"
              preserveAspectRatio="none"
            >
              <path
                d="M0 24 C80 48 140 0 220 22 C300 44 340 8 400 28 L400 48 L0 48 Z"
                fill="white"
              />
            </svg>

            <div className="relative mx-auto flex max-w-[18rem] items-center justify-center">
              <img
                src={B_CARD_PROFILE.heroBadgeSrc}
                alt={B_CARD_PROFILE.tagline}
                className="h-auto w-full rounded-2xl object-contain shadow-[0_8px_24px_rgba(0,0,0,0.25)]"
              />
            </div>
          </header>

          <div className="-mt-10 flex flex-col items-center px-5 text-center">
            <div className="relative mb-3">
              <div className="absolute -inset-1 rounded-full bg-gradient-to-br from-[#ff7a2f] to-[#e03d00] opacity-90" />
              <img
                src={B_CARD_PROFILE.photoSrc}
                alt={B_CARD_PROFILE.name}
                className="relative h-[7.25rem] w-[7.25rem] rounded-full object-cover object-top ring-[3px] ring-white"
                crossOrigin="anonymous"
              />
            </div>
            <h1 className="text-[1.65rem] font-bold tracking-tight text-slate-900">
              {B_CARD_PROFILE.name}
            </h1>
            <p className="mt-1 text-sm font-semibold text-[#ff4d12]">
              {B_CARD_PROFILE.title}
            </p>
            <p className="mt-0.5 text-xs font-medium text-slate-500">
              {B_CARD_PROFILE.company}
            </p>

            <div className="mt-4 flex w-full items-center gap-3">
              <div className="h-px flex-1 bg-slate-200" />
              <p className="whitespace-nowrap text-[11px] font-semibold tracking-wide text-slate-700">
                New Jersey, USA
              </p>
              <div className="h-px flex-1 bg-slate-200" />
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between gap-3 px-5 pb-6">
            <div className="flex flex-1 flex-wrap items-center gap-2.5">
              {socialItems.map((social) => {
                const Icon = socialIcon(social.id);
                const style = SOCIAL_STYLES[social.id] || "bg-slate-800 text-white";
                return (
                  <a
                    key={social.id}
                    href={social.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={social.label}
                    className={`flex h-11 w-11 items-center justify-center rounded-full shadow-sm transition hover:scale-105 ${style}`}
                  >
                    <Icon className="h-[1.15rem] w-[1.15rem]" />
                  </a>
                );
              })}
            </div>

            <div className="shrink-0 rounded-xl border border-slate-100 bg-slate-50 p-1.5 shadow-sm">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="QR code for this digital card"
                  className="h-[5.5rem] w-[5.5rem] rounded-lg bg-white"
                />
              ) : (
                <div className="flex h-[5.5rem] w-[5.5rem] items-center justify-center rounded-lg bg-white">
                  <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1 border-t border-slate-100 px-5 py-3 text-center text-xs text-slate-500">
            <a href={`tel:${B_CARD_PROFILE.phoneE164}`} className="block font-medium text-slate-700">
              {B_CARD_PROFILE.phoneDisplay}
            </a>
            <a href={`mailto:${B_CARD_PROFILE.email}`} className="block break-all">
              {B_CARD_PROFILE.email}
            </a>
            <a
              href={B_CARD_PROFILE.website}
              target="_blank"
              rel="noopener noreferrer"
              className="block font-semibold text-[#ff4d12]"
            >
              {B_CARD_PROFILE.websiteDisplay}
            </a>
          </div>

          {!sheet ? (
            <div
              data-html2canvas-ignore
              className="space-y-2 border-t border-slate-100 px-5 py-4"
            >
              <Button
                type="button"
                className="h-12 w-full rounded-2xl bg-[#ff4d12] text-base font-semibold hover:bg-[#e03d00]"
                onClick={() => setSheet("actions")}
              >
                Connect
              </Button>
              <button
                type="button"
                className="w-full text-center text-xs font-semibold text-slate-500"
                onClick={() => void shareCard()}
              >
                Share card link
              </button>
            </div>
          ) : (
            <div className="h-4" />
          )}
        </article>
      </div>

      {sheet ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 sm:items-center sm:p-4">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close"
            onClick={() => setSheet(null)}
          />
          <div className="relative z-10 w-full max-w-md rounded-t-[28px] bg-white px-5 pb-7 pt-3 shadow-2xl sm:rounded-[28px]">
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200" />

            <div className="mb-1 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  {sheet === "actions" ? "How would you like to connect?" : "Share your contact"}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {sheet === "actions"
                    ? isAndroid
                      ? "Save our contact opens a share menu — tap Contacts to add Arshad."
                      : "Save our contact, save the card image, chat on WhatsApp, or leave your details."
                    : "We’ll save this in the Prep Services CRM address book."}
                </p>
              </div>
              <button
                type="button"
                className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100"
                onClick={() => setSheet(null)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {sheet === "actions" ? (
              <div className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-100">
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-4 text-left text-[15px] font-semibold text-slate-900 hover:bg-orange-50 disabled:opacity-60"
                  disabled={savingContact}
                  onClick={() => void saveOurContact()}
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-100 text-[#ff4d12]">
                    {savingContact ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <Plus className="h-5 w-5" />
                    )}
                  </span>
                  Save our contact
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-4 text-left text-[15px] font-semibold text-slate-900 hover:bg-orange-50 disabled:opacity-60"
                  disabled={savingCard}
                  onClick={() => void saveCardImage()}
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#ff4d12] text-white">
                    {savingCard ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ImageDown className="h-4 w-4" />
                    )}
                  </span>
                  Save card
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-4 text-left text-[15px] font-semibold text-slate-900 hover:bg-green-50"
                  onClick={() => {
                    openWhatsApp();
                    setSheet(null);
                  }}
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#25D366] text-white">
                    <WhatsAppGlyph className="h-5 w-5" />
                  </span>
                  Open WhatsApp
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-4 text-left text-[15px] font-semibold text-slate-900 hover:bg-slate-50"
                  onClick={openShareContactForm}
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-white">
                    <Share2 className="h-4 w-4" />
                  </span>
                  Share your contact
                </button>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="lead-name">Name *</Label>
                  <Input
                    id="lead-name"
                    value={lead.name}
                    onChange={(e) => setLead((p) => ({ ...p, name: e.target.value }))}
                    placeholder="Your name"
                    disabled={savingLead}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lead-phone">Phone</Label>
                  <Input
                    id="lead-phone"
                    value={lead.phone}
                    onChange={(e) => setLead((p) => ({ ...p, phone: e.target.value }))}
                    placeholder="+1 …"
                    disabled={savingLead}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lead-email">Email</Label>
                  <Input
                    id="lead-email"
                    type="email"
                    value={lead.email}
                    onChange={(e) => setLead((p) => ({ ...p, email: e.target.value }))}
                    placeholder="you@company.com"
                    disabled={savingLead}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lead-company">Company</Label>
                  <Input
                    id="lead-company"
                    value={lead.company}
                    onChange={(e) => setLead((p) => ({ ...p, company: e.target.value }))}
                    placeholder="Optional"
                    disabled={savingLead}
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    disabled={savingLead}
                    onClick={() => setSheet("actions")}
                  >
                    Back
                  </Button>
                  <Button
                    type="button"
                    className="flex-1 bg-[#ff4d12] hover:bg-[#e03d00]"
                    disabled={savingLead}
                    onClick={() => void submitLead()}
                  >
                    {savingLead ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Share
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {cardPreviewUrl ? (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/90 px-3 py-4">
          <div className="mb-3 flex items-center justify-between gap-2 text-white">
            <div>
              <p className="text-base font-semibold">Save card to gallery</p>
              <p className="text-xs text-white/70">
                {isIosBrowser()
                  ? "Long-press the image → Save to Photos"
                  : "Image is downloading — also long-press to Save image"}
              </p>
            </div>
            <button
              type="button"
              className="rounded-full bg-white/10 p-2 hover:bg-white/20"
              onClick={() => {
                URL.revokeObjectURL(cardPreviewUrl);
                setCardPreviewUrl(null);
              }}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-auto">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={cardPreviewUrl}
              alt="Digital business card"
              className="max-h-full w-full max-w-md rounded-2xl object-contain shadow-2xl"
            />
          </div>
          <div className="mx-auto mt-3 w-full max-w-md space-y-2">
            <Button
              type="button"
              className="h-12 w-full rounded-2xl bg-[#ff4d12] hover:bg-[#e03d00]"
              onClick={() => {
                const a = document.createElement("a");
                a.href = cardPreviewUrl;
                a.download = "Arshad-Iqbal-PrepCorex-card.png";
                document.body.appendChild(a);
                a.click();
                a.remove();
                toast({
                  title: "Download started",
                  description: isIosBrowser()
                    ? "If Photos didn’t open, long-press the image above."
                    : "Check your Downloads or Gallery folder.",
                });
              }}
            >
              <ImageDown className="mr-2 h-4 w-4" />
              Download card image
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full rounded-2xl border-white/30 bg-transparent text-white hover:bg-white/10"
              onClick={() => {
                URL.revokeObjectURL(cardPreviewUrl);
                setCardPreviewUrl(null);
              }}
            >
              Done
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
