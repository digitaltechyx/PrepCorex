"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
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
import { db } from "@/lib/firebase";
import { disposeBatchLinesPath } from "@/lib/dispose-batch";
import type { DisposeBatch, DisposeBatchLine } from "@/types";

const LINES_PER_PAGE = 100;

type DisposeBatchAdminDialogProps = {
  batch: DisposeBatch | null;
  userId: string;
  isProcessing?: boolean;
  onClose: () => void;
  onReviewLine: (line: DisposeBatchLine) => void;
  onBulkApprove: (lines: DisposeBatchLine[]) => void | Promise<void>;
  onBulkReject: (lines: DisposeBatchLine[], reason: string) => void | Promise<void>;
};

export function DisposeBatchAdminDialog({
  batch,
  userId,
  isProcessing = false,
  onClose,
  onReviewLine,
  onBulkApprove,
  onBulkReject,
}: DisposeBatchAdminDialogProps) {
  const linesPath = batch ? disposeBatchLinesPath(userId, batch.id) : "";
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");
  const [lines, setLines] = useState<DisposeBatchLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCursors, setPageCursors] = useState<(QueryDocumentSnapshot<DocumentData> | null)[]>([null]);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [rejectOpen, setRejectOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

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
            .map((d) => ({ id: d.id, ...d.data() } as DisposeBatchLine))
            .sort((a, b) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0))
        );
        setLastDoc(docs.length > 0 ? docs[docs.length - 1] : null);
        setHasNextPage(snap.docs.length > LINES_PER_PAGE);
      } catch {
        if (!cancelled) setLines([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void loadPage();
    return () => {
      cancelled = true;
    };
  }, [batch, linesPath, statusFilter, pageIndex, pageCursors]);

  const pendingLines = useMemo(() => lines.filter((line) => line.status === "pending"), [lines]);
  const selectedPendingLines = useMemo(
    () => pendingLines.filter((line) => selectedIds.has(line.id)),
    [pendingLines, selectedIds]
  );
  const allVisibleSelected =
    pendingLines.length > 0 && pendingLines.every((line) => selectedIds.has(line.id));

  const toggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingLines.map((line) => line.id)));
    }
  };

  if (!batch) return null;

  return (
    <>
      <Dialog open={Boolean(batch)} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Dispose batch · {batch.totalLines} lines</DialogTitle>
            <DialogDescription>
              Review and approve or reject lines in bulk. Batch reason: {batch.reason || "—"}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-2">
            {(["pending", "approved", "rejected", "all"] as const).map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={statusFilter === value ? "default" : "outline"}
                onClick={() => setStatusFilter(value)}
              >
                {value}
              </Button>
            ))}
          </div>

          {statusFilter === "pending" && pendingLines.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={allVisibleSelected} onCheckedChange={toggleSelectAll} />
                Select all on page ({pendingLines.length})
              </label>
              <Button
                type="button"
                size="sm"
                disabled={selectedPendingLines.length === 0 || isProcessing}
                onClick={() => setApproveOpen(true)}
              >
                <Check className="mr-1 h-4 w-4" />
                Approve selected ({selectedPendingLines.length})
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={selectedPendingLines.length === 0 || isProcessing}
                onClick={() => setRejectOpen(true)}
              >
                <X className="mr-1 h-4 w-4" />
                Reject selected
              </Button>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading lines…
            </div>
          ) : lines.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No lines for this filter.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    {statusFilter === "pending" && <th className="w-10 px-2 py-2" />}
                    <th className="px-2 py-2 text-left">#</th>
                    <th className="px-2 py-2 text-left">Product</th>
                    <th className="px-2 py-2 text-left">Status</th>
                    <th className="px-2 py-2 text-right">Current</th>
                    <th className="px-2 py-2 text-right">Dispose</th>
                    <th className="px-2 py-2 text-left">Reason</th>
                    <th className="px-2 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.id} className="border-t">
                      {statusFilter === "pending" && (
                        <td className="px-2 py-2">
                          {line.status === "pending" ? (
                            <Checkbox
                              checked={selectedIds.has(line.id)}
                              onCheckedChange={(checked) => {
                                setSelectedIds((prev) => {
                                  const next = new Set(prev);
                                  if (checked) next.add(line.id);
                                  else next.delete(line.id);
                                  return next;
                                });
                              }}
                            />
                          ) : null}
                        </td>
                      )}
                      <td className="px-2 py-2 tabular-nums">{line.lineNumber}</td>
                      <td className="px-2 py-2">
                        <div className="font-medium">{line.productName}</div>
                        {line.sku ? (
                          <div className="text-xs text-muted-foreground">SKU: {line.sku}</div>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">
                        <Badge variant="outline">{line.stockStatus}</Badge>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{line.currentQuantity}</td>
                      <td className="px-2 py-2 text-right tabular-nums font-medium">{line.quantity}</td>
                      <td className="px-2 py-2 max-w-[180px] truncate" title={line.reason}>
                        {line.reason || batch.reason}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <Badge
                          variant={
                            line.status === "approved"
                              ? "default"
                              : line.status === "rejected"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {line.status}
                        </Badge>
                        {line.status === "pending" && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="ml-2 h-7"
                            onClick={() => onReviewLine(line)}
                          >
                            Review
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Page {pageIndex + 1}</span>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pageIndex === 0}
                onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
              >
                Previous
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!hasNextPage || !lastDoc}
                onClick={() => {
                  if (!lastDoc) return;
                  setPageCursors((prev) => {
                    const next = [...prev];
                    next[pageIndex + 1] = lastDoc;
                    return next;
                  });
                  setPageIndex((p) => p + 1);
                }}
              >
                Next
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Approve {selectedPendingLines.length} line(s)?</DialogTitle>
            <DialogDescription>
              Inventory will be reduced and moved to disposed for each approved line.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setApproveOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={isProcessing}
              onClick={() => {
                setApproveOpen(false);
                void onBulkApprove(selectedPendingLines);
              }}
            >
              {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject {selectedPendingLines.length} line(s)</DialogTitle>
            <DialogDescription>Optional feedback is shown to the user.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Rejection feedback (optional)</Label>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for rejection"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isProcessing}
              onClick={() => {
                setRejectOpen(false);
                void onBulkReject(selectedPendingLines, rejectReason);
                setRejectReason("");
              }}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
