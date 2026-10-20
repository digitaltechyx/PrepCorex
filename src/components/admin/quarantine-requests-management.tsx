"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, query, where } from "firebase/firestore";
import { format } from "date-fns";
import { Check, Clock, Eye, Loader2, Plus, Search, ShieldAlert, X, XCircle } from "lucide-react";

import { db } from "@/lib/firebase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { QuarantineRequestDialog } from "@/components/inventory/quarantine-request-dialog";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import { useToast } from "@/hooks/use-toast";
import {
  QUARANTINE_REQUESTS,
  approveQuarantineRequest,
  openQuarantineProductIds,
  quarantineRequestKindLabel,
  rejectQuarantineRequest,
  requestSortMs,
} from "@/lib/quarantine-request-ops";
import {
  compareQueueSortKeys,
  isQuarantineRequestActionable,
  queueSortKey,
} from "@/lib/user-request-queue-sort";
import type { InventoryItem, QuarantineRequest, UserProfile } from "@/types";

const STATUS_CLASS: Record<QuarantineRequest["status"], string> = {
  pending: "bg-amber-100 text-amber-900 border-amber-200",
  approved: "bg-sky-100 text-sky-900 border-sky-200",
  completed: "bg-emerald-100 text-emerald-900 border-emerald-200",
  rejected: "bg-red-100 text-red-900 border-red-200",
  cancelled: "bg-slate-100 text-slate-700 border-slate-200",
};

function formatDate(date: QuarantineRequest["requestedAt"]) {
  if (!date) return "N/A";
  const ms = typeof date === "string" ? new Date(date).getTime() : (date.seconds ?? 0) * 1000;
  if (!ms || Number.isNaN(ms)) return "N/A";
  return format(new Date(ms), "PPP · p");
}

type Props = {
  selectedUser: UserProfile | null;
  inventory: InventoryItem[];
  initialRequestId?: string;
  defaultStatusFilter?: QuarantineRequest["status"] | "all";
  /** User Requests page: pin pending/approved to top until completed. */
  pinActionableToTop?: boolean;
};

