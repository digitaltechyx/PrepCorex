"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

export const LIST_PAGE_SIZE = 10;

export function PagedRows<T>({
  items,
  children,
}: {
  items: T[];
  children: (pageItems: T[]) => ReactNode;
}) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / LIST_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * LIST_PAGE_SIZE;
  const slice = items.slice(start, start + LIST_PAGE_SIZE);
  const resetKey = `${items.length}:${startKey(items[0])}`;

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  return (
    <>
      {children(slice)}
      {items.length > LIST_PAGE_SIZE ? (
        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-xs text-muted-foreground tabular-nums">
            {start + 1}–{start + slice.length} of {items.length}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={safePage <= 1}
              onClick={() => setPage(safePage - 1)}
            >
              Previous
            </Button>
            <span className="text-xs tabular-nums text-muted-foreground">
              {safePage} / {totalPages}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={safePage >= totalPages}
              onClick={() => setPage(safePage + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function startKey(item: unknown): string {
  if (Array.isArray(item)) return String(item[0] ?? "");
  if (item && typeof item === "object" && "id" in item) return String((item as { id?: string }).id ?? "");
  if (item && typeof item === "object" && "trackingNumber" in item) {
    return String((item as { trackingNumber?: string }).trackingNumber ?? "");
  }
  return "";
}
