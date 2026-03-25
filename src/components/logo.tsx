import Link from "next/link";
import { cn } from "@/lib/utils";

/** Public URL for the PrepCorex wordmark SVG (spaces URL-encoded). */
export const brandLogoSrc = "/PCX%20Testing-03.svg";

type LogoProps = {
  className?: string;
  /**
   * `auth` — larger, centered (login / register / register-agent).
   * `default` — sidebars, compact headers.
   */
  variant?: "default" | "auth";
};

export function Logo({ className, variant = "default" }: LogoProps) {
  const isAuth = variant === "auth";
  return (
    <Link
      href="/"
      className={cn(
        "flex items-center",
        isAuth && "w-full justify-center",
        className
      )}
    >
      <img
        src={brandLogoSrc}
        alt="PrepCorex"
        className={cn(
          "w-auto object-contain",
          isAuth
            ? "h-16 sm:h-[4.5rem] md:h-20 max-w-[min(100%,min(92vw,480px))] object-center"
            : "h-12 sm:h-14 md:h-16 max-w-[min(100%,360px)] object-left"
        )}
        width={isAuth ? 480 : 360}
        height={isAuth ? 96 : 80}
        decoding="async"
      />
    </Link>
  );
}
