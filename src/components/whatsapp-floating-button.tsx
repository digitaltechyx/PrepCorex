"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

const WhatsAppIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    fill="currentColor"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden
  >
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.893 3.488" />
  </svg>
);

export function WhatsAppFloatingButton() {
  const pathname = usePathname();
  const [isVisible, setIsVisible] = React.useState(true);
  const [isClicking, setIsClicking] = React.useState(false);

  const handleWhatsAppClick = () => {
    setIsClicking(true);
    window.open("https://wa.link/771ry0", "_blank", "noopener,noreferrer");
    setTimeout(() => setIsClicking(false), 280);
  };

  // Keep the warehouse mobile bottom navigation and scan action unobstructed.
  if (!isVisible || pathname?.startsWith("/warehouse-ops")) return null;

  return (
    <div className="group/fab fixed bottom-4 right-4 z-50 sm:bottom-6 sm:right-6">
      <div className="relative animate-wa-float">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="absolute -right-1 -top-1 z-20 h-6 w-6 rounded-full bg-white p-0 text-slate-500 opacity-0 shadow-md ring-1 ring-black/5 transition-all duration-200 hover:bg-slate-50 hover:text-slate-800 group-hover/fab:opacity-100 focus-visible:opacity-100"
          onClick={() => setIsVisible(false)}
          aria-label="Hide WhatsApp button"
        >
          <X className="h-3 w-3" />
        </Button>

        {/* Soft expanding attention rings */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full bg-[#25D366]/35 animate-wa-ring"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full bg-[#25D366]/20 animate-wa-ring-delayed"
        />

        <Button
          type="button"
          onClick={handleWhatsAppClick}
          className={`
            relative z-10 flex h-14 w-14 items-center justify-center rounded-full
            bg-[#25D366] p-0 text-white shadow-[0_10px_28px_-6px_rgba(37,211,102,0.55)]
            ring-4 ring-white transition-all duration-300 ease-out
            hover:bg-[#20bd5a] hover:scale-105 hover:shadow-[0_14px_32px_-6px_rgba(37,211,102,0.65)]
            active:scale-95 md:h-16 md:w-16
            ${isClicking ? "scale-95 shadow-inner" : ""}
          `}
          aria-label="Contact us on WhatsApp"
        >
          <WhatsAppIcon className="h-7 w-7 transition-transform duration-300 group-hover/fab:scale-110 sm:h-8 sm:w-8 md:h-9 md:w-9" />

          {/* Attention badge */}
          <span className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center">
            <span
              aria-hidden
              className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-60 animate-wa-badge-ping"
            />
            <span className="relative flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold leading-none text-white shadow-sm ring-2 ring-white">
              !
            </span>
          </span>
        </Button>
      </div>
    </div>
  );
}
