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
};

export function QuarantineRequestsManagement({
  selectedUser,
  inventory,
  initialRequestId,
  defaultStatusFilter = "pending",
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
      .sort((a, b) => requestSortMs(b) - requestSortMs(a));
  }, [requests, requestSearch, statusFilter]);

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
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            Select a user to view quarantine requests.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-600" />
              Quarantine requests
            </CardTitle>
            <CardDescription>
              Approving clears the request for the floor. Warehouse ops picks the stock and marks it
              completed — that is when quantities actually move.
            </CardDescription>
          </div>
          <Button onClick={() => setBehalfDialogOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Submit for user
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="bg-amber-50 text-amber-900 border-amber-200">
              <Clock className="mr-1 h-3 w-3" />
              {pendingCount} pending
            </Badge>
            <Badge variant="outline" className="bg-sky-50 text-sky-900 border-sky-200">
              <Check className="mr-1 h-3 w-3" />
              {approvedCount} awaiting floor
            </Badge>
            <Badge variant="outline" className="bg-emerald-50 text-emerald-900 border-emerald-200">
              <Check className="mr-1 h-3 w-3" />
              {completedCount} completed
            </Badge>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={requestSearch}
                onChange={(e) => setRequestSearch(e.target.value)}
                placeholder="Search product, reason, or requester…"
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[190px]">
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
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed py-12 text-center">
              <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                {requests.length === 0
                  ? "No quarantine requests for this user yet."
                  : "No requests match your filters."}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
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
        <DialogContent className="sm:max-w-lg">
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
