"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  Check,
  Clock,
  Eye,
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
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
import { DeleteRequestDialog } from "@/components/inventory/delete-request-dialog";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import { useToast } from "@/hooks/use-toast";
import {
  approveDeleteRequest,
  deleteRequestsPath,
  pendingDeleteProductIds,
  rejectDeleteRequest,
} from "@/lib/delete-request-ops";
import type { DeleteRequest, InventoryItem, UserProfile } from "@/types";

function formatDate(date: DeleteRequest["requestedAt"]) {
  if (!date) return "N/A";
  if (typeof date === "string") return format(new Date(date), "PPP");
  if (typeof date === "object" && "seconds" in date) {
    return format(new Date(date.seconds * 1000), "PPP");
  }
  return "N/A";
}

function toMs(date: DeleteRequest["requestedAt"]): number {
  if (!date) return 0;
  if (typeof date === "string") {
    const ms = new Date(date).getTime();
    return Number.isNaN(ms) ? 0 : ms;
  }
  if (typeof date === "object" && typeof date.seconds === "number") return date.seconds * 1000;
  return 0;
}

const STATUS_CLASS: Record<DeleteRequest["status"], string> = {
  pending: "bg-amber-100 text-amber-900 border-amber-200",
  approved: "bg-emerald-100 text-emerald-900 border-emerald-200",
  rejected: "bg-red-100 text-red-900 border-red-200",
  cancelled: "bg-slate-100 text-slate-700 border-slate-200",
};

type Props = {
  selectedUser: UserProfile | null;
  inventory: InventoryItem[];
  initialRequestId?: string;
  /** Optional callback after an inventory item is deleted (for marketplace sync). */
  onInventoryDeleted?: (item: InventoryItem) => void | Promise<void>;
};

export function DeleteRequestsManagement({
  selectedUser,
  inventory,
  initialRequestId,
  onInventoryDeleted,
}: Props) {
  const { toast } = useToast();
  const { userProfile: adminProfile } = useAuth();
  const [selectedRequest, setSelectedRequest] = useState<DeleteRequest | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [requestSearch, setRequestSearch] = useState("");
  const [rejectFeedback, setRejectFeedback] = useState("");
  const [behalfDialogOpen, setBehalfDialogOpen] = useState(false);

  const userId = selectedUser?.uid;
  const isValidUserId = Boolean(userId && userId.trim());

  const { data: requests, loading } = useCollection<DeleteRequest>(
    isValidUserId ? deleteRequestsPath(userId!) : ""
  );

  useEffect(() => {
    if (!initialRequestId) return;
    const match = requests.find((r) => r.id === initialRequestId);
    if (match) setSelectedRequest(match);
  }, [initialRequestId, requests]);

  const pendingProductIds = useMemo(() => pendingDeleteProductIds(requests), [requests]);

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
      .sort((a, b) => toMs(b.requestedAt) - toMs(a.requestedAt));
  }, [requests, requestSearch, statusFilter]);

  const pendingCount = requests.filter((r) => r.status === "pending").length;
  const approvedCount = requests.filter((r) => r.status === "approved").length;
  const rejectedCount = requests.filter((r) => r.status === "rejected").length;

  const handleApprove = async (request: DeleteRequest) => {
    if (!userId || !adminProfile) return;
    setIsProcessing(true);
    try {
      const deletedItem = await approveDeleteRequest({
        userId,
        request,
        adminUid: adminProfile.uid,
        adminName: adminProfile.name || "Admin",
      });
      await onInventoryDeleted?.(deletedItem);
      toast({
        title: "Delete request approved",
        description: `"${deletedItem.productName}" was permanently deleted and logged.`,
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

  const handleReject = async (request: DeleteRequest) => {
    if (!userId || !adminProfile) return;
    setIsProcessing(true);
    try {
      await rejectDeleteRequest({
        userId,
        request,
        adminUid: adminProfile.uid,
        adminName: adminProfile.name || "Admin",
        adminFeedback: rejectFeedback,
      });
      toast({
        title: "Delete request rejected",
        description: `"${request.productName}" stays in inventory.`,
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
          <p className="text-sm text-muted-foreground">Select a user to view delete requests.</p>
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
              <Trash2 className="h-5 w-5 text-red-600" />
              Delete requests
            </CardTitle>
            <CardDescription>
              Approve to permanently remove an inventory entry and write a deleted-log row.
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
            <Badge variant="outline" className="bg-emerald-50 text-emerald-900 border-emerald-200">
              <Check className="mr-1 h-3 w-3" />
              {approvedCount} approved
            </Badge>
            <Badge variant="outline" className="bg-red-50 text-red-900 border-red-200">
              <XCircle className="mr-1 h-3 w-3" />
              {rejectedCount} rejected
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
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
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
              <Trash2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                {requests.length === 0
                  ? "No delete requests for this user yet."
                  : "No requests match your filters."}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <Table containerClassName="overflow-x-auto mouse-h-scroll">
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Product</TableHead>
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
                      <TableCell className="font-medium">{request.productName}</TableCell>
                      <TableCell>{request.quantity}</TableCell>
                      <TableCell className="max-w-[240px] truncate">{request.reason}</TableCell>
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
                            <>
                              Process
                            </>
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
            <DialogTitle>Delete request</DialogTitle>
            <DialogDescription>
              {selectedRequest?.status === "pending"
                ? "Approve to permanently delete the inventory entry, or reject to leave it in place."
                : "Review this delete request."}
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
                  <span className="text-muted-foreground">Quantity at request:</span>{" "}
                  {selectedRequest.quantity}
                </p>
                <p>
                  <span className="text-muted-foreground">Status at request:</span>{" "}
                  {selectedRequest.stockStatus}
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
              </div>

              {selectedRequest.status === "pending" ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="delete-reject-feedback">Rejection feedback (optional)</Label>
                    <Textarea
                      id="delete-reject-feedback"
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
                    <Button
                      variant="destructive"
                      onClick={() => handleApprove(selectedRequest)}
                      disabled={isProcessing}
                    >
                      {isProcessing ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="mr-2 h-4 w-4" />
                      )}
                      Approve & delete
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {adminProfile && selectedUser ? (
        <DeleteRequestDialog
          open={behalfDialogOpen}
          onOpenChange={setBehalfDialogOpen}
          userId={selectedUser.uid}
          inventory={inventory}
          submitterUid={adminProfile.uid}
          submitterName={adminProfile.name || "Admin"}
          onBehalf
          ownerName={selectedUser.name || undefined}
          pendingProductIds={pendingProductIds}
        />
      ) : null}
    </>
  );
}
