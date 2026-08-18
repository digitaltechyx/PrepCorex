"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

// WhatsApp Icon Component
const WhatsAppIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    fill="currentColor"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.893 3.488"/>
  </svg>
);

export function WhatsAppFloatingButton() {
  const pathname = usePathname();
  const [isVisible, setIsVisible] = React.useState(true);
  const [isClicking, setIsClicking] = React.useState(false);

  const handleWhatsAppClick = () => {
    setIsClicking(true);
    // Open WhatsApp link in new tab
    window.open("https://wa.link/771ry0", "_blank", "noopener,noreferrer");
    // Reset clicking state after animation
    setTimeout(() => setIsClicking(false), 300);
  };

  // Keep the warehouse mobile bottom navigation and scan action unobstructed.
  if (!isVisible || pathname?.startsWith("/warehouse-ops")) return null;

  return (
    <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50">
      {/* Close button */}
      <Button
        variant="ghost"
        size="sm"
        className="absolute -top-2 -right-2 h-6 w-6 p-0 rounded-full bg-white shadow-lg hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-all duration-300 hover:scale-125"
        onClick={() => setIsVisible(false)}
      >
        <X className="h-3 w-3" />
      </Button>

      {/* WhatsApp Button */}
      <Button
        onClick={handleWhatsAppClick}
        className={`
          group relative h-12 w-12 sm:h-14 sm:w-14 md:h-16 md:w-16 rounded-full bg-whatsapp 
          hover:bg-whatsapp/90 transition-all duration-300 
          hover:scale-110 active:scale-95 shadow-2xl hover:shadow-3xl
          ${isClicking ? 'scale-95 shadow-inner' : 'shadow-lg'}
          hover:rotate-3 hover:shadow-green-500/25
        `}
        aria-label="Contact us on WhatsApp"
      >
        {/* WhatsApp Icon */}
        <WhatsAppIcon className="h-6 w-6 sm:h-7 sm:w-7 md:h-9 md:w-9 text-white transition-transform duration-300 group-hover:scale-110" />
        
        {/* Floating Animation Ring */}
        <div className="absolute inset-0 rounded-full bg-whatsapp opacity-20 animate-bounce-slow"></div>
        
        {/* Sequential Ripple Effect */}
        <div className="absolute inset-0 rounded-full bg-whatsapp opacity-30 animate-ping-delayed-1"></div>
        <div className="absolute inset-0 rounded-full bg-whatsapp opacity-20 animate-ping-delayed-2"></div>
        
        {/* Tooltip */}
        <div className="hidden sm:block absolute right-16 md:right-20 top-1/2 transform -translate-y-1/2 bg-gray-900 text-white text-xs md:text-sm px-3 md:px-4 py-2 rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-300 whitespace-nowrap shadow-lg animate-fade-in">
          <span className="font-medium">Contact us on WhatsApp</span>
          <div className="absolute left-full top-1/2 transform -translate-y-1/2 border-l-4 border-l-gray-900 border-y-4 border-y-transparent"></div>
        </div>

        {/* Notification Badge */}
        <div className="absolute -top-0.5 -right-0.5 sm:-top-1 sm:-right-1 h-3 w-3 sm:h-4 sm:w-4 md:h-5 md:w-5 bg-red-500 rounded-full flex items-center justify-center animate-bounce">
          <span className="text-xs sm:text-xs text-white font-bold">!</span>
        </div>
      </Button>
    </div>
  );
}

