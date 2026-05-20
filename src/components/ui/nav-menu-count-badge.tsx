import { cn } from "@/lib/utils";

/** Inline count pill for sidebar nav links (not absolute — avoids overflow-hidden clipping). */
export function NavMenuCountBadge({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md px-1.5 text-xs font-semibold tabular-nums",
        className
      )}
    >
      {count}
    </span>
  );
}
