"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { Check, Eye, Loader2, Pencil, Trash2, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase";
import { formatLoadContentsLabel, formatShipmentTypeLabel, inboundBatchLinesPath } from "@/lib/inbound-batch";
import { uploadInventoryProductImage } from "@/lib/inventory-product-images";
import type { InboundBatch, InboundBatchLine } from "@/types";

const LINES_PER_PAGE = 100;

type StatusFilter = "all" | "pending" | "approved" | "rejected" | "cancelled";

function toDateInputValue(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  }
  if (typeof value === "object" && value !== null && "seconds" in value) {
    const sec = Number((value as { seconds?: unknown }).seconds);
    return Number.isFinite(sec) ? new Date(sec * 1000).toISOString().slice(0, 10) : "";
  }
  return "";
}

export function InboundBatchUserDialog({
  batch,
  userId,
  onClose,
}: {
  batch: InboundBatch | null;
  userId?: string;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [lines, setLines] = useState<InboundBatchLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCursors, setPageCursors] = useState<(QueryDocumentSnapshot<DocumentData> | null)[]>([null]);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingLine, setEditingLine] = useState<InboundBatchLine | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelAllPending, setCancelAllPending] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [editForm, setEditForm] = useState({
    productName: "",
    sku: "",
    quantity: "",
    retailIdentifier: "",
    expiryDate: "",
    remarks: "",
  });
  const [editImageUrls, setEditImageUrls] = useState<string[]>([]);
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [editImagePreview, setEditImagePreview] = useState<string | null>(null);
  const editImageInputRef = useRef<HTMLInputElement>(null);

  const linesPath = batch && userId ? inboundBatchLinesPath(userId, batch.id) : "";
  const pendingLines = useMemo(() => lines.filter((line) => line.status === "pending"), [lines]);
  const selectedPendingLines = useMemo(
    () => pendingLines.filter((line) => selectedIds.has(line.id)),
    [pendingLines, selectedIds]
  );
  const allVisibleSelected =
    pendingLines.length > 0 && pendingLines.every((line) => selectedIds.has(line.id));

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
  }, [batch, linesPath, pageCursors, pageIndex, statusFilter, saving]);

  const openEdit = (line: InboundBatchLine) => {
    setEditingLine(line);
    setEditForm({
      productName: line.productName || "",
      sku: line.sku || "",
      quantity: String(line.quantity || 1),
      retailIdentifier: line.retailIdentifier || "",
      expiryDate: toDateInputValue(line.expiryDate),
      remarks: line.remarks || "",
    });
    const urls =
      Array.isArray(line.imageUrls) && line.imageUrls.length > 0
        ? line.imageUrls
        : line.imageUrl
          ? [line.imageUrl]
          : [];
    setEditImageUrls(urls);
    if (editImagePreview) URL.revokeObjectURL(editImagePreview);
    setEditImageFile(null);
    setEditImagePreview(null);
  };

  const clearEditImageSelection = () => {
    if (editImagePreview) URL.revokeObjectURL(editImagePreview);
    setEditImageFile(null);
    setEditImagePreview(null);
    if (editImageInputRef.current) editImageInputRef.current.value = "";
  };

  const handleEditImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({
        variant: "destructive",
        title: "Invalid file",
        description: "Please select an image file.",
      });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({
        variant: "destructive",
        title: "Image too large",
        description: "Please upload an image smaller than 5 MB.",
      });
      return;
    }
    if (editImagePreview) URL.revokeObjectURL(editImagePreview);
    setEditImageFile(file);
    setEditImagePreview(URL.createObjectURL(file));
  };

  const runAction = async (payload: Record<string, unknown>) => {
    if (!user || !userId || !batch) throw new Error("You must be signed in.");
    const token = await user.getIdToken();
    const res = await fetch("/api/inbound-batches/user-action", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ userId, batchId: batch.id, ...payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Batch action failed.");
    return data;
  };

  const saveEdit = async () => {
    if (!editingLine || !userId) return;
    setSaving(true);
    try {
      let imageUrls = editImageUrls;
      let clearImage = false;
      if (editImageFile) {
        const url = await uploadInventoryProductImage(userId, editImageFile);
        imageUrls = [url];
      } else if (editImageUrls.length === 0) {
        clearImage = true;
      }

      await runAction({
        action: "updateLine",
        lineId: editingLine.id,
        line: {
          ...editForm,
          imageUrls,
          imageUrl: imageUrls[0] || "",
          clearImage,
        },
      });
      toast({ title: "Line updated", description: "Your pending inbound line was updated." });
      clearEditImageSelection();
      setEditingLine(null);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Could not update line", description: error?.message || "Try again." });
    } finally {
      setSaving(false);
    }
  };

  const cancelLines = async () => {
    setSaving(true);
    try {
      const data = await runAction({
        action: "cancelLines",
        allPending: cancelAllPending,
        lineIds: cancelAllPending ? undefined : selectedPendingLines.map((line) => line.id),
        reason: cancelReason.trim() || "Cancelled by user.",
      });
      toast({
        title: "Lines cancelled",
        description: `${Number(data.cancelled || 0).toLocaleString()} pending line(s) cancelled.`,
      });
      setCancelOpen(false);
      setCancelAllPending(false);
      setCancelReason("");
      setSelectedIds(new Set());
    } catch (error: any) {
      toast({ variant: "destructive", title: "Could not cancel lines", description: error?.message || "Try again." });
    } finally {
      setSaving(false);
    }
  };

  if (!batch || !userId) return null;

  return (
    <>
      <Dialog open={!!batch} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="flex h-[92vh] max-w-4xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5 text-primary" />
              Inbound batch details
            </DialogTitle>
            <DialogDescription>
              {batch.totalLines.toLocaleString()} lines · Shipment: {formatShipmentTypeLabel(batch.shipmentType)}
              {batch.loadContents ? ` · Inside: ${formatLoadContentsLabel(batch.loadContents)}` : ""} ·{" "}
              {batch.pendingLines.toLocaleString()} pending, {batch.approvedLines.toLocaleString()} approved,{" "}
              {batch.rejectedLines.toLocaleString()} rejected
            </DialogDescription>
          </DialogHeader>

          {batch.productNotes?.trim() ? (
            <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Description</p>
              <p className="mt-1 whitespace-pre-wrap">{batch.productNotes.trim()}</p>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {(["all", "pending", "approved", "rejected", "cancelled"] as const).map((key) => (
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

          {pendingLines.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setSelectedIds(
                    allVisibleSelected ? new Set() : new Set(pendingLines.map((line) => line.id))
                  );
                }}
                disabled={saving}
              >
                {allVisibleSelected ? "Clear visible" : `Select visible pending (${pendingLines.length})`}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={saving || selectedPendingLines.length === 0}
                onClick={() => {
                  setCancelAllPending(false);
                  setCancelOpen(true);
                }}
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                Cancel selected ({selectedPendingLines.length})
              </Button>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={saving || batch.pendingLines === 0}
                onClick={() => {
                  setCancelAllPending(true);
                  setCancelOpen(true);
                }}
              >
                Cancel all pending ({batch.pendingLines.toLocaleString()})
              </Button>
            </div>
          ) : null}

          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading lines...
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted/90 backdrop-blur">
                  <tr>
                    <th className="w-10 px-2 py-2" />
                    <th className="px-2 py-2 text-left font-medium">#</th>
                    <th className="px-2 py-2 text-left font-medium">Name / SKU</th>
                    <th className="px-2 py-2 text-right font-medium">Qty</th>
                    <th className="px-2 py-2 text-left font-medium">Status</th>
                    <th className="px-2 py-2 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.id} className="border-t">
                      <td className="px-2 py-2">
                        {line.status === "pending" ? (
                          <Checkbox
                            checked={selectedIds.has(line.id)}
                            onCheckedChange={(v) => {
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (v === true) next.add(line.id);
                                else next.delete(line.id);
                                return next;
                              });
                            }}
                          />
                        ) : null}
                      </td>
                      <td className="px-2 py-2 tabular-nums text-muted-foreground">{line.lineNumber}</td>
                      <td className="max-w-[260px] truncate px-2 py-2">
                        {line.sku || line.productName}
                        <span className="block truncate text-xs text-muted-foreground">{line.productName}</span>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{line.quantity}</td>
                      <td className="px-2 py-2">
                        <Badge variant={line.status === "pending" ? "secondary" : "outline"}>{line.status}</Badge>
                      </td>
                      <td className="px-2 py-2 text-right">
                        {line.status === "pending" ? (
                          <Button size="sm" variant="outline" onClick={() => openEdit(line)} disabled={saving}>
                            <Pencil className="mr-1.5 h-3.5 w-3.5" />
                            Edit
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">Read only</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {lines.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">No lines found.</p> : null}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>
              Showing {lines.length} line{lines.length === 1 ? "" : "s"} on page {pageIndex + 1}
            </span>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setPageIndex((p) => Math.max(0, p - 1))} disabled={loading || pageIndex === 0}>
                Previous
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  if (!lastDoc || !hasNextPage) return;
                  setPageCursors((prev) => {
                    const next = [...prev];
                    next[pageIndex + 1] = lastDoc;
                    return next;
                  });
                  setPageIndex((p) => p + 1);
                }}
                disabled={loading || !hasNextPage}
              >
                Next
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingLine} onOpenChange={(open) => !open && setEditingLine(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit pending line</DialogTitle>
            <DialogDescription>Only pending lines can be changed before admin review.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label>Product name *</Label>
              <Input value={editForm.productName} onChange={(e) => setEditForm((p) => ({ ...p, productName: e.target.value }))} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>SKU</Label>
                <Input value={editForm.sku} onChange={(e) => setEditForm((p) => ({ ...p, sku: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Quantity *</Label>
                <Input type="number" min={1} value={editForm.quantity} onChange={(e) => setEditForm((p) => ({ ...p, quantity: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Identifier</Label>
                <Input value={editForm.retailIdentifier} onChange={(e) => setEditForm((p) => ({ ...p, retailIdentifier: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Expiry</Label>
                <Input type="date" value={editForm.expiryDate} onChange={(e) => setEditForm((p) => ({ ...p, expiryDate: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Remarks</Label>
              <Textarea value={editForm.remarks} onChange={(e) => setEditForm((p) => ({ ...p, remarks: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Product picture (optional)</Label>
              <div className="flex items-start gap-3">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md border bg-muted/20">
                  {(editImagePreview || editImageUrls[0]) ? (
                    <img
                      src={editImagePreview || editImageUrls[0]}
                      alt="Product preview"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                      No image
                    </div>
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Input
                    ref={editImageInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleEditImageSelect}
                    disabled={saving}
                  />
                  {(editImageFile || editImageUrls.length > 0) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-fit px-2 text-xs"
                      disabled={saving}
                      onClick={() => {
                        clearEditImageSelection();
                        setEditImageUrls([]);
                      }}
                    >
                      Remove picture
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                clearEditImageSelection();
                setEditingLine(null);
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={() => void saveEdit()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{cancelAllPending ? "Cancel all pending lines" : "Cancel selected lines"}</DialogTitle>
            <DialogDescription>
              {cancelAllPending
                ? `This will cancel all ${batch.pendingLines.toLocaleString()} pending lines in this batch.`
                : `This will cancel ${selectedPendingLines.length} selected pending line(s).`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Optional cancellation reason" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={saving}>Keep lines</Button>
            <Button variant="destructive" onClick={() => void cancelLines()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <X className="mr-2 h-4 w-4" />}
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
