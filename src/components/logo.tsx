import Link from "next/link";
import { cn } from "@/lib/utils";

/** Public URL for the PrepCorex wordmark SVG (spaces URL-encoded). */
export const brandLogoSrc = "/PCX%20Testing-03.svg";

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("flex items-center", className)}>
      <img
        src={brandLogoSrc}
        alt="PrepCorex"
        className="h-8 w-auto max-h-9 max-w-[min(100%,220px)] object-contain object-left"
        width={220}
        height={40}
        decoding="async"
      />
    </Link>
  );
}
