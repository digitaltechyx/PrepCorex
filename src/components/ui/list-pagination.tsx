"use client";

import { Button } from "@/components/ui/button";

export const DEFAULT_LIST_PAGE_SIZE = 10;

export function paginateList<T>(items: T[], page: number, itemsPerPage = DEFAULT_LIST_PAGE_SIZE) {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (safePage - 1) * itemsPerPage;
  return {
    items: items.slice(startIndex, startIndex + itemsPerPage),
    totalPages,
    startIndex,
    totalItems,
    page: safePage,
  };
}

interface ListPaginationProps {
  page: number;
  totalItems: number;
  itemsPerPage?: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
}

export function ListPagination({
  page,
  totalItems,
  itemsPerPage = DEFAULT_LIST_PAGE_SIZE,
  onPageChange,
  itemLabel = "items",
}: ListPaginationProps) {
  if (totalItems <= itemsPerPage) return null;

  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  const startIndex = (page - 1) * itemsPerPage;

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t pt-3">
      <p className="text-sm text-muted-foreground">
        Showing {startIndex + 1} to {Math.min(startIndex + itemsPerPage, totalItems)} of {totalItems}{" "}
        {itemLabel}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page === 1}
        >
          Previous
        </Button>
        <span className="text-sm">
          Page {page} of {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
