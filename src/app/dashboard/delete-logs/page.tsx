"use client";

import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import type { DeleteLog } from "@/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Trash2, Search, X, Calendar, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";

export default function DeleteLogsPage() {
  const { userProfile } = useAuth();
  const [deleteLogsDateFilter, setDeleteLogsDateFilter] = useState<string>("all");
  const [deleteLogsFromDate, setDeleteLogsFromDate] = useState<Date | undefined>(undefined);
  const [deleteLogsToDate, setDeleteLogsToDate] = useState<Date | undefined>(undefined);
  const [deleteLogsSearch, setDeleteLogsSearch] = useState("");
  const [deleteLogsPage, setDeleteLogsPage] = useState(1);
  const itemsPerPage = 10;

  const { 
    data: deleteLogs, 
    loading: deleteLogsLoading 
  } = useCollection<DeleteLog>(
    userProfile ? `users/${userProfile.uid}/deleteLogs` : ""
  );

  const formatDate = (date: any) => {
    if (!date) return "N/A";
    if (typeof date === 'string') return format(new Date(date), "MMM dd, yyyy");
    if (date.seconds) return format(new Date(date.seconds * 1000), "MMM dd, yyyy");
    return "N/A";
  };

  const matchesDateFilter = (date: any, filter: string) => {
    if (filter === "all") return true;
    
    let itemDate: Date;
    if (typeof date === 'string') {
      itemDate = new Date(date);
    } else if (date && typeof date === 'object' && date.seconds) {
      itemDate = new Date(date.seconds * 1000);
    } else {
      return false;
    }
    
    const now = new Date();
    const daysDiff = Math.floor((now.getTime() - itemDate.getTime()) / (1000 * 60 * 60 * 24));
    
    switch (filter) {
      case "today":
        return daysDiff === 0;
      case "week":
        return daysDiff <= 7;
      case "month":
        return daysDiff <= 30;
      case "year":
        return daysDiff <= 365;
      default:
        return true;
    }
  };

  const matchesDatePickerFilter = (date: any, from?: Date, to?: Date) => {
    if (!from && !to) return true;
    let itemDate: Date | null = null;
    if (typeof date === "string") itemDate = new Date(date);
    else if (date && typeof date === "object" && date.seconds) itemDate = new Date(date.seconds * 1000);
    if (!itemDate || Number.isNaN(itemDate.getTime())) return false;
    const itemMs = itemDate.getTime();
    const fromMs = from ? new Date(from.getFullYear(), from.getMonth(), from.getDate(), 0, 0, 0, 0).getTime() : null;
    const toMs = to ? new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1, 0, 0, 0, 0).getTime() - 1 : null;
    if (fromMs !== null && itemMs < fromMs) return false;
    if (toMs !== null && itemMs > toMs) return false;
    return true;
  };

  const filteredDeleteLogs = deleteLogs.filter((item) => {
    const matchesSearch = item.productName.toLowerCase().includes(deleteLogsSearch.toLowerCase()) ||
                          item.reason.toLowerCase().includes(deleteLogsSearch.toLowerCase()) ||
                          item.deletedBy.toLowerCase().includes(deleteLogsSearch.toLowerCase());
    const matchesDate = matchesDateFilter(item.deletedAt, deleteLogsDateFilter);
    const matchesRange = matchesDatePickerFilter(item.deletedAt, deleteLogsFromDate, deleteLogsToDate);
    return matchesSearch && matchesDate && matchesRange;
  });

  const totalDeleteLogsPages = Math.ceil(filteredDeleteLogs.length / itemsPerPage);
  const startDeleteLogsIndex = (deleteLogsPage - 1) * itemsPerPage;
  const endDeleteLogsIndex = startDeleteLogsIndex + itemsPerPage;
  const paginatedDeleteLogs = filteredDeleteLogs
    .sort((a, b) => {
      const dateA = typeof a.deletedAt === 'string' ? new Date(a.deletedAt) : new Date(a.deletedAt?.seconds ? a.deletedAt.seconds * 1000 : 0);
      const dateB = typeof b.deletedAt === 'string' ? new Date(b.deletedAt) : new Date(b.deletedAt?.seconds ? b.deletedAt.seconds * 1000 : 0);
      return dateB.getTime() - dateA.getTime();
    })
    .slice(startDeleteLogsIndex, endDeleteLogsIndex);
  const resetDeleteLogsPagination = () => setDeleteLogsPage(1);

  return (
    <div className="space-y-6">
      <Card className="border-2 shadow-xl overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-red-500 to-rose-600 text-white pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl font-bold text-white flex items-center gap-2">
                <Trash2 className="h-6 w-6" />
                Deleted Logs
              </CardTitle>
              <CardDescription className="text-red-100 mt-2">
                View products that were permanently deleted by admins ({filteredDeleteLogs.length} records)
              </CardDescription>
            </div>
            <div className="h-14 w-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <AlertCircle className="h-7 w-7 text-white" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-4 mb-6 pb-6 border-b">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by product name, reason, or admin..."
                  value={deleteLogsSearch}
                  onChange={(e) => setDeleteLogsSearch(e.target.value)}
                  className="pl-10 h-11 shadow-sm"
                />
                {deleteLogsSearch && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-2 top-1/2 transform -translate-y-1/2 h-7 w-7 p-0"
                    onClick={() => setDeleteLogsSearch("")}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <Select value={deleteLogsDateFilter} onValueChange={(value) => {
                setDeleteLogsDateFilter(value);
                resetDeleteLogsPagination();
              }}>
                <SelectTrigger className="w-full sm:w-[200px] h-11 shadow-sm">
                  <SelectValue placeholder="Filter by date" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Time</SelectItem>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="week">This Week</SelectItem>
                  <SelectItem value="month">This Month</SelectItem>
                  <SelectItem value="year">This Year</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-full sm:w-auto">
              <DateRangePicker
                fromDate={deleteLogsFromDate}
                toDate={deleteLogsToDate}
                setFromDate={(d) => {
                  setDeleteLogsFromDate(d);
                  resetDeleteLogsPagination();
                }}
                setToDate={(d) => {
                  setDeleteLogsToDate(d);
                  resetDeleteLogsPagination();
                }}
                className="w-full sm:w-[260px]"
              />
            </div>
          </div>

          {/* Content */}
          {deleteLogsLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-32 bg-muted animate-pulse rounded-xl" />
              ))}
            </div>
          ) : filteredDeleteLogs.length > 0 ? (
            <div className="space-y-2">
              {paginatedDeleteLogs.map((item) => (
                <div 
                  key={item.id}
                  className="rounded-lg border border-red-200 bg-red-50/40 px-3 py-2 sm:px-4"
                >
                  <div className="flex items-center gap-2 sm:gap-3 min-w-0 text-xs sm:text-sm">
                    <span className="font-semibold text-slate-900 truncate shrink-0 max-w-[180px] sm:max-w-[230px] lg:max-w-[280px]">
                      {item.productName}
                    </span>
                    <Badge className="bg-red-500 text-white text-[10px] shrink-0">-{item.quantity}</Badge>
                    <Badge variant={item.status === "In Stock" ? "default" : "destructive"} className="text-[10px] shrink-0">
                      {item.status}
                    </Badge>
                    <span className="text-slate-600 shrink-0">Added: {formatDate(item.dateAdded)}</span>
                    <span className="text-red-700 font-semibold shrink-0">Deleted: {formatDate(item.deletedAt)}</span>
                    <span className="text-slate-600 shrink-0">By: {item.deletedBy}</span>
                    <span className="text-red-800 truncate min-w-0 flex-1">
                      Reason: {item.reason}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-16">
              <div className="mx-auto h-20 w-20 rounded-full bg-red-100 flex items-center justify-center mb-4">
                <Trash2 className="h-10 w-10 text-red-600" />
              </div>
              <h3 className="text-xl font-bold mb-2">No deleted products</h3>
              <p className="text-muted-foreground">
                {deleteLogs.length === 0 ? "No products have been permanently deleted yet." : "No deletions match your filters."}
              </p>
            </div>
          )}
          
          {/* Pagination */}
          {filteredDeleteLogs.length > itemsPerPage && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 pt-6 border-t">
              <div className="text-sm text-muted-foreground">
                Showing {startDeleteLogsIndex + 1} to {Math.min(endDeleteLogsIndex, filteredDeleteLogs.length)} of {filteredDeleteLogs.length} records
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteLogsPage(p => Math.max(1, p - 1))}
                  disabled={deleteLogsPage === 1}
                  className="shadow-sm"
                >
                  Previous
                </Button>
                <span className="text-sm font-medium px-3">
                  Page {deleteLogsPage} of {totalDeleteLogsPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteLogsPage(p => Math.min(totalDeleteLogsPages, p + 1))}
                  disabled={deleteLogsPage === totalDeleteLogsPages}
                  className="shadow-sm"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
