"use client";

import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import type { DeleteLog, DeleteRequest, InventoryItem } from "@/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DeleteRequestDialog } from "@/components/inventory/delete-request-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  cancelDeleteRequest,
  deleteRequestsPath,
  pendingDeleteProductIds,
} from "@/lib/delete-request-ops";
import { Trash2, Search, X, Calendar, AlertCircle, Loader2, Plus } from "lucide-react";
import { format } from "date-fns";
import { useMemo, useState } from "react";

function toRequestMs(value: DeleteRequest["requestedAt"]): number {
  if (!value) return 0;
  if (typeof value === "string") {
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? 0 : ms;
  }
  if (typeof value === "object" && typeof value.seconds === "number") return value.seconds * 1000;
  return 0;
}

const REQUEST_STATUS_CLASS: Record<DeleteRequest["status"], string> = {
  pending: "bg-amber-100 text-amber-900 border-amber-200",
  approved: "bg-emerald-100 text-emerald-900 border-emerald-200",
  rejected: "bg-red-100 text-red-900 border-red-200",
  cancelled: "bg-slate-100 text-slate-700 border-slate-200",
};

export default function DeleteLogsPage() {
  const { userProfile } = useAuth();
  const { toast } = useToast();
  const [deleteLogsDateFilter, setDeleteLogsDateFilter] = useState<string>("all");
  const [deleteLogsFromDate, setDeleteLogsFromDate] = useState<Date | undefined>(undefined);
  const [deleteLogsToDate, setDeleteLogsToDate] = useState<Date | undefined>(undefined);
  const [deleteLogsSearch, setDeleteLogsSearch] = useState("");
  const [deleteLogsPage, setDeleteLogsPage] = useState(1);
  const itemsPerPage = 10;

  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const { 
    data: deleteLogs, 
    loading: deleteLogsLoading 
  } = useCollection<DeleteLog>(
    userProfile ? `users/${userProfile.uid}/deleteLogs` : ""
  );

  const { data: inventory } = useCollection<InventoryItem>(
    userProfile ? `users/${userProfile.uid}/inventory` : ""
  );

  const { data: deleteRequests, loading: deleteRequestsLoading } = useCollection<DeleteRequest>(
    userProfile ? deleteRequestsPath(userProfile.uid) : ""
  );

  const sortedRequests = useMemo(
    () =>
      [...deleteRequests].sort(
        (a, b) => toRequestMs(b.requestedAt) - toRequestMs(a.requestedAt)
      ),
    [deleteRequests]
  );
  const pendingRequestCount = sortedRequests.filter((r) => r.status === "pending").length;
  const pendingProductIds = useMemo(
    () => pendingDeleteProductIds(deleteRequests),
    [deleteRequests]
  );

  const handleCancelRequest = async (request: DeleteRequest) => {
    if (!userProfile) return;
    setCancellingId(request.id);
    try {
      await cancelDeleteRequest({ userId: userProfile.uid, requestId: request.id });
      toast({
        title: "Request withdrawn",
        description: `Your delete request for "${request.productName}" was cancelled.`,
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not cancel request",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setCancellingId(null);
    }
  };

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
            <div className="flex items-center gap-3">
              <Button
                variant="secondary"
                className="bg-white/20 text-white border border-white/30 hover:bg-white/30"
                onClick={() => setRequestDialogOpen(true)}
              >
                <Plus className="h-4 w-4 mr-1" />
                Request deletion
              </Button>
              <div className="h-14 w-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                <AlertCircle className="h-7 w-7 text-white" />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <Tabs defaultValue="logs" className="w-full">
            <TabsList className="mb-6">
              <TabsTrigger value="logs">Deleted logs ({deleteLogs.length})</TabsTrigger>
              <TabsTrigger value="requests">
                My requests ({sortedRequests.length})
                {pendingRequestCount > 0 ? (
                  <Badge className="ml-2 bg-amber-500 text-white text-[10px]">
                    {pendingRequestCount} pending
                  </Badge>
                ) : null}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="logs" className="mt-0">
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
            <div className="rounded-lg border border-red-200 bg-red-50/30 overflow-hidden">
              <Table containerClassName="overflow-x-auto mouse-h-scroll">
                <TableHeader className="bg-red-100/70">
                  <TableRow>
                    <TableHead className="min-w-[240px]">Product</TableHead>
                    <TableHead className="min-w-[110px]">Quantity</TableHead>
                    <TableHead className="min-w-[120px]">Status</TableHead>
                    <TableHead className="min-w-[150px]">Added</TableHead>
                    <TableHead className="min-w-[150px]">Deleted</TableHead>
                    <TableHead className="min-w-[170px]">Deleted By</TableHead>
                    <TableHead className="min-w-[260px]">Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedDeleteLogs.map((item) => (
                    <TableRow key={item.id} className="bg-white/70">
                      <TableCell className="font-semibold text-slate-900">{item.productName}</TableCell>
                      <TableCell>
                        <Badge className="bg-red-500 text-white text-[10px]">-{item.quantity}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={item.status === "In Stock" ? "default" : "destructive"} className="text-[10px]">
                          {item.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-700">{formatDate(item.dateAdded)}</TableCell>
                      <TableCell className="font-semibold text-red-700">{formatDate(item.deletedAt)}</TableCell>
                      <TableCell className="text-slate-700">{item.deletedBy}</TableCell>
                      <TableCell className="text-red-800">{item.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
            </TabsContent>

            <TabsContent value="requests" className="mt-0">
              {deleteRequestsLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-20 bg-muted animate-pulse rounded-xl" />
                  ))}
                </div>
              ) : sortedRequests.length > 0 ? (
                <div className="rounded-lg border overflow-hidden">
                  <Table containerClassName="overflow-x-auto mouse-h-scroll">
                    <TableHeader className="bg-muted/60">
                      <TableRow>
                        <TableHead className="min-w-[220px]">Product</TableHead>
                        <TableHead className="min-w-[100px]">Quantity</TableHead>
                        <TableHead className="min-w-[240px]">Reason</TableHead>
                        <TableHead className="min-w-[150px]">Requested</TableHead>
                        <TableHead className="min-w-[130px]">Status</TableHead>
                        <TableHead className="min-w-[220px]">Admin response</TableHead>
                        <TableHead className="min-w-[120px] text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedRequests.map((request) => (
                        <TableRow key={request.id}>
                          <TableCell className="font-semibold text-slate-900">
                            {request.productName}
                            {request.onBehalf ? (
                              <span className="block text-[11px] font-normal text-muted-foreground">
                                Filed by {request.requestedByName || "admin"} on your behalf
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell>{request.quantity}</TableCell>
                          <TableCell className="text-slate-700">{request.reason}</TableCell>
                          <TableCell className="text-slate-700">
                            {formatDate(request.requestedAt)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={`text-[10px] capitalize ${REQUEST_STATUS_CLASS[request.status]}`}
                            >
                              {request.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-slate-700">
                            {request.adminFeedback || "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {request.status === "pending" ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleCancelRequest(request)}
                                disabled={cancellingId === request.id}
                              >
                                {cancellingId === request.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  "Withdraw"
                                )}
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-16">
                  <div className="mx-auto h-20 w-20 rounded-full bg-red-100 flex items-center justify-center mb-4">
                    <Trash2 className="h-10 w-10 text-red-600" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">No delete requests yet</h3>
                  <p className="text-muted-foreground mb-4">
                    Request a deletion and an admin will review it before anything is removed.
                  </p>
                  <Button onClick={() => setRequestDialogOpen(true)}>
                    <Plus className="h-4 w-4 mr-1" />
                    Request deletion
                  </Button>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {userProfile ? (
        <DeleteRequestDialog
          open={requestDialogOpen}
          onOpenChange={setRequestDialogOpen}
          userId={userProfile.uid}
          inventory={inventory}
          submitterUid={userProfile.uid}
          submitterName={userProfile.name || "User"}
          pendingProductIds={pendingProductIds}
        />
      ) : null}
    </div>
  );
}
