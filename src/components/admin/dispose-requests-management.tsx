"use client";

import { useState, useMemo, useEffect } from "react";
import type { DisposeRequest, UserProfile, InventoryItem } from "@/types";
import { useCollection } from "@/hooks/use-collection";
import { useAuth } from "@/hooks/use-auth";
import { db } from "@/lib/firebase";
import { doc, updateDoc, collection, addDoc, runTransaction, Timestamp, serverTimestamp } from "firebase/firestore";
import { format } from "date-fns";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Check, X, Eye, Loader2, RotateCcw, Plus, Clock, CheckCircle, XCircle, FileStack } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

function formatDate(date: DisposeRequest["requestedAt"]) {
  if (!date) return "N/A";
  if (typeof date === "string") return format(new Date(date), "PPP");
  if (date && typeof date === "object" && "seconds" in date) return format(new Date(date.seconds * 1000), "PPP");
  return "N/A";
}

export function DisposeRequestsManagement({
  selectedUser,
  inventory,
  initialRequestId,
}: {
  selectedUser: UserProfile | null;
  inventory: InventoryItem[];
  initialRequestId?: string;
}) {
  const { toast } = useToast();
  const { user: authUser, userProfile: adminProfile } = useAuth();
  const [selectedRequest, setSelectedRequest] = useState<DisposeRequest | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [rejectFeedback, setRejectFeedback] = useState("");
  const [addDisposeDialogOpen, setAddDisposeDialogOpen] = useState(false);
  const [behalfProductId, setBehalfProductId] = useState("");
  const [behalfQuantity, setBehalfQuantity] = useState("");
  const [behalfReason, setBehalfReason] = useState("");
  const [behalfSubmitting, setBehalfSubmitting] = useState(false);

  const userId = selectedUser?.uid;
  const isValidUserId = userId && typeof userId === "string" && userId.trim() !== "";

  const { data: requests, loading } = useCollection<DisposeRequest>(
    isValidUserId ? `users/${userId}/disposeRequests` : ""
  );

  useEffect(() => {
    if (!initialRequestId || !requests?.length) return;
    const match = requests.find((r: DisposeRequest) => r.id === initialRequestId);
    if (match) setSelectedRequest(match);
  }, [initialRequestId, requests]);

  const pendingCount = requests.filter((r) => r.status === "pending").length;
  const approvedCount = requests.filter((r) => r.status === "approved").length;
  const rejectedCount = requests.filter((r) => r.status === "rejected").length;
  const totalCount = requests.length;

  const filteredRequests = useMemo(() => {
    let list = statusFilter === "all" ? requests : requests.filter((r) => r.status === statusFilter);
    return [...list].sort((a, b) => {
      const msA = a.requestedAt && typeof a.requestedAt === "object" && "seconds" in a.requestedAt ? a.requestedAt.seconds * 1000 : 0;
      const msB = b.requestedAt && typeof b.requestedAt === "object" && "seconds" in b.requestedAt ? b.requestedAt.seconds * 1000 : 0;
      return msB - msA;
    });
  }, [requests, statusFilter]);

  const closeDialog = () => {
    setSelectedRequest(null);
    setRejectFeedback("");
  };

  const handleApprove = async (request: DisposeRequest) => {
    if (!selectedUser || !adminProfile) return;
    if (!request.id) {
      toast({ variant: "destructive", title: "Error", description: "Request ID missing." });
      return;
    }
    const invItem = inventory.find((i) => i.id === request.productId);
    if (!invItem) {
      toast({ variant: "destructive", title: "Product not found", description: "This product may have been removed from inventory." });
      return;
    }
    if (request.quantity > invItem.quantity) {
      toast({ variant: "destructive", title: "Insufficient quantity", description: `Available: ${invItem.quantity}. Requested: ${request.quantity}.` });
      return;
    }
    setIsProcessing(true);
    setRejectFeedback("");
    try {
      const requestRef = doc(db, `users/${userId}/disposeRequests`, request.id);
      const recycledCol = collection(db, `users/${userId}/recycledInventory`);
      const inventoryRef = doc(db, `users/${userId}/inventory`, invItem.id);

      await runTransaction(db, async (tx) => {
        const now = Timestamp.now();
        const adminName = adminProfile.name || "Admin";
        const newRecycledRef = doc(recycledCol);

        if (request.quantity >= invItem.quantity) {
          tx.set(newRecycledRef, {
            ...invItem,
            recycledAt: now,
            recycledBy: adminName,
            remarks: request.reason || "",
          });
          tx.delete(inventoryRef);
        } else {
          const newQty = invItem.quantity - request.quantity;
          const newStatus = newQty > 0 ? "In Stock" : "Out of Stock";
          tx.update(inventoryRef, { quantity: newQty, status: newStatus });
          tx.set(newRecycledRef, {
            productName: invItem.productName,
            quantity: request.quantity,
            dateAdded: invItem.dateAdded,
            status: invItem.status,
            recycledAt: now,
            recycledBy: adminName,
            remarks: request.reason || "",
          });
        }
        tx.update(requestRef, {
          status: "approved",
          approvedBy: adminProfile.uid,
          approvedAt: now,
        });
      });

      const newQtyAfterDispose = request.quantity >= invItem.quantity ? 0 : invItem.quantity - request.quantity;
      const shopifyItem = invItem as InventoryItem & { source?: string; shop?: string; shopifyVariantId?: string; shopifyInventoryItemId?: string };
      if (shopifyItem.source === "shopify" && shopifyItem.shop && shopifyItem.shopifyVariantId && authUser && userId) {
        try {
          const token = await authUser.getIdToken();
          const res = await fetch("/api/shopify/sync-inventory", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              userId,
              shop: shopifyItem.shop,
              shopifyVariantId: shopifyItem.shopifyVariantId,
              shopifyInventoryItemId: shopifyItem.shopifyInventoryItemId,
              newQuantity: newQtyAfterDispose,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            toast({
              variant: "destructive",
              title: "Disposed in PrepCorex; Shopify did not update",
              description: typeof data.error === "string" ? data.error : "Add write_inventory scope and re-connect the store.",
            });
          }
        } catch (e) {
          toast({
            variant: "destructive",
            title: "Disposed in PrepCorex; Shopify did not update",
            description: e instanceof Error ? e.message : "Re-connect the store in Integrations.",
          });
        }
      }

      toast({ title: "Request approved", description: `${request.quantity} unit(s) of "${request.productName}" disposed.` });
      closeDialog();
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Failed to approve", description: err instanceof Error ? err.message : "Please try again." });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async (request: DisposeRequest) => {
    if (!selectedUser || !adminProfile) return;
    if (!request.id) {
      toast({ variant: "destructive", title: "Error", description: "Request ID missing." });
      return;
    }
    setIsProcessing(true);
    try {
      const requestRef = doc(db, `users/${userId}/disposeRequests`, request.id);
      const updateData: Record<string, unknown> = {
        status: "rejected",
        rejectedBy: adminProfile.uid,
        rejectedAt: Timestamp.now(),
      };
      if (rejectFeedback.trim()) updateData.adminFeedback = rejectFeedback.trim();
      await updateDoc(requestRef, updateData as Parameters<typeof updateDoc>[1]);
      toast({ title: "Request rejected", description: rejectFeedback.trim() ? "Feedback saved for the user." : "Request rejected." });
      closeDialog();
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Failed to reject", description: err instanceof Error ? err.message : "Please try again." });
    } finally {
      setIsProcessing(false);
    }
  };

  const inStockInventory = useMemo(() => inventory.filter((item) => item.quantity > 0), [inventory]);
  const behalfProduct = inStockInventory.find((p) => p.id === behalfProductId);
  const behalfMaxQty = behalfProduct?.quantity ?? 0;

  const handleSubmitDisposeOnBehalf = async () => {
    if (!userId || !behalfProduct) return;
    const qty = parseInt(behalfQuantity, 10);
    if (!Number.isFinite(qty) || qty < 1 || qty > behalfMaxQty) {
      toast({
        variant: "destructive",
        title: "Invalid quantity",
        description: `Enter a quantity between 1 and ${behalfMaxQty}.`,
      });
      return;
    }
    if (!behalfReason.trim()) {
      toast({
        variant: "destructive",
        title: "Reason required",
        description: "Please enter a reason for this dispose request.",
      });
      return;
    }
    setBehalfSubmitting(true);
    try {
      const ref = collection(db, `users/${userId}/disposeRequests`);
      await addDoc(ref, {
        productId: behalfProduct.id,
        productName: behalfProduct.productName,
        quantity: qty,
        reason: behalfReason.trim(),
        status: "pending",
        requestedAt: serverTimestamp(),
      });
      toast({
        title: "Dispose request created",
        description: `Request for ${qty} unit(s) of "${behalfProduct.productName}" has been added for ${selectedUser?.name || "user"}.`,
      });
      setAddDisposeDialogOpen(false);
      setBehalfProductId("");
      setBehalfQuantity("");
      setBehalfReason("");
    } catch (err: unknown) {
      toast({
        variant: "destructive",
        title: "Failed to create request",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setBehalfSubmitting(false);
    }
  };

  if (!isValidUserId) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Select a user to view dispose requests.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5" />
            Dispose Requests
          </CardTitle>
          <CardDescription>Approve to remove quantity from inventory (moved to disposed); reject with optional feedback.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Stat cards */}
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <Card
              role="button"
              tabIndex={0}
              onClick={() => setStatusFilter("pending")}
              onKeyDown={(e) => e.key === "Enter" && setStatusFilter("pending")}
              className="border-2 border-amber-200/50 bg-gradient-to-br from-amber-50 to-orange-100/50 shadow-md cursor-pointer transition-shadow hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2"
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-amber-900">Pending</CardTitle>
                <div className="h-10 w-10 rounded-full bg-amber-500 flex items-center justify-center shadow-md">
                  <Clock className="h-5 w-5 text-white" />
                </div>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-12" />
                ) : (
                  <>
                    <div className="text-2xl font-bold text-amber-900">{pendingCount}</div>
                    <p className="text-xs text-amber-700 mt-1">Awaiting review</p>
                  </>
                )}
              </CardContent>
            </Card>
            <Card
              role="button"
              tabIndex={0}
              onClick={() => setStatusFilter("approved")}
              onKeyDown={(e) => e.key === "Enter" && setStatusFilter("approved")}
              className="border-2 border-green-200/50 bg-gradient-to-br from-green-50 to-green-100/50 shadow-md cursor-pointer transition-shadow hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-green-400 focus:ring-offset-2"
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-green-900">Approved</CardTitle>
                <div className="h-10 w-10 rounded-full bg-green-500 flex items-center justify-center shadow-md">
                  <CheckCircle className="h-5 w-5 text-white" />
                </div>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-12" />
                ) : (
                  <>
                    <div className="text-2xl font-bold text-green-900">{approvedCount}</div>
                    <p className="text-xs text-green-700 mt-1">Disposed</p>
                  </>
                )}
              </CardContent>
            </Card>
            <Card
              role="button"
              tabIndex={0}
              onClick={() => setStatusFilter("rejected")}
              onKeyDown={(e) => e.key === "Enter" && setStatusFilter("rejected")}
              className="border-2 border-red-200/50 bg-gradient-to-br from-red-50 to-red-100/50 shadow-md cursor-pointer transition-shadow hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2"
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-red-900">Rejected</CardTitle>
                <div className="h-10 w-10 rounded-full bg-red-500 flex items-center justify-center shadow-md">
                  <XCircle className="h-5 w-5 text-white" />
                </div>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-12" />
                ) : (
                  <>
                    <div className="text-2xl font-bold text-red-900">{rejectedCount}</div>
                    <p className="text-xs text-red-700 mt-1">Not approved</p>
                  </>
                )}
              </CardContent>
            </Card>
            <Card
              role="button"
              tabIndex={0}
              onClick={() => setStatusFilter("all")}
              onKeyDown={(e) => e.key === "Enter" && setStatusFilter("all")}
              className="border-2 border-slate-200/50 bg-gradient-to-br from-slate-50 to-slate-100/50 shadow-md cursor-pointer transition-shadow hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-900">Total</CardTitle>
                <div className="h-10 w-10 rounded-full bg-slate-500 flex items-center justify-center shadow-md">
                  <FileStack className="h-5 w-5 text-white" />
                </div>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-8 w-12" />
                ) : (
                  <>
                    <div className="text-2xl font-bold text-slate-900">{totalCount}</div>
                    <p className="text-xs text-slate-700 mt-1">All requests</p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button size="sm" variant="outline" onClick={() => setAddDisposeDialogOpen(true)} className="shrink-0">
              <Plus className="h-4 w-4 mr-1" />
              Request dispose for user
            </Button>
          </div>

          {loading ? (
            <Skeleton className="h-40 w-full" />
          ) : filteredRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No dispose requests found.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Requested</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRequests.map((req) => (
                    <TableRow key={req.id}>
                      <TableCell className="font-medium">{req.productName}</TableCell>
                      <TableCell>{req.quantity}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={req.reason}>{req.reason}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{formatDate(req.requestedAt)}</TableCell>
                      <TableCell>
                        <Badge variant={req.status === "pending" ? "secondary" : req.status === "approved" ? "default" : "destructive"}>
                          {req.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {req.status === "pending" && (
                          <Button size="sm" variant="outline" onClick={() => setSelectedRequest(req)}>
                            <Eye className="h-4 w-4 mr-1" /> Process
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedRequest} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Process dispose request</DialogTitle>
            <DialogDescription>
              Approve to remove the quantity from inventory (moved to disposed). Reject with optional feedback for the user.
            </DialogDescription>
          </DialogHeader>
          {selectedRequest && (
            <div className="space-y-4 pt-2">
              <div className="rounded-lg border p-3 space-y-1 text-sm">
                <p><span className="font-medium">Product:</span> {selectedRequest.productName}</p>
                <p><span className="font-medium">Quantity:</span> {selectedRequest.quantity}</p>
                <p><span className="font-medium">Reason:</span> {selectedRequest.reason}</p>
                <p className="text-muted-foreground">Requested: {formatDate(selectedRequest.requestedAt)}</p>
              </div>
              <div className="space-y-2">
                <Label>Rejection feedback (optional)</Label>
                <Textarea
                  placeholder="Reason for rejection (shown to user)"
                  value={rejectFeedback}
                  onChange={(e) => setRejectFeedback(e.target.value)}
                  rows={2}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => handleReject(selectedRequest)}
                  disabled={isProcessing}
                >
                  {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4 mr-1" />}
                  Reject
                </Button>
                <Button onClick={() => handleApprove(selectedRequest)} disabled={isProcessing}>
                  {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
                  Approve & dispose
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={addDisposeDialogOpen} onOpenChange={setAddDisposeDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request dispose for {selectedUser?.name}</DialogTitle>
            <DialogDescription>
              Create a dispose request on behalf of this user. It will appear in their Disposed Inventory and in Notifications for processing.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Product</Label>
              <Select
                value={behalfProductId}
                onValueChange={(v) => {
                  setBehalfProductId(v);
                  setBehalfQuantity("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select product" />
                </SelectTrigger>
                <SelectContent>
                  {inStockInventory.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.productName} (qty: {p.quantity})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {inStockInventory.length === 0 && (
                <p className="text-xs text-muted-foreground">No in-stock products for this user.</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input
                type="number"
                min={1}
                max={behalfMaxQty}
                value={behalfQuantity}
                onChange={(e) => setBehalfQuantity(e.target.value)}
                placeholder={behalfMaxQty ? `1–${behalfMaxQty}` : "0"}
              />
              {behalfMaxQty > 0 && (
                <p className="text-xs text-muted-foreground">Max: {behalfMaxQty} units</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Reason</Label>
              <Textarea
                value={behalfReason}
                onChange={(e) => setBehalfReason(e.target.value)}
                placeholder="Why is this quantity being disposed?"
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setAddDisposeDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmitDisposeOnBehalf}
                disabled={!behalfProductId || !behalfQuantity || !behalfReason.trim() || behalfSubmitting || inStockInventory.length === 0}
              >
                {behalfSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Submit request
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
