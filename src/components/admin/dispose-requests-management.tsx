"use client";

import { useState, useMemo, useEffect } from "react";
import type { DisposeBatch, DisposeBatchLine, DisposeRequest, UserProfile, InventoryItem } from "@/types";
import { useCollection } from "@/hooks/use-collection";
import { useAuth } from "@/hooks/use-auth";
import { db } from "@/lib/firebase";
import {
  approveDisposeBatchLine,
  batchLineToDisposeRequest,
  disposeBatchLinesPath,
  disposeBatchesPath,
  refreshDisposeBatchCounts,
  rejectDisposeBatchLine,
} from "@/lib/dispose-batch";
import {
  compareQueueSortKeys,
  isDisposeBatchActionable,
  isDisposeRequestActionable,
  queueSortKey,
} from "@/lib/user-request-queue-sort";
import { DisposeBatchAdminDialog } from "@/components/admin/dispose-batch-admin-dialog";
import { doc, updateDoc, collection, addDoc, runTransaction, Timestamp, serverTimestamp, getDocs } from "firebase/firestore";
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
import { Check, X, Eye, Loader2, RotateCcw, Plus, Clock, CheckCircle, XCircle, FileStack, Search } from "lucide-react";
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
  const [selectedBatch, setSelectedBatch] = useState<DisposeBatch | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [requestSearch, setRequestSearch] = useState("");
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
  const { data: disposeBatches, loading: batchesLoading } = useCollection<DisposeBatch>(
    isValidUserId ? disposeBatchesPath(userId) : ""
  );

  useEffect(() => {
    if (!initialRequestId) return;
    const match = requests.find((r: DisposeRequest) => r.id === initialRequestId);
    if (match) {
      setSelectedRequest(match);
      return;
    }
    const batchMatch = disposeBatches.find((b) => b.id === initialRequestId);
    if (batchMatch) setSelectedBatch(batchMatch);
  }, [initialRequestId, requests, disposeBatches]);

  const singleRequests = useMemo(
    () => requests.filter((r) => !r.batchId),
    [requests]
  );

  const pendingCount =
    singleRequests.filter((r) => r.status === "pending").length +
    disposeBatches.filter((b) => b.status === "pending" || b.status === "partial").length;
  const approvedCount = singleRequests.filter((r) => r.status === "approved").length;
  const rejectedCount = singleRequests.filter((r) => r.status === "rejected").length;
  const totalCount = singleRequests.length + disposeBatches.length;

  const filteredBatches = useMemo(() => {
    let batches = [...disposeBatches];
    if (statusFilter === "pending") {
      batches = batches.filter((b) => b.status === "pending" || b.status === "partial");
    } else if (statusFilter !== "all") {
      batches = batches.filter((b) => b.status === statusFilter);
    }
    const q = requestSearch.trim().toLowerCase();
    if (q) {
      batches = batches.filter(
        (b) =>
          (b.reason || "").toLowerCase().includes(q) ||
          String(b.totalLines || "").includes(q) ||
          (b.status || "").toLowerCase().includes(q)
      );
    }
    return batches.sort((a, b) => {
      const key = (batch: (typeof disposeBatches)[number]) =>
        queueSortKey({
          actionable: isDisposeBatchActionable(batch),
          requestDate: batch.requestedAt,
        });
      return compareQueueSortKeys(key(a), key(b));
    });
  }, [disposeBatches, statusFilter, requestSearch]);

  const filteredRequests = useMemo(() => {
    let list = statusFilter === "all" ? singleRequests : singleRequests.filter((r) => r.status === statusFilter);
    const q = requestSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((r) =>
        (r.productName || "").toLowerCase().includes(q) ||
        (r.reason || "").toLowerCase().includes(q) ||
        (r.status || "").toLowerCase().includes(q) ||
        String(r.quantity || "").includes(q)
      );
    }
    return [...list].sort((a, b) => {
      const key = (req: DisposeRequest) =>
        queueSortKey({
          actionable: isDisposeRequestActionable(req),
          actionDate: req.approvedAt,
          requestDate: req.requestedAt,
        });
      return compareQueueSortKeys(key(a), key(b));
    });
  }, [singleRequests, statusFilter, requestSearch]);

  const refreshBatchCounts = async (batchId: string) => {
    if (!userId) return;
    const linesSnap = await getDocs(collection(db, disposeBatchLinesPath(userId, batchId)));
    const counts = { pending: 0, approved: 0, rejected: 0, total: linesSnap.size };
    linesSnap.forEach((snap) => {
      const lineStatus = String(snap.data().status || "pending");
      if (lineStatus === "approved") counts.approved++;
      else if (lineStatus === "rejected") counts.rejected++;
      else counts.pending++;
    });
    await refreshDisposeBatchCounts(userId, batchId, counts);
  };

  const syncShopifyAfterDispose = async (
    invItem: InventoryItem,
    newQtyAfterDispose: number
  ) => {
    const shopifyItem = invItem as InventoryItem & {
      source?: string;
      shop?: string;
      shopifyVariantId?: string;
      shopifyInventoryItemId?: string;
      woocommerceConnectionId?: string;
      woocommerceProductId?: string;
      woocommerceVariationId?: string;
    };
    if (!authUser || !userId) return;

    if (
      shopifyItem.source === "shopify" &&
      shopifyItem.shop &&
      shopifyItem.shopifyVariantId
    ) {
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

    if (
      shopifyItem.source === "woocommerce" &&
      shopifyItem.woocommerceConnectionId &&
      shopifyItem.woocommerceProductId
    ) {
      try {
        const token = await authUser.getIdToken();
        const res = await fetch("/api/integrations/woocommerce/sync-inventory", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            userId,
            connectionId: shopifyItem.woocommerceConnectionId,
            productId: shopifyItem.woocommerceProductId,
            variationId: shopifyItem.woocommerceVariationId,
            newQuantity: newQtyAfterDispose,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast({
            variant: "destructive",
            title: "Disposed in PrepCorex; WooCommerce did not update",
            description:
              typeof data.error === "string"
                ? data.error
                : "Re-connect the store in Integrations.",
          });
        }
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Disposed in PrepCorex; WooCommerce did not update",
          description: e instanceof Error ? e.message : "Re-connect the store in Integrations.",
        });
      }
    }

    const tiktokItem = invItem as InventoryItem & {
      source?: string;
      tiktokConnectionId?: string;
      tiktokProductId?: string;
      tiktokSkuId?: string;
      tiktokShopId?: string;
    };
    if (
      tiktokItem.source === "tiktok" &&
      tiktokItem.tiktokProductId &&
      tiktokItem.tiktokSkuId &&
      (tiktokItem.tiktokConnectionId || tiktokItem.tiktokShopId)
    ) {
      try {
        const token = await authUser.getIdToken();
        const res = await fetch("/api/tiktok/sync-inventory", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            userId,
            connectionId: tiktokItem.tiktokConnectionId,
            tiktokShopId: tiktokItem.tiktokShopId,
            productId: tiktokItem.tiktokProductId,
            skuId: tiktokItem.tiktokSkuId,
            newQuantity: newQtyAfterDispose,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast({
            variant: "destructive",
            title: "Disposed in PrepCorex; TikTok Shop did not update",
            description:
              [data.error, data.detail].filter(Boolean).join(" — ") ||
              "Re-connect TikTok in Integrations.",
          });
        }
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Disposed in PrepCorex; TikTok Shop did not update",
          description: e instanceof Error ? e.message : "Re-connect TikTok in Integrations.",
        });
      }
    }

    const etsyItem = invItem as InventoryItem & {
      source?: string;
      etsyConnectionId?: string;
      etsyListingId?: string;
      etsyShopId?: string;
    };
    if (
      etsyItem.source === "etsy" &&
      etsyItem.etsyListingId &&
      (etsyItem.etsyConnectionId || etsyItem.etsyShopId)
    ) {
      try {
        const token = await authUser.getIdToken();
        const res = await fetch("/api/etsy/sync-inventory", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            userId,
            connectionId: etsyItem.etsyConnectionId,
            etsyShopId: etsyItem.etsyShopId,
            listingId: etsyItem.etsyListingId,
            newQuantity: newQtyAfterDispose,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast({
            variant: "destructive",
            title: "Disposed in PrepCorex; Etsy did not update",
            description:
              typeof data.error === "string" ? data.error : "Re-connect Etsy in Integrations.",
          });
        }
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Disposed in PrepCorex; Etsy did not update",
          description: e instanceof Error ? e.message : "Re-connect Etsy in Integrations.",
        });
      }
    }

    const ebayItem = invItem as InventoryItem & {
      source?: string;
      ebayConnectionId?: string;
      ebayOfferId?: string;
      ebayListingId?: string;
    };
    if (
      ebayItem.source === "ebay" &&
      ebayItem.ebayConnectionId &&
      (ebayItem.ebayOfferId || ebayItem.ebayListingId)
    ) {
      try {
        const token = await authUser.getIdToken();
        const res = await fetch("/api/integrations/ebay/sync-inventory", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            userId,
            connectionId: ebayItem.ebayConnectionId,
            offerId: ebayItem.ebayOfferId,
            listingId: ebayItem.ebayListingId,
            newQuantity: newQtyAfterDispose,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast({
            variant: "destructive",
            title: "Disposed in PrepCorex; eBay did not update",
            description:
              typeof data.error === "string"
                ? data.error
                : "Reconnect eBay with write scopes in Integrations.",
          });
        }
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Disposed in PrepCorex; eBay did not update",
          description: e instanceof Error ? e.message : "Reconnect eBay in Integrations.",
        });
      }
    }
  };

  const runBulkBatchAction = async (
    lines: DisposeBatchLine[],
    action: "approve" | "reject",
    opts?: { reason?: string }
  ) => {
    if (!selectedBatch || !userId || !adminProfile) return;
    setIsProcessing(true);
    let succeeded = 0;
    let failed = 0;
    try {
      for (const line of lines) {
        try {
          if (action === "approve") {
            const invItem = inventory.find((i) => i.id === line.productId);
            if (!invItem) throw new Error(`Product ${line.productName} not found.`);
            await approveDisposeBatchLine({
              userId,
              batchId: selectedBatch.id,
              line,
              inventoryItem: invItem,
              adminUid: adminProfile.uid,
              adminName: adminProfile.name || "Admin",
            });
            const newQty =
              line.quantity >= invItem.quantity ? 0 : invItem.quantity - line.quantity;
            await syncShopifyAfterDispose(invItem, newQty);
          } else {
            await rejectDisposeBatchLine({
              userId,
              batchId: selectedBatch.id,
              lineId: line.id,
              adminUid: adminProfile.uid,
              adminFeedback: opts?.reason,
            });
          }
          succeeded++;
        } catch {
          failed++;
        }
      }

      await refreshBatchCounts(selectedBatch.id);

      if (succeeded > 0) {
        await addDoc(collection(db, `users/${userId}/notifications`), {
          type: "dispose_request",
          title:
            action === "approve"
              ? "Dispose batch lines approved"
              : "Dispose batch lines rejected",
          message:
            action === "approve"
              ? `${succeeded} line(s) from your dispose batch were approved.`
              : `${succeeded} line(s) from your dispose batch were rejected.`,
          isRead: false,
          targetUrl: "/dashboard/recycle-bin",
          relatedRequestId: selectedBatch.id,
          createdAt: Timestamp.now(),
          createdBy: adminProfile.uid,
        });
      }

      toast({
        title: action === "approve" ? "Bulk approve complete" : "Bulk reject complete",
        description: `${succeeded} succeeded${failed > 0 ? `, ${failed} failed` : ""}.`,
        variant: failed > 0 && succeeded === 0 ? "destructive" : "default",
      });
    } finally {
      setIsProcessing(false);
    }
  };

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
      if (request.batchId && request.batchLineId) {
        await approveDisposeBatchLine({
          userId: userId!,
          batchId: request.batchId,
          line: {
            id: request.batchLineId,
            batchId: request.batchId,
            lineNumber: 0,
            productId: request.productId,
            productName: request.productName,
            quantity: request.quantity,
            currentQuantity: invItem.quantity,
            stockStatus: "In Stock",
            reason: request.reason,
            status: "pending",
          },
          inventoryItem: invItem,
          adminUid: adminProfile.uid,
          adminName: adminProfile.name || "Admin",
        });
        const newQtyAfterDispose =
          request.quantity >= invItem.quantity ? 0 : invItem.quantity - request.quantity;
        await syncShopifyAfterDispose(invItem, newQtyAfterDispose);
        await refreshBatchCounts(request.batchId);
      } else {
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
      await syncShopifyAfterDispose(invItem, newQtyAfterDispose);
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
      if (request.batchId && request.batchLineId) {
        await rejectDisposeBatchLine({
          userId: userId!,
          batchId: request.batchId,
          lineId: request.batchLineId,
          adminUid: adminProfile.uid,
          adminFeedback: rejectFeedback.trim() || undefined,
        });
        await refreshBatchCounts(request.batchId);
      } else {
      const requestRef = doc(db, `users/${userId}/disposeRequests`, request.id);
      const updateData: Record<string, unknown> = {
        status: "rejected",
        rejectedBy: adminProfile.uid,
        rejectedAt: Timestamp.now(),
      };
      if (rejectFeedback.trim()) updateData.adminFeedback = rejectFeedback.trim();
      await updateDoc(requestRef, updateData as Parameters<typeof updateDoc>[1]);
      }
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
      <Card className="min-w-0 overflow-hidden border-2 border-orange-200 shadow-lg">
        <CardHeader className="border-b bg-gradient-to-r from-orange-50 to-amber-50 px-3 py-3 sm:px-6 sm:py-4">
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <RotateCcw className="h-5 w-5 shrink-0" />
            Dispose Requests
          </CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            Approve to remove qty (disposed); reject with optional feedback.
          </CardDescription>
        </CardHeader>
        <CardContent className="min-w-0 space-y-3 p-3 sm:space-y-4 sm:p-6">
          {/* Stat cards — compact on mobile */}
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
            <Card
              role="button"
              tabIndex={0}
              onClick={() => setStatusFilter("pending")}
              onKeyDown={(e) => e.key === "Enter" && setStatusFilter("pending")}
              className="min-w-0 cursor-pointer overflow-hidden rounded-lg border border-amber-200/60 bg-gradient-to-br from-amber-50 to-orange-50/50 shadow-sm transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-1 sm:rounded-xl sm:border-2 sm:shadow-md sm:hover:shadow-lg sm:focus:ring-offset-2"
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 p-2 pb-0 sm:p-6 sm:pb-2">
                <CardTitle className="text-[10px] font-medium leading-tight text-amber-900 sm:text-sm">
                  Pending
                </CardTitle>
                <div className="hidden h-9 w-9 items-center justify-center rounded-lg bg-amber-500 shadow-sm sm:flex">
                  <Clock className="h-4 w-4 text-white" />
                </div>
              </CardHeader>
              <CardContent className="p-2 pt-0.5 sm:p-6 sm:pt-0">
                {loading ? (
                  <Skeleton className="h-5 w-8 rounded sm:h-8 sm:w-12" />
                ) : (
                  <>
                    <div className="text-base font-bold tabular-nums text-amber-900 sm:text-2xl">
                      {pendingCount}
                    </div>
                    <p className="mt-0.5 hidden text-xs text-amber-700 sm:block">Awaiting review</p>
                  </>
                )}
              </CardContent>
            </Card>
            <Card
              role="button"
              tabIndex={0}
              onClick={() => setStatusFilter("approved")}
              onKeyDown={(e) => e.key === "Enter" && setStatusFilter("approved")}
              className="min-w-0 cursor-pointer overflow-hidden rounded-lg border border-green-200/60 bg-gradient-to-br from-green-50 to-emerald-50/50 shadow-sm transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-green-400 focus:ring-offset-1 sm:rounded-xl sm:border-2 sm:shadow-md sm:hover:shadow-lg sm:focus:ring-offset-2"
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 p-2 pb-0 sm:p-6 sm:pb-2">
                <CardTitle className="text-[10px] font-medium leading-tight text-green-900 sm:text-sm">
                  Approved
                </CardTitle>
                <div className="hidden h-9 w-9 items-center justify-center rounded-lg bg-green-500 shadow-sm sm:flex">
                  <CheckCircle className="h-4 w-4 text-white" />
                </div>
              </CardHeader>
              <CardContent className="p-2 pt-0.5 sm:p-6 sm:pt-0">
                {loading ? (
                  <Skeleton className="h-5 w-8 rounded sm:h-8 sm:w-12" />
                ) : (
                  <>
                    <div className="text-base font-bold tabular-nums text-green-900 sm:text-2xl">
                      {approvedCount}
                    </div>
                    <p className="mt-0.5 hidden text-xs text-green-700 sm:block">Disposed</p>
                  </>
                )}
              </CardContent>
            </Card>
            <Card
              role="button"
              tabIndex={0}
              onClick={() => setStatusFilter("rejected")}
              onKeyDown={(e) => e.key === "Enter" && setStatusFilter("rejected")}
              className="min-w-0 cursor-pointer overflow-hidden rounded-lg border border-red-200/60 bg-gradient-to-br from-red-50 to-rose-50/50 shadow-sm transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-1 sm:rounded-xl sm:border-2 sm:shadow-md sm:hover:shadow-lg sm:focus:ring-offset-2"
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 p-2 pb-0 sm:p-6 sm:pb-2">
                <CardTitle className="text-[10px] font-medium leading-tight text-red-900 sm:text-sm">
                  Rejected
                </CardTitle>
                <div className="hidden h-9 w-9 items-center justify-center rounded-lg bg-red-500 shadow-sm sm:flex">
                  <XCircle className="h-4 w-4 text-white" />
                </div>
              </CardHeader>
              <CardContent className="p-2 pt-0.5 sm:p-6 sm:pt-0">
                {loading ? (
                  <Skeleton className="h-5 w-8 rounded sm:h-8 sm:w-12" />
                ) : (
                  <>
                    <div className="text-base font-bold tabular-nums text-red-900 sm:text-2xl">
                      {rejectedCount}
                    </div>
                    <p className="mt-0.5 hidden text-xs text-red-700 sm:block">Not approved</p>
                  </>
                )}
              </CardContent>
            </Card>
            <Card
              role="button"
              tabIndex={0}
              onClick={() => setStatusFilter("all")}
              onKeyDown={(e) => e.key === "Enter" && setStatusFilter("all")}
              className="min-w-0 cursor-pointer overflow-hidden rounded-lg border border-slate-200/60 bg-gradient-to-br from-slate-50 to-slate-100/50 shadow-sm transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1 sm:rounded-xl sm:border-2 sm:shadow-md sm:hover:shadow-lg sm:focus:ring-offset-2"
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 p-2 pb-0 sm:p-6 sm:pb-2">
                <CardTitle className="text-[10px] font-medium leading-tight text-slate-900 sm:text-sm">
                  Total
                </CardTitle>
                <div className="hidden h-9 w-9 items-center justify-center rounded-lg bg-slate-500 shadow-sm sm:flex">
                  <FileStack className="h-4 w-4 text-white" />
                </div>
              </CardHeader>
              <CardContent className="p-2 pt-0.5 sm:p-6 sm:pt-0">
                {loading ? (
                  <Skeleton className="h-5 w-8 rounded sm:h-8 sm:w-12" />
                ) : (
                  <>
                    <div className="text-base font-bold tabular-nums text-slate-900 sm:text-2xl">
                      {totalCount}
                    </div>
                    <p className="mt-0.5 hidden text-xs text-slate-700 sm:block">All requests</p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:flex sm:items-center sm:gap-2">
              <div className="relative min-w-0 w-full sm:max-w-xs sm:flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={requestSearch}
                  onChange={(e) => setRequestSearch(e.target.value)}
                  placeholder="Search product, reason, status..."
                  className="h-9 pl-9 pr-8"
                />
                {requestSearch && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 p-0"
                    onClick={() => setRequestSearch("")}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 w-full sm:w-[140px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
              </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAddDisposeDialogOpen(true)}
              className="h-9 w-full shrink-0 sm:w-auto"
            >
              <Plus className="mr-1 h-4 w-4" />
              Request dispose for user
            </Button>
          </div>

          {loading || batchesLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : filteredRequests.length === 0 && filteredBatches.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No dispose requests found.</p>
          ) : (
            <>
              <div className="space-y-1.5 md:hidden">
                {filteredBatches.map((batch) => (
                  <div
                    key={`batch-${batch.id}`}
                    className="min-w-0 rounded-lg border border-orange-200 bg-orange-50/50 px-2.5 py-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="mb-0.5 flex flex-wrap items-center gap-1">
                          <Badge variant="outline" className="text-[10px]">
                            Batch
                          </Badge>
                          <Badge variant="secondary" className="text-[10px] capitalize">
                            {batch.status}
                          </Badge>
                        </div>
                        <p className="break-words text-sm font-semibold leading-snug">
                          Dispose batch · {batch.totalLines} lines
                        </p>
                        {batch.reason ? (
                          <p className="mt-0.5 line-clamp-2 break-words text-[11px] text-muted-foreground">
                            {batch.reason}
                          </p>
                        ) : null}
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {formatDate(batch.requestedAt)}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 shrink-0 px-2.5"
                        onClick={() => setSelectedBatch(batch)}
                      >
                        <Eye className="mr-1 h-3.5 w-3.5" /> Preview
                      </Button>
                    </div>
                  </div>
                ))}
                {filteredRequests.map((req) => (
                  <div
                    key={req.id}
                    className="min-w-0 rounded-lg border px-2.5 py-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="mb-0.5 flex flex-wrap items-center gap-1">
                          <Badge variant="outline" className="text-[10px]">
                            Single
                          </Badge>
                          <Badge
                            variant={
                              req.status === "pending"
                                ? "secondary"
                                : req.status === "approved"
                                  ? "default"
                                  : "destructive"
                            }
                            className="text-[10px] capitalize"
                          >
                            {req.status}
                          </Badge>
                        </div>
                        <p className="break-words text-sm font-semibold leading-snug">{req.productName}</p>
                        <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                          Qty {req.quantity}
                          {req.reason ? ` · ${req.reason}` : ""}
                        </p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {formatDate(req.requestedAt)}
                        </p>
                      </div>
                      {req.status === "pending" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 shrink-0 px-2.5"
                          onClick={() => setSelectedRequest(req)}
                        >
                          <Eye className="mr-1 h-3.5 w-3.5" /> Process
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
              <div className="hidden overflow-x-auto rounded-md border md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                      <TableHead>Type</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Requested</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                    {filteredBatches.map((batch) => (
                      <TableRow key={`batch-${batch.id}`} className="bg-orange-50/50">
                        <TableCell>
                          <Badge variant="outline">Batch</Badge>
                        </TableCell>
                        <TableCell className="font-medium">
                          Dispose batch · {batch.totalLines} lines
                          <span className="block text-xs text-muted-foreground line-clamp-2">
                            {batch.reason}
                          </span>
                        </TableCell>
                        <TableCell>{batch.totalLines}</TableCell>
                        <TableCell className="max-w-[200px] truncate" title={batch.reason}>
                          {batch.reason}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(batch.requestedAt)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{batch.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" onClick={() => setSelectedBatch(batch)}>
                            <Eye className="mr-1 h-4 w-4" /> Preview
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  {filteredRequests.map((req) => (
                    <TableRow key={req.id}>
                        <TableCell>
                          <Badge variant="outline">Single</Badge>
                        </TableCell>
                      <TableCell className="font-medium">{req.productName}</TableCell>
                      <TableCell>{req.quantity}</TableCell>
                        <TableCell className="max-w-[200px] truncate" title={req.reason}>
                          {req.reason}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(req.requestedAt)}
                        </TableCell>
                      <TableCell>
                          <Badge
                            variant={
                              req.status === "pending"
                                ? "secondary"
                                : req.status === "approved"
                                  ? "default"
                                  : "destructive"
                            }
                          >
                          {req.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {req.status === "pending" && (
                          <Button size="sm" variant="outline" onClick={() => setSelectedRequest(req)}>
                              <Eye className="mr-1 h-4 w-4" /> Process
                          </Button>
                        )}
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

      <Dialog open={!!selectedRequest} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md p-4 sm:p-6">
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

      {selectedBatch && userId && (
        <DisposeBatchAdminDialog
          batch={selectedBatch}
          userId={userId}
          isProcessing={isProcessing}
          onClose={() => setSelectedBatch(null)}
          onReviewLine={(line) => {
            setSelectedRequest(batchLineToDisposeRequest(selectedBatch, line));
          }}
          onBulkApprove={(lines) => runBulkBatchAction(lines, "approve")}
          onBulkReject={(lines, reason) => runBulkBatchAction(lines, "reject", { reason })}
        />
      )}

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
