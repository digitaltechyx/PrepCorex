"use client";

import { useEffect, useRef, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type NavMenuTruncatedLabelProps = {
  label: string;
  className?: string;
};

export function NavMenuTruncatedLabel({ label, className }: NavMenuTruncatedLabelProps) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;

    const checkTruncation = () => {
      setIsTruncated(el.scrollWidth > el.clientWidth + 1);
    };

    checkTruncation();
    const raf = requestAnimationFrame(checkTruncation);
    const ro = new ResizeObserver(checkTruncation);
    ro.observe(el);
    const parent = el.parentElement;
    if (parent) ro.observe(parent);
    window.addEventListener("resize", checkTruncation);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", checkTruncation);
    };
  }, [label]);

  return (
    <Tooltip open={isTruncated ? undefined : false}>
      <TooltipTrigger asChild>
        <span
          ref={textRef}
          className={cn("min-w-0 flex-1 truncate block", className)}
        >
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className="max-w-xs text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
