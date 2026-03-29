import Link from "next/link";
import { cn } from "@/lib/utils";

/** Public URL for the PrepCorex wordmark SVG (spaces URL-encoded). */
export const brandLogoSrc = "/PCX%20Testing-16.svg";

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
          "h-auto w-full object-contain",
          isAuth
            ? "max-h-28 max-w-[min(100%,min(92vw,560px))] object-center sm:max-h-32 md:max-h-36"
            : "max-h-14 max-w-[min(100%,400px)] object-left sm:max-h-16"
        )}
        width={512}
        height={512}
        decoding="async"
      />
    </Link>
  );
}
