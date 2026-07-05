"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Layers, Loader2, X } from "lucide-react";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { db } from "@/lib/firebase";
import type { InboundBatch, InboundBatchLine, InventoryRequest } from "@/types";
import {
  batchLineToInventoryRequest,
  formatLoadContentsLabel,
  formatShipmentTypeLabel,
  inboundBatchLinesPath,
} from "@/lib/inbound-batch";

const LINES_PER_PAGE = 100;

type InboundBatchAdminDialogProps = {
  batch: InboundBatch | null;
  userId: string;
  isProcessing?: boolean;
  onClose: () => void;
  onReviewLine: (request: InventoryRequest) => void;
  onBulkApprove: (lines: InboundBatchLine[], receivingDate: Date) => void | Promise<void>;
  onBulkReject: (lines: InboundBatchLine[], reason: string) => void | Promise<void>;
};

export function InboundBatchAdminDialog({
  batch,
  userId,
  isProcessing = false,
  onClose,
  onReviewLine,
  onBulkApprove,
  onBulkReject,
}: InboundBatchAdminDialogProps) {
  const linesPath = batch ? inboundBatchLinesPath(userId, batch.id) : "";
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");
  const [lines, setLines] = useState<InboundBatchLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCursors, setPageCursors] = useState<(QueryDocumentSnapshot<DocumentData> | null)[]>([null]);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rejectOpen, setRejectOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [receivingDate, setReceivingDate] = useState<Date>(new Date());

  useEffect(() => {
    if (!batch) {
      setSelectedIds(new Set());
      setRejectReason("");
      setRejectOpen(false);
      setApproveOpen(false);
      setLines([]);
      setPageIndex(0);
      setPageCursors([null]);
      setLastDoc(null);
      setHasNextPage(false);
    }
  }, [batch?.id]);

  useEffect(() => {
    setSelectedIds(new Set());
    setLines([]);
    setPageIndex(0);
    setPageCursors([null]);
    setLastDoc(null);
    setHasNextPage(false);
  }, [batch?.id, statusFilter]);

  useEffect(() => {
    if (!batch || !linesPath) return;
    let cancelled = false;
    const loadPage = async () => {
      setLoading(true);
      try {
        const constraints =
          statusFilter === "all"
            ? [orderBy("lineNumber", "asc"), limit(LINES_PER_PAGE + 1)]
            : [where("status", "==", statusFilter), limit(LINES_PER_PAGE + 1)];
        const cursor = pageCursors[pageIndex];
        const q = cursor
          ? query(collection(db, linesPath), ...constraints, startAfter(cursor))
          : query(collection(db, linesPath), ...constraints);
        const snap = await getDocs(q);
        if (cancelled) return;
        const docs = snap.docs.slice(0, LINES_PER_PAGE);
        setLines(
          docs
            .map((d) => ({ id: d.id, ...d.data() } as InboundBatchLine))
            .sort((a, b) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0))
        );
        setLastDoc(docs.length > 0 ? docs[docs.length - 1] : null);
        setHasNextPage(snap.docs.length > LINES_PER_PAGE);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadPage();
    return () => {
      cancelled = true;
    };
  }, [batch, linesPath, pageCursors, pageIndex, statusFilter]);

  const pendingLines = useMemo(() => lines.filter((line) => line.status === "pending"), [lines]);

  const filteredLines = lines;

  const selectableInView = useMemo(
    () => filteredLines.filter((line) => line.status === "pending"),
    [filteredLines]
  );

  const selectedLines = useMemo(
    () => pendingLines.filter((line) => selectedIds.has(line.id)),
    [pendingLines, selectedIds]
  );

  const allViewSelected =
    selectableInView.length > 0 && selectableInView.every((line) => selectedIds.has(line.id));

  const toggleLine = (lineId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(lineId);
      else next.delete(lineId);
      return next;
    });
  };

  const toggleAllInView = (checked: boolean) => {
    if (!checked) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        selectableInView.forEach((line) => next.delete(line.id));
        return next;
      });
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      selectableInView.forEach((line) => next.add(line.id));
      return next;
    });
  };

  const selectVisiblePending = () => {
    setSelectedIds(new Set(pendingLines.map((line) => line.id)));
  };

  const goNext = () => {
    if (!lastDoc || !hasNextPage) return;
    setPageCursors((prev) => {
      const next = [...prev];
      next[pageIndex + 1] = lastDoc;
      return next;
    });
    setPageIndex((prev) => prev + 1);
    setSelectedIds(new Set());
  };

  const goPrevious = () => {
    setPageIndex((prev) => Math.max(0, prev - 1));
    setSelectedIds(new Set());
  };

  if (!batch) return null;

  return (
    <>
      <Dialog open={!!batch} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="flex h-[92vh] max-w-3xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-primary" />
              Inbound batch review
            </DialogTitle>
            <DialogDescription>
              {batch.totalLines} lines · Shipment: {formatShipmentTypeLabel(batch.shipmentType)}
              {batch.loadContents ? ` · Inside: ${formatLoadContentsLabel(batch.loadContents)}` : ""} ·{" "}
              {batch.pendingLines} pending, {batch.approvedLines} approved, {batch.rejectedLines} rejected
            </DialogDescription>
          </DialogHeader>

          {batch.productNotes?.trim() ? (
            <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Description</p>
              <p className="mt-1 whitespace-pre-wrap">{batch.productNotes.trim()}</p>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {(["all", "pending", "approved", "rejected"] as const).map((key) => (
              <Button
                key={key}
                type="button"
                size="sm"
                variant={statusFilter === key ? "default" : "outline"}
                onClick={() => setStatusFilter(key)}
              >
                {key.charAt(0).toUpperCase() + key.slice(1)}
              </Button>
            ))}
          </div>

          {pendingLines.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2">
              <Button type="button" size="sm" variant="outline" onClick={selectVisiblePending} disabled={isProcessing}>
                Select visible pending ({pendingLines.length})
              </Button>
              <Button
                type="button"
                size="sm"
                variant="default"
                disabled={isProcessing || selectedLines.length === 0}
                onClick={() => setApproveOpen(true)}
              >
                <Check className="mr-1.5 h-4 w-4" />
                Approve selected ({selectedLines.length})
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={isProcessing || selectedLines.length === 0}
                onClick={() => setRejectOpen(true)}
              >
                <X className="mr-1.5 h-4 w-4" />
                Reject selected ({selectedLines.length})
              </Button>
              <span className="text-xs text-muted-foreground">
                Showing page {pageIndex + 1} · {LINES_PER_PAGE} max
              </span>
              {isProcessing && (
                <span className="inline-flex items-center text-xs text-muted-foreground">
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Processing…
                </span>
              )}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading lines…
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur">
                  <tr>
                    <th className="w-10 px-2 py-2">
                      {selectableInView.length > 0 ? (
                        <Checkbox
                          checked={allViewSelected}
                          onCheckedChange={(v) => toggleAllInView(v === true)}
                          aria-label="Select all in view"
                        />
                      ) : null}
                    </th>
                    <th className="px-2 py-2 text-left font-medium">#</th>
                    <th className="px-2 py-2 text-left font-medium">Type</th>
                    <th className="px-2 py-2 text-left font-medium">Name / SKU</th>
                    <th className="px-2 py-2 text-right font-medium">Qty</th>
                    <th className="px-2 py-2 text-left font-medium">Status</th>
                    <th className="px-2 py-2 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLines.map((line) => (
                    <tr key={line.id} className="border-t">
                      <td className="px-2 py-2">
                        {line.status === "pending" ? (
                          <Checkbox
                            checked={selectedIds.has(line.id)}
                            onCheckedChange={(v) => toggleLine(line.id, v === true)}
                            aria-label={`Select line ${line.lineNumber}`}
                          />
                        ) : null}
                      </td>
                      <td className="px-2 py-2 tabular-nums text-muted-foreground">{line.lineNumber}</td>
                      <td className="px-2 py-2 capitalize">{line.inventoryType}</td>
                      <td className="px-2 py-2 max-w-[200px] truncate">
                        {line.sku || line.productName}
                        {line.variantLabel ? (
                          <span className="block text-xs text-muted-foreground">{line.variantLabel}</span>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{line.quantity}</td>
                      <td className="px-2 py-2">
                        <Badge variant={line.status === "pending" ? "secondary" : "outline"}>
                          {line.status}
                        </Badge>
                      </td>
                      <td className="px-2 py-2 text-right">
                        {line.status === "pending" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={isProcessing}
                            onClick={() => onReviewLine(batchLineToInventoryRequest(batch, line))}
                          >
                            Review
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="text-xs"
                            onClick={() => onReviewLine(batchLineToInventoryRequest(batch, line))}
                          >
                            View
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredLines.length === 0 && (
                <p className="p-6 text-center text-sm text-muted-foreground">No lines in this filter.</p>
              )}
            </div>
          )}
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>
              Showing {filteredLines.length} line{filteredLines.length === 1 ? "" : "s"} on page {pageIndex + 1}
            </span>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={goPrevious} disabled={loading || pageIndex === 0}>
                Previous
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={goNext} disabled={loading || !hasNextPage}>
                Next
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Bulk approve</DialogTitle>
            <DialogDescription>
              Approve {selectedLines.length} selected line(s) with requested quantities. Products use warehouse
              receive flow; box/pallet/container are added to inventory directly.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Receiving date</Label>
            <DatePicker date={receivingDate} setDate={(d) => d && setReceivingDate(d)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setApproveOpen(false)} disabled={isProcessing}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={isProcessing || selectedLines.length === 0}
              onClick={() => {
                void onBulkApprove(selectedLines, receivingDate).then(() => {
                  setApproveOpen(false);
                  setSelectedIds(new Set());
                });
              }}
            >
              {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Approve {selectedLines.length} line(s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Bulk reject</DialogTitle>
            <DialogDescription>
              Reject {selectedLines.length} selected line(s). The same reason applies to all.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Rejection reason *</Label>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Enter reason for rejection…"
              className="min-h-[100px]"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRejectOpen(false)} disabled={isProcessing}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isProcessing || selectedLines.length === 0 || !rejectReason.trim()}
              onClick={() => {
                void onBulkReject(selectedLines, rejectReason.trim()).then(() => {
                  setRejectOpen(false);
                  setRejectReason("");
                  setSelectedIds(new Set());
                });
              }}
            >
              {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reject {selectedLines.length} line(s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