export function QuarantineRequestsManagement({
  selectedUser,
  inventory,
  initialRequestId,
  defaultStatusFilter = "pending",
  pinActionableToTop = false,
}: Props) {
  const { toast } = useToast();
  const { userProfile: adminProfile } = useAuth();
  const [selectedRequest, setSelectedRequest] = useState<QuarantineRequest | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>(defaultStatusFilter);
  const [requestSearch, setRequestSearch] = useState("");
  const [rejectFeedback, setRejectFeedback] = useState("");
  const [behalfDialogOpen, setBehalfDialogOpen] = useState(false);

  const userId = selectedUser?.uid ?? "";
  const isValidUserId = Boolean(userId.trim());

  const requestsQuery = useMemo(
    () =>
      isValidUserId
        ? query(collection(db, QUARANTINE_REQUESTS), where("userId", "==", userId))
        : undefined,
    [isValidUserId, userId]
  );
  const { data: requests, loading } = useCollection<QuarantineRequest>(
    isValidUserId ? QUARANTINE_REQUESTS : "",
    requestsQuery
  );

  useEffect(() => {
    if (!initialRequestId) return;
    const match = requests.find((r) => r.id === initialRequestId);
    if (match) setSelectedRequest(match);
  }, [initialRequestId, requests]);

  const openIds = useMemo(() => openQuarantineProductIds(requests), [requests]);

  const filtered = useMemo(() => {
    const q = requestSearch.trim().toLowerCase();
    return [...requests]
      .filter((r) => (statusFilter === "all" ? true : r.status === statusFilter))
      .filter((r) => {
        if (!q) return true;
        return (
          r.productName.toLowerCase().includes(q) ||
          (r.reason || "").toLowerCase().includes(q) ||
          (r.sku || "").toLowerCase().includes(q) ||
          (r.requestedByName || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (!pinActionableToTop) {
          return requestSortMs(b) - requestSortMs(a);
        }
        const key = (req: QuarantineRequest) =>
          queueSortKey({
            actionable: isQuarantineRequestActionable(req),
            actionDate: req.approvedAt,
            requestDate: req.requestedAt,
          });
        return compareQueueSortKeys(key(a), key(b));
      });
  }, [requests, requestSearch, statusFilter, pinActionableToTop]);

  const pendingCount = requests.filter((r) => r.status === "pending").length;
  const approvedCount = requests.filter((r) => r.status === "approved").length;
  const completedCount = requests.filter((r) => r.status === "completed").length;

  const handleApprove = async (request: QuarantineRequest) => {
    if (!adminProfile) return;
    setIsProcessing(true);
    try {
      await approveQuarantineRequest({
        request,
        approverUid: adminProfile.uid,
        approverName: adminProfile.name || "Admin",
      });
      toast({
        title: "Request approved",
        description: `Warehouse ops can now move "${request.productName}" and mark it completed.`,
      });
      setSelectedRequest(null);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Approval failed",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async (request: QuarantineRequest) => {
    if (!adminProfile) return;
    setIsProcessing(true);
    try {
      await rejectQuarantineRequest({
        request,
        approverUid: adminProfile.uid,
        approverName: adminProfile.name || "Admin",
        adminFeedback: rejectFeedback,
      });
      toast({
        title: "Request rejected",
        description: `"${request.productName}" stays where it is.`,
      });
      setRejectFeedback("");
      setSelectedRequest(null);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Rejection failed",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isValidUserId) {
    return (
      <Card className="min-w-0">
        <CardContent className="p-3 pt-4 sm:p-6 sm:pt-6">
          <p className="text-sm text-muted-foreground">
            Select a user to view quarantine requests.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="min-w-0 overflow-hidden border-2 border-amber-200 shadow-lg">
        <CardHeader className="flex flex-col gap-3 border-b bg-gradient-to-r from-amber-50 to-yellow-50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <ShieldAlert className="h-5 w-5 shrink-0 text-amber-600" />
              Quarantine requests
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              Approve for the floor; warehouse completes when stock moves.
            </CardDescription>
          </div>
          <Button className="h-9 w-full shrink-0 sm:w-auto" onClick={() => setBehalfDialogOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Submit for user
          </Button>
        </CardHeader>
        <CardContent className="min-w-0 space-y-3 p-3 sm:space-y-4 sm:p-6">
          <div className="flex flex-wrap gap-1.5 sm:gap-2">
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-xs text-amber-900">
              <Clock className="mr-1 h-3 w-3" />
              {pendingCount} pending
            </Badge>
            <Badge variant="outline" className="border-sky-200 bg-sky-50 text-xs text-sky-900">
              <Check className="mr-1 h-3 w-3" />
              {approvedCount} awaiting floor
            </Badge>
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-xs text-emerald-900">
              <Check className="mr-1 h-3 w-3" />
              {completedCount} completed
            </Badge>
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-2 sm:flex sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={requestSearch}
                onChange={(e) => setRequestSearch(e.target.value)}
                placeholder="Search product, reason, or requester…"
                className="h-9 pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-full sm:w-[190px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Awaiting floor</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full sm:h-12" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed py-10 text-center sm:py-12">
              <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                {requests.length === 0
                  ? "No quarantine requests for this user yet."
                  : "No requests match your filters."}
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2 md:hidden">
                {filtered.map((request) => (
                  <div
                    key={request.id}
                    className="min-w-0 space-y-2 rounded-lg border border-amber-200 bg-amber-50/30 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm font-semibold">{request.productName}</p>
                        {request.sku ? (
                          <p className="truncate text-[11px] text-muted-foreground">
                            SKU {request.sku}
                          </p>
                        ) : null}
                      </div>
                      <Badge
                        variant="outline"
                        className={`shrink-0 text-[10px] capitalize ${STATUS_CLASS[request.status]}`}
                      >
                        {request.status}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{quarantineRequestKindLabel(request.kind)}</span>
                      <span className="tabular-nums">Qty {request.quantity}</span>
                    </div>
                    {request.reason ? (
                      <p className="break-words text-xs text-foreground">{request.reason}</p>
                    ) : null}
                    <p className="truncate text-[11px] text-muted-foreground">
                      {formatDate(request.requestedAt)} · {request.requestedByName || "—"}
                      {request.onBehalf ? " (on behalf)" : ""}
                    </p>
                    <Button
                      size="sm"
                      className="h-9 w-full"
                      variant={request.status === "pending" ? "default" : "outline"}
                      onClick={() => {
                        setRejectFeedback("");
                        setSelectedRequest(request);
                      }}
                    >
                      {request.status === "pending" ? (
                        "Process"
                      ) : (
                        <>
                          <Eye className="mr-1 h-3.5 w-3.5" />
                          View
                        </>
                      )}
                    </Button>
                  </div>
                ))}
              </div>
              <div className="hidden overflow-hidden rounded-lg border md:block">
                <Table containerClassName="overflow-x-auto mouse-h-scroll">
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Requested</TableHead>
                      <TableHead>By</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((request) => (
                      <TableRow key={request.id}>
                        <TableCell className="font-medium">
                          {request.productName}
                          {request.sku ? (
                            <span className="block text-[11px] font-normal text-muted-foreground">
                              SKU {request.sku}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-sm">
                          {quarantineRequestKindLabel(request.kind)}
                        </TableCell>
                        <TableCell>{request.quantity}</TableCell>
                        <TableCell className="max-w-[220px] truncate">{request.reason}</TableCell>
                        <TableCell>{formatDate(request.requestedAt)}</TableCell>
                        <TableCell>
                          <span className="text-sm">{request.requestedByName || "—"}</span>
                          {request.onBehalf ? (
                            <Badge variant="outline" className="ml-1 text-[10px]">
                              On behalf
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`text-[10px] capitalize ${STATUS_CLASS[request.status]}`}
                          >
                            {request.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant={request.status === "pending" ? "default" : "outline"}
                            onClick={() => {
                              setRejectFeedback("");
                              setSelectedRequest(request);
                            }}
                          >
                            {request.status === "pending" ? (
                              "Process"
                            ) : (
                              <>
                                <Eye className="mr-1 h-3.5 w-3.5" />
                                View
                              </>
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={!!selectedRequest}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRequest(null);
            setRejectFeedback("");
          }
        }}
      >
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-lg p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>Quarantine request</DialogTitle>
            <DialogDescription>
              {selectedRequest?.status === "pending"
                ? "Approve to release this to the warehouse floor, or reject to leave the stock as is."
                : "Review this quarantine request."}
            </DialogDescription>
          </DialogHeader>

          {selectedRequest ? (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1.5">
                <p>
                  <span className="text-muted-foreground">Product:</span>{" "}
                  <strong>{selectedRequest.productName}</strong>
                </p>
                <p>
                  <span className="text-muted-foreground">Action:</span>{" "}
                  {quarantineRequestKindLabel(selectedRequest.kind)}
                </p>
                <p>
                  <span className="text-muted-foreground">Quantity:</span>{" "}
                  {selectedRequest.quantity}
                  {Array.isArray(selectedRequest.lotAllocations) &&
                  selectedRequest.lotAllocations.length > 0 ? (
                    <span className="mt-1 block text-xs font-normal text-muted-foreground">
                      Lots:{" "}
                      {selectedRequest.lotAllocations
                        .map(
                          (row) =>
                            `${String(row.expiry || "").trim()} × ${Math.max(
                              0,
                              Math.floor(Number(row.quantity) || 0)
                            )}`
                        )
                        .join("; ")}
                    </span>
                  ) : null}
                </p>
                <p>
                  <span className="text-muted-foreground">Reason:</span> {selectedRequest.reason}
                </p>
                <p>
                  <span className="text-muted-foreground">Requested by:</span>{" "}
                  {selectedRequest.requestedByName || "—"}
                  {selectedRequest.onBehalf ? " (on behalf of client)" : ""}
                </p>
                <p>
                  <span className="text-muted-foreground">Requested:</span>{" "}
                  {formatDate(selectedRequest.requestedAt)}
                </p>
                <p>
                  <span className="text-muted-foreground">Current status:</span>{" "}
                  <Badge
                    variant="outline"
                    className={`text-[10px] capitalize ${STATUS_CLASS[selectedRequest.status]}`}
                  >
                    {selectedRequest.status}
                  </Badge>
                </p>
                {selectedRequest.adminFeedback ? (
                  <p>
                    <span className="text-muted-foreground">Admin feedback:</span>{" "}
                    {selectedRequest.adminFeedback}
                  </p>
                ) : null}
                {selectedRequest.status === "completed" ? (
                  <p>
                    <span className="text-muted-foreground">Completed:</span>{" "}
                    {selectedRequest.completedQty ?? selectedRequest.quantity} units by{" "}
                    {selectedRequest.completedByName || "warehouse"}
                    {selectedRequest.destBinPath || selectedRequest.destAreaCode
                      ? ` → ${selectedRequest.destBinPath || selectedRequest.destAreaCode}`
                      : ""}
                  </p>
                ) : null}
              </div>

              {selectedRequest.status === "pending" ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="quarantine-reject-feedback">
                      Rejection feedback (optional)
                    </Label>
                    <Textarea
                      id="quarantine-reject-feedback"
                      value={rejectFeedback}
                      onChange={(e) => setRejectFeedback(e.target.value)}
                      placeholder="Shown to the client if you reject…"
                      rows={2}
                    />
                  </div>
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button
                      variant="outline"
                      onClick={() => handleReject(selectedRequest)}
                      disabled={isProcessing}
                    >
                      {isProcessing ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <X className="mr-2 h-4 w-4" />
                      )}
                      Reject
                    </Button>
                    <Button onClick={() => handleApprove(selectedRequest)} disabled={isProcessing}>
                      {isProcessing ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="mr-2 h-4 w-4" />
                      )}
                      Approve
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {adminProfile && selectedUser ? (
        <QuarantineRequestDialog
          open={behalfDialogOpen}
          onOpenChange={setBehalfDialogOpen}
          userId={selectedUser.uid}
          userName={selectedUser.name || selectedUser.email || "Client"}
          inventory={inventory}
          submitterUid={adminProfile.uid}
          submitterName={adminProfile.name || "Admin"}
          onBehalf
          openProductIds={openIds}
        />
      ) : null}
    </>
  );
}
