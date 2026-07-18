import type { SimpleIcon } from "simple-icons";
import {
  siShopify,
  siEbay,
  siEtsy,
  siTiktok,
  siWoocommerce,
} from "simple-icons";
import { cn } from "@/lib/utils";

const SI: Record<string, SimpleIcon> = {
  shopify: siShopify,
  ebay: siEbay,
  etsy: siEtsy,
  tiktok: siTiktok,
  woocommerce: siWoocommerce,
};

/** Amazon and Walmart are not in the current simple-icons set; use brand-colored monograms. */
const MONOGRAM: Record<string, { text: string; className: string }> = {
  amazon: { text: "AMZ", className: "text-[10px] tracking-tighter text-[#FF9900]" },
  walmart: { text: "WM", className: "text-sm tracking-tight text-[#0071CE]" },
  /** ShipStation not in simple-icons; purple aligns with common brand use */
  shipstation: { text: "SS", className: "text-[11px] font-bold tracking-tight text-[#522E92]" },
  shipbest: { text: "SB", className: "text-[11px] font-bold tracking-tight text-[#E11D48]" },
};

type PlatformBrandLogoProps = {
  platformId: string;
  /** Used when no vector logo is bundled (e.g. Amazon, Walmart). */
  shortName?: string;
  className?: string;
};

/**
 * Official vector marks from Simple Icons (CC0) where available.
 * @see https://github.com/simple-icons/simple-icons
 */
export function PlatformBrandLogo({ platformId, shortName, className }: PlatformBrandLogoProps) {
  const si = SI[platformId];
  if (si) {
    return (
      <svg
        role="img"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        className={cn("h-6 w-6 shrink-0 sm:h-7 sm:w-7", className)}
        aria-hidden
      >
        <title>{si.title}</title>
        <path fill={`#${si.hex}`} d={si.path} />
      </svg>
    );
  }

  const mono = MONOGRAM[platformId];
  if (mono) {
    return (
      <span
        className={cn(
          "font-bold leading-none tracking-tight",
          mono.className,
          className
        )}
        aria-hidden
      >
        {mono.text}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "text-xs font-bold tabular-nums text-muted-foreground",
        className
      )}
      aria-hidden
    >
      {shortName ?? "?"}
    </span>
  );
}
