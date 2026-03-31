"use client";

import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import type { EditLog } from "@/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Edit, Search, X, Calendar, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";

export default function EditLogsPage() {
  const { userProfile } = useAuth();
  const [editLogsDateFilter, setEditLogsDateFilter] = useState<string>("all");
  const [editLogsFromDate, setEditLogsFromDate] = useState<Date | undefined>(undefined);
  const [editLogsToDate, setEditLogsToDate] = useState<Date | undefined>(undefined);
  const [editLogsSearch, setEditLogsSearch] = useState("");
  const [editLogsPage, setEditLogsPage] = useState(1);
  const itemsPerPage = 10;

  const { 
    data: editLogs, 
    loading: editLogsLoading 
  } = useCollection<EditLog>(
    userProfile ? `users/${userProfile.uid}/editLogs` : ""
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

  const filteredEditLogs = editLogs.filter((item) => {
    const matchesSearch = item.productName.toLowerCase().includes(editLogsSearch.toLowerCase()) ||
                          item.reason.toLowerCase().includes(editLogsSearch.toLowerCase()) ||
                          item.editedBy.toLowerCase().includes(editLogsSearch.toLowerCase()) ||
                          (item.previousProductName && item.previousProductName.toLowerCase().includes(editLogsSearch.toLowerCase()));
    const matchesDate = matchesDateFilter(item.editedAt, editLogsDateFilter);
    const matchesRange = matchesDatePickerFilter(item.editedAt, editLogsFromDate, editLogsToDate);
    return matchesSearch && matchesDate && matchesRange;
  });

  const totalEditLogsPages = Math.ceil(filteredEditLogs.length / itemsPerPage);
  const startEditLogsIndex = (editLogsPage - 1) * itemsPerPage;
  const endEditLogsIndex = startEditLogsIndex + itemsPerPage;
  const paginatedEditLogs = filteredEditLogs
    .sort((a, b) => {
      const dateA = typeof a.editedAt === 'string' ? new Date(a.editedAt) : new Date(a.editedAt?.seconds ? a.editedAt.seconds * 1000 : 0);
      const dateB = typeof b.editedAt === 'string' ? new Date(b.editedAt) : new Date(b.editedAt?.seconds ? b.editedAt.seconds * 1000 : 0);
      return dateB.getTime() - dateA.getTime();
    })
    .slice(startEditLogsIndex, endEditLogsIndex);
  const resetEditLogsPagination = () => setEditLogsPage(1);

  return (
    <div className="space-y-6">
      <Card className="border-2 shadow-xl overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-blue-500 to-cyan-600 text-white pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl font-bold text-white flex items-center gap-2">
                <Edit className="h-6 w-6" />
                Modification Logs
              </CardTitle>
              <CardDescription className="text-blue-100 mt-2">
                View products that were edited by admins ({filteredEditLogs.length} records)
              </CardDescription>
            </div>
            <div className="h-14 w-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <Edit className="h-7 w-7 text-white" />
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
                  value={editLogsSearch}
                  onChange={(e) => setEditLogsSearch(e.target.value)}
                  className="pl-10 h-11 shadow-sm"
                />
                {editLogsSearch && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-2 top-1/2 transform -translate-y-1/2 h-7 w-7 p-0"
                    onClick={() => setEditLogsSearch("")}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <Select value={editLogsDateFilter} onValueChange={(value) => {
                setEditLogsDateFilter(value);
                resetEditLogsPagination();
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
                fromDate={editLogsFromDate}
                toDate={editLogsToDate}
                setFromDate={(d) => {
                  setEditLogsFromDate(d);
                  resetEditLogsPagination();
                }}
                setToDate={(d) => {
                  setEditLogsToDate(d);
                  resetEditLogsPagination();
                }}
                className="w-full sm:w-[260px]"
              />
            </div>
          </div>

          {/* Content */}
          {editLogsLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-32 bg-muted animate-pulse rounded-xl" />
              ))}
            </div>
          ) : filteredEditLogs.length > 0 ? (
            <div className="space-y-2">
              {paginatedEditLogs.map((item) => (
                <div 
                  key={item.id}
                  className="rounded-lg border border-blue-200 bg-blue-50/40 px-3 py-3 sm:px-4"
                >
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
                      <span className="font-semibold text-slate-900">{item.productName}</span>
                      {item.previousProductName && item.previousProductName !== item.productName && (
                        <Badge variant="outline" className="text-[10px]">Renamed</Badge>
                      )}
                      <span className="text-slate-600">Qty:</span>
                      <span>{item.previousQuantity}</span>
                      <ArrowRight className="h-3 w-3 text-blue-500" />
                      <span className="font-semibold text-blue-700">{item.newQuantity}</span>
                      <span className="text-slate-600 ml-2">Status:</span>
                      <Badge variant="outline" className="text-[10px]">{item.previousStatus}</Badge>
                      <ArrowRight className="h-3 w-3 text-blue-500" />
                      <Badge className="bg-blue-500 text-white text-[10px]">{item.newStatus}</Badge>
                    </div>
                    {item.previousProductName && item.previousProductName !== item.productName && (
                      <div className="text-xs text-slate-600">
                        Name: <span className="line-through">{item.previousProductName}</span> <ArrowRight className="inline h-3 w-3 text-blue-500" /> <span className="font-semibold text-blue-700">{item.productName}</span>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                      <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" /> Edited: <span className="font-semibold text-blue-700">{formatDate(item.editedAt)}</span></span>
                      <span>By: <span className="font-medium text-slate-800">{item.editedBy}</span></span>
                    </div>
                    <div className="text-xs text-blue-800 truncate">
                      <span className="font-semibold text-blue-700">Reason:</span> {item.reason}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-16">
              <div className="mx-auto h-20 w-20 rounded-full bg-blue-100 flex items-center justify-center mb-4">
                <Edit className="h-10 w-10 text-blue-600" />
              </div>
              <h3 className="text-xl font-bold mb-2">No product edits</h3>
              <p className="text-muted-foreground">
                {editLogs.length === 0 ? "No products have been edited yet." : "No edits match your filters."}
              </p>
            </div>
          )}
          
          {/* Pagination */}
          {filteredEditLogs.length > itemsPerPage && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 pt-6 border-t">
              <div className="text-sm text-muted-foreground">
                Showing {startEditLogsIndex + 1} to {Math.min(endEditLogsIndex, filteredEditLogs.length)} of {filteredEditLogs.length} records
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditLogsPage(p => Math.max(1, p - 1))}
                  disabled={editLogsPage === 1}
                  className="shadow-sm"
                >
                  Previous
                </Button>
                <span className="text-sm font-medium px-3">
                  Page {editLogsPage} of {totalEditLogsPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditLogsPage(p => Math.min(totalEditLogsPages, p + 1))}
                  disabled={editLogsPage === totalEditLogsPages}
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
