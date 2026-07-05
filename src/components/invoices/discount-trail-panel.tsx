"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Search, X, Percent, Tag } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DiscountTrailEntry } from "@/types";
import {
  formatDiscountTrailLabel,
  sumDiscountTrailAmount,
  trailEntryMs,
} from "@/lib/discount-trail";

type Props = {
  entries: DiscountTrailEntry[];
  loading?: boolean;
  /** Show client name column (admin view). */
  showUserColumn?: boolean;
  /** Optional user filter (admin). */
  userFilter?: string;
  userFilterOptions?: Array<{ id: string; label: string }>;
  onUserFilterChange?: (userId: string) => void;
};

const ITEMS_PER_PAGE = 12;

function formatTrailDate(entry: DiscountTrailEntry): string {
  const ms = trailEntryMs(entry);
  if (!ms) return "—";
  return format(new Date(ms), "MMM d, yyyy");
}

export function DiscountTrailPanel({
  entries,
  loading = false,
  showUserColumn = false,
  userFilter = "all",
  userFilterOptions = [],
  onUserFilterChange,
}: Props) {
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "amount" | "percent">("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (userFilter !== "all" && e.userId !== userFilter) return false;

      const q = searchTerm.trim().toLowerCase();
      if (q) {
        const hay = `${e.invoiceNumber} ${e.userName || ""} ${e.appliedByName || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      if (typeFilter !== "all" && e.discountType !== typeFilter) return false;

      const ms = trailEntryMs(e);
      if (startDate || endDate) {
        const d = ms ? new Date(ms) : null;
        if (!d) return false;
        if (startDate && d < new Date(startDate)) return false;
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          if (d > end) return false;
        }
      }

      if (dateFilter !== "all" && ms) {
        const days = Math.floor((Date.now() - ms) / (1000 * 60 * 60 * 24));
        if (dateFilter === "today" && days !== 0) return false;
        if (dateFilter === "week" && days > 7) return false;
        if (dateFilter === "month" && days > 30) return false;
        if (dateFilter === "year" && days > 365) return false;
      }

      return true;
    });
  }, [entries, userFilter, searchTerm, typeFilter, startDate, endDate, dateFilter]);

  const totalDiscountAll = useMemo(() => sumDiscountTrailAmount(entries), [entries]);
  const totalDiscountFiltered = useMemo(() => sumDiscountTrailAmount(filtered), [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const paginated = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, dateFilter, typeFilter, startDate, endDate, userFilter]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50/80 to-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-emerald-900">
              Total discounts (all time)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-emerald-900 tabular-nums">
              ${totalDiscountAll.toFixed(2)}
            </p>
            <p className="text-xs text-emerald-700 mt-1">{entries.length} discount record(s)</p>
          </CardContent>
        </Card>
        <Card className="border-violet-200 bg-gradient-to-br from-violet-50/80 to-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-violet-900">
              Filtered total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-violet-900 tabular-nums">
              ${totalDiscountFiltered.toFixed(2)}
            </p>
            <p className="text-xs text-violet-700 mt-1">{filtered.length} matching record(s)</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Tag className="h-4 w-4" />
            Discount trail
          </CardTitle>
          <CardDescription>
            Every discount applied by admin, with date and amount saved.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col lg:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search invoice # or name…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            {showUserColumn && userFilterOptions.length > 0 && onUserFilterChange && (
              <Select value={userFilter} onValueChange={onUserFilterChange}>
                <SelectTrigger className="lg:w-52">
                  <SelectValue placeholder="All clients" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All clients</SelectItem>
                  {userFilterOptions.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}>
              <SelectTrigger className="lg:w-40">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="amount">Fixed amount</SelectItem>
                <SelectItem value="percent">Percentage</SelectItem>
              </SelectContent>
            </Select>
            <Select value={dateFilter} onValueChange={setDateFilter}>
              <SelectTrigger className="lg:w-40">
                <SelectValue placeholder="Period" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All time</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="week">This week</SelectItem>
                <SelectItem value="month">This month</SelectItem>
                <SelectItem value="year">This year</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          {(startDate || endDate || searchTerm) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setStartDate("");
                setEndDate("");
                setSearchTerm("");
                setDateFilter("all");
                setTypeFilter("all");
              }}
            >
              <X className="h-4 w-4 mr-1" />
              Clear filters
            </Button>
          )}

          {loading ? (
            <div className="space-y-2 py-8">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-10 text-center">
              No discounts found for the current filters.
            </p>
          ) : (
            <>
              <div className="rounded-lg border overflow-hidden">
                <Table containerClassName="overflow-x-auto">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      {showUserColumn && <TableHead>Client</TableHead>}
                      <TableHead>Invoice</TableHead>
                      <TableHead>Discount</TableHead>
                      <TableHead className="text-right">Amount saved</TableHead>
                      <TableHead>Applied by</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginated.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-nowrap">{formatTrailDate(e)}</TableCell>
                        {showUserColumn && (
                          <TableCell className="max-w-[140px] truncate">
                            {e.userName || e.userId || "—"}
                          </TableCell>
                        )}
                        <TableCell className="font-medium">{e.invoiceNumber}</TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1 text-sm">
                            {e.discountType === "percent" ? (
                              <Percent className="h-3.5 w-3.5 text-muted-foreground" />
                            ) : null}
                            {formatDiscountTrailLabel(e.discountType, e.discountValue)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-semibold text-emerald-700 tabular-nums">
                          -${Number(e.discountAmount || 0).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {e.appliedByName || "Admin"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize text-xs">
                            {e.invoiceStatus || "—"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <p className="text-xs text-muted-foreground">
                    Page {page} of {totalPages}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
