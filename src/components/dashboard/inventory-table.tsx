"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import type { InventoryItem, InventoryRequest, InboundBatch } from "@/types";
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
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, Filter, X, Clock, Eye, Edit, PlusCircle, Recycle, Trash2, History, PackageX } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { InventoryHistoryDialog } from "@/components/inventory/inventory-history-dialog";
import { AddInboundTrackingDialog } from "@/components/inventory/add-inbound-tracking-dialog";
import { InboundTrackingDetailDialog } from "@/components/inventory/inbound-tracking-detail-dialog";
import { InboundTrackingStatusCell } from "@/components/inventory/inbound-tracking-status-cell";
import {
  InventoryClosedRequestsSheet,
  type ClosedRequestMode,
} from "@/components/inventory/inventory-closed-requests-sheet";
import {
  InventoryOutOfStockSheet,
  type OutOfStockInventoryRow,
} from "@/components/inventory/inventory-out-of-stock-sheet";
import type { InboundTrackingEntry } from "@/types";
import { format } from "date-fns";
import { AddInventoryRequestForm } from "./add-inventory-request-form";
import { InboundImportProgress } from "@/components/dashboard/inbound-import-progress";
import { InboundBatchUserDialog } from "@/components/dashboard/inbound-batch-user-dialog";
import { useCollection } from "@/hooks/use-collection";
import { useAuth } from "@/hooks/use-auth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { doc, Timestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import { formatInboundQuantityDisplay } from "@/lib/inventory-qty-display";
import { formatLoadContentsLabel, formatShipmentTypeLabel, inboundBatchesPath, mirrorUnlinkedPendingBatchLines } from "@/lib/inbound-batch";
import { resolveInboundTrackings } from "@/lib/inbound-tracking";
import {
  formatInboundRequestRowQuantity,
  inboundRequestDisplayStatus,
  shouldShowApprovedInboundRequestRow,
  expectedApprovedInboundQty,
  type InboundTableDisplayStatus,
} from "@/lib/inventory-inbound-display";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function formatRowQuantity(item: {
  quantity?: number;
  requestedQuantity?: number;
  receivedQuantity?: number;
  isRequest?: boolean;
  status?: string;
  requestData?: InventoryRequest;
}): string {
  if (!item.isRequest) {
    const q = Number(item.quantity);
    return String(Number.isFinite(q) ? q : 0);
  }

  if (
    item.requestData &&
    (item.status === "Awaiting Receiving" || item.status === "Receiving")
  ) {
    return formatInboundRequestRowQuantity(item.requestData);
  }

  const status =
    item.status === "Pending"
      ? "pending"
      : item.status === "Rejected"
        ? "rejected"
        : String(item.requestData?.status || item.status || "pending").toLowerCase();
  return formatInboundQuantityDisplay({
    quantity: item.quantity,
    requestedQuantity:
      item.requestedQuantity ??
      item.requestData?.requestedQuantity ??
      item.requestData?.quantity ??
      item.quantity,
    receivedQuantity: item.receivedQuantity ?? item.requestData?.receivedQuantity,
    isRequest: status === "pending",
    status,
  });
}

function inventoryStatusBadge(status: string): { variant: "outline" | "secondary" | "destructive"; label: string } {
  switch (status) {
    case "Pending":
      return { variant: "outline", label: "Pending Approval" };
    case "Awaiting Receiving":
      return { variant: "outline", label: "Awaiting Receiving" };
    case "Receiving":
      return { variant: "secondary", label: "Receiving" };
    case "Rejected":
      return { variant: "destructive", label: "Rejected" };
    case "Cancelled":
      return { variant: "secondary", label: "Cancelled" };
    case "In Stock":
      return { variant: "secondary", label: "In Stock" };
    default:
      return { variant: "destructive", label: status };
  }
}

function isInboundPipelineStatus(status: string): boolean {
  return status === "Pending" || status === "Awaiting Receiving" || status === "Receiving";
}

function formatDate(date: InventoryItem["dateAdded"]) {
  if (typeof date === 'string') {
    return format(new Date(date), "MMM d, yyyy");
  }
  if (date && typeof date === 'object' && 'seconds' in date) {
    return format(new Date(date.seconds * 1000), "MMM d, yyyy");
  }
  return "N/A";
}

function formatReceivingDate(date: InventoryItem["receivingDate"]) {
  if (!date) return "N/A";
  if (typeof date === 'string') {
    return format(new Date(date), "MMM d, yyyy");
  }
  if (date && typeof date === 'object' && 'seconds' in date) {
    return format(new Date(date.seconds * 1000), "MMM d, yyyy");
  }
  return "N/A";
}

function formatDateTime(date: unknown) {
  if (!date) return null;
  let d: Date | null = null;
  if (typeof date === "string") {
    const parsed = new Date(date);
    if (!Number.isNaN(parsed.getTime())) d = parsed;
  } else if (typeof date === "object" && date !== null && "seconds" in (date as any)) {
    const sec = Number((date as any).seconds);
    if (Number.isFinite(sec)) d = new Date(sec * 1000);
  } else if (date instanceof Date && !Number.isNaN(date.getTime())) {
    d = date;
  }
  return d ? format(d, "MMM d, yyyy 'at' h:mm a") : null;
}

function getRemarksPhotoAt(...sources: unknown[]): unknown {
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const s = source as Record<string, unknown>;
    if (s.approvedAt) return s.approvedAt;
    if (s.receivingDate) return s.receivingDate;
    if (s.requestedAt) return s.requestedAt;
    if (s.addDate) return s.addDate;
    if (s.dateAdded) return s.dateAdded;
  }
  return undefined;
}

function formatOptionalDate(date: unknown) {
  if (!date) return "N/A";
  if (typeof date === "string") {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return "N/A";
    return format(d, "MMM d, yyyy");
  }
  if (typeof date === "object" && date !== null && "seconds" in (date as any)) {
    const sec = Number((date as any).seconds);
    if (!Number.isFinite(sec)) return "N/A";
    return format(new Date(sec * 1000), "MMM d, yyyy");
  }
  return "N/A";
}

function toDateInputValue(date: unknown): string {
  if (!date) return "";
  if (typeof date === "string") {
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toISOString().slice(0, 10);
  }
  if (typeof date === "object" && date !== null && "seconds" in (date as any)) {
    const sec = Number((date as any).seconds);
    if (!Number.isFinite(sec)) return "";
    return new Date(sec * 1000).toISOString().slice(0, 10);
  }
  return "";
}

function getImageUrls(data: { imageUrl?: string; imageUrls?: string[] } | undefined): string[] {
  if (!data) return [];
  if (Array.isArray(data.imageUrls) && data.imageUrls.length > 0) return data.imageUrls;
  if (typeof data.imageUrl === "string" && data.imageUrl.length > 0) return [data.imageUrl];
  return [];
}

const NO_IMAGE_PLACEHOLDER_SRC =
  "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 160'%3E%3Crect width='160' height='160' fill='%23e5e7eb'/%3E%3Crect x='44' y='34' width='72' height='52' rx='6' ry='6' fill='none' stroke='%239ca3af' stroke-width='4'/%3E%3Ccircle cx='62' cy='52' r='5' fill='%239ca3af'/%3E%3Cpath d='M52 78l16-16 13 13 9-9 18 18H52z' fill='%239ca3af'/%3E%3Ctext x='80' y='116' text-anchor='middle' font-size='12' font-family='Arial, sans-serif' fill='%236b7280'%3ENO IMAGE%3C/text%3E%3Ctext x='80' y='132' text-anchor='middle' font-size='12' font-family='Arial, sans-serif' fill='%236b7280'%3EAVAILABLE%3C/text%3E%3C/svg%3E";

function InventoryAvatar({
  item,
  className,
  onImageClick,
}: {
  item: any;
  className: string;
  onImageClick?: (url: string, name?: string) => void;
}) {
  const imageUrl = getImageUrls(item)[0];
  const inventoryType = item?.inventoryType ?? "product";

  if (imageUrl) {
    return (
      <button
        type="button"
        className="rounded-md transition-opacity hover:opacity-90"
        onClick={() => onImageClick?.(imageUrl, item?.productName)}
        title="View picture"
      >
        <img
          src={imageUrl}
          alt={item?.productName || "Inventory item"}
          className={`${className} rounded-md border object-cover`}
        />
      </button>
    );
  }

  return (
    <img
      src={NO_IMAGE_PLACEHOLDER_SRC}
      alt={`No image available for ${item?.productName || inventoryType || "inventory item"}`}
      className={`${className} rounded-md border object-cover`}
    />
  );
}

function getTimestampMs(date: unknown): number {
  if (!date) return 0;
  if (typeof date === "string") {
    const ms = new Date(date).getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof date === "object" && date !== null && "seconds" in (date as any)) {
    const sec = Number((date as any).seconds);
    return Number.isFinite(sec) ? sec * 1000 : 0;
  }
  return 0;
}

/** Matches dashboard KPI "Low Stock SKUs" (qty 1–10, real inventory rows only). URL: ?status=low-stock */
const LOW_STOCK_STATUS_VALUE = "low-stock";

function rowIsLowStock(item: { quantity?: number; isRequest?: boolean }) {
  if (item.isRequest) return false;
  const q = Number(item.quantity) || 0;
  return q > 0 && q <= 10;
}

/** Red row styling (same classes as admin cards): low qty, exclude eBay like admin. Uses dashboard low-stock band qty 1–10. */
function inventoryRowIsLowStockStyled(item: {
  quantity?: number;
  isRequest?: boolean;
  source?: string;
}) {
  if (item.isRequest) return false;
  if (item.source === "ebay") return false;
  return rowIsLowStock(item);
}

const lowStockRowCardClass =
  "border-red-500 border-2 bg-red-50 dark:bg-red-950/20";
const lowStockTextClass = "text-red-700 dark:text-red-400";
const lowStockQtyClass = "text-red-800 dark:text-red-300";

type InventorySourceRow = {
  source?: string;
  shop?: string;
  isRequest?: boolean;
};

function inventorySourceKey(item: InventorySourceRow): string {
  if (item.isRequest) return "inbound";
  if (item.source === "shopify") return "shopify";
  if (item.source === "ebay") return "ebay";
  return "manual";
}

function inventorySourceMeta(item: InventorySourceRow) {
  if (item.isRequest) {
    return {
      label: "Inbound",
      detail: "Warehouse request",
      className: "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
    };
  }
  if (item.source === "shopify") {
    const shop = String(item.shop ?? "")
      .trim()
      .replace(/\.myshopify\.com$/i, "");
    return {
      label: "Shopify",
      detail: shop || undefined,
      className: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-100",
    };
  }
  if (item.source === "ebay") {
    return {
      label: "eBay",
      detail: undefined,
      className: "border-blue-300 bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-100",
    };
  }
  return {
    label: "Manual",
    detail: "Added in PrepCorex",
    className: "border-neutral-300 bg-neutral-50 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-200",
  };
}

function InventorySourceBadge({ item }: { item: InventorySourceRow }) {
  const meta = inventorySourceMeta(item);
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <Badge variant="outline" className={cn("text-[10px] px-2 py-0.5 font-semibold w-fit", meta.className)}>
        {meta.label}
      </Badge>
      {meta.detail ? (
        <span className="text-[10px] text-muted-foreground truncate max-w-[96px]" title={meta.detail}>
          {meta.detail}
        </span>
      ) : null}
    </div>
  );
}

/** Fallback when layout has not measured yet. */
const PRODUCT_NAME_EXPAND_AT = 28;

function InventoryProductName({
  name,
  textClassName,
  onViewFull,
}: {
  name: string;
  textClassName?: string;
  onViewFull: (fullName: string) => void;
}) {
  const label = name.trim() || "—";
  const textRef = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(label.length > PRODUCT_NAME_EXPAND_AT);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;

    const checkTruncation = () => {
      const clamped = el.scrollHeight > el.clientHeight + 1;
      const overflowX = el.scrollWidth > el.clientWidth + 1;
      setIsTruncated(
        clamped || overflowX || label.length > PRODUCT_NAME_EXPAND_AT
      );
    };

    checkTruncation();
    const raf = requestAnimationFrame(checkTruncation);
    const ro = new ResizeObserver(checkTruncation);
    ro.observe(el);
    window.addEventListener("resize", checkTruncation);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", checkTruncation);
    };
  }, [label]);

  const nameText = (
    <span
      ref={textRef}
      className={cn("line-clamp-2 break-words text-sm font-medium leading-snug", textClassName)}
    >
      {label}
    </span>
  );

  return (
    <div className="flex items-start gap-0.5 min-w-0 flex-1">
      <div className="min-w-0 flex-1 overflow-hidden">
        {isTruncated ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="w-full text-left cursor-default rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {nameText}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-sm whitespace-pre-wrap text-xs">
              {label}
            </TooltipContent>
          </Tooltip>
        ) : (
          nameText
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto shrink-0 flex-none p-0.5 text-blue-600 hover:text-blue-700"
        title="View full product name"
        onClick={() => onViewFull(label)}
      >
        <Eye className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export type AdminInventoryActions = {
  onRestock?: (item: InventoryItem) => void;
  onDispose?: (item: InventoryItem) => void;
  onEdit?: (item: InventoryItem) => void;
  onDelete?: (item: InventoryItem) => void;
};

export function InventoryTable({
  data,
  ownerUserId,
  ownerUserName,
  adminActions,
}: {
  data: InventoryItem[];
  ownerUserId?: string;
  ownerUserName?: string;
  adminActions?: AdminInventoryActions;
}) {
  const hasAdminActions = Boolean(
    adminActions && (adminActions.onRestock || adminActions.onDispose || adminActions.onEdit || adminActions.onDelete)
  );
  const searchParams = useSearchParams();
  const { user, userProfile } = useAuth();
  const effectiveUserId = ownerUserId || userProfile?.uid;
  const effectiveUserName = ownerUserName || userProfile?.name || "Unknown User";
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [openAddInventorySignal, setOpenAddInventorySignal] = useState(0);

  useEffect(() => {
    if (searchParams.get("status") === LOW_STOCK_STATUS_VALUE) {
      setStatusFilter(LOW_STOCK_STATUS_VALUE);
    }
  }, [searchParams]);
  useEffect(() => {
    if (searchParams.get("action") === "add-inventory") {
      setOpenAddInventorySignal((prev) => prev + 1);
    }
  }, [searchParams]);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [selectedRemarks, setSelectedRemarks] = useState<string>("");
  const [selectedImageUrls, setSelectedImageUrls] = useState<string[]>([]);
  const [selectedPhotosAt, setSelectedPhotosAt] = useState<string | null>(null);
  const [isRemarksDialogOpen, setIsRemarksDialogOpen] = useState(false);
  const [isImagePreviewOpen, setIsImagePreviewOpen] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState("");
  const [previewImageName, setPreviewImageName] = useState("");
  const [editingRequest, setEditingRequest] = useState<InventoryRequest | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editProductName, setEditProductName] = useState("");
  const [editQuantity, setEditQuantity] = useState(0);
  const [isUpdating, setIsUpdating] = useState(false);
  const [cancellingRequest, setCancellingRequest] = useState<InventoryRequest | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);
  const [historyItem, setHistoryItem] = useState<InventoryItem | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [trackingDialog, setTrackingDialog] = useState<{
    requestId: string;
    productName: string;
  } | null>(null);
  const [trackingDetail, setTrackingDetail] = useState<{
    productName: string;
    trackings: InboundTrackingEntry[];
  } | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<InboundBatch | null>(null);
  const [closedRequestsSheet, setClosedRequestsSheet] = useState<ClosedRequestMode | null>(null);
  const [outOfStockSheetOpen, setOutOfStockSheetOpen] = useState(false);
  const [productNamePreview, setProductNamePreview] = useState<string | null>(null);
  const { toast } = useToast();

  function canAddInboundTracking(
    item: {
      isRequest?: boolean;
      requestData?: InventoryRequest;
      sourceRequestId?: string;
    },
    requests: InventoryRequest[]
  ): boolean {
    if (item.isRequest && item.requestData) {
      const s = item.requestData.status;
      return s === "pending" || s === "approved";
    }
    const sourceId = item.sourceRequestId;
    if (!sourceId) return false;
    const req = requests.find((r) => r.id === sourceId);
    return req?.status === "pending" || req?.status === "approved";
  }

  function openHistory(item: InventoryItem) {
    setHistoryItem(item);
    setHistoryOpen(true);
  }

  // Fetch inventory requests
  const { data: inventoryRequests } = useCollection<InventoryRequest>(
    effectiveUserId ? `users/${effectiveUserId}/inventoryRequests` : ""
  );
  const { data: inboundBatches } = useCollection<InboundBatch>(
    effectiveUserId ? inboundBatchesPath(effectiveUserId) : ""
  );

  // Legacy 1-line batches often lack mirrored inventoryRequests — client can create for self.
  useEffect(() => {
    if (!effectiveUserId) return;
    const needsMirror = inboundBatches.some(
      (b) =>
        (b.status === "pending" || b.status === "partial") && Number(b.totalLines || 0) === 1
    );
    if (!needsMirror) return;
    let cancelled = false;
    const key = `inv-batch-mirror-v1:${effectiveUserId}`;
    try {
      if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(key) === "1") return;
    } catch {
      /* ignore */
    }
    void mirrorUnlinkedPendingBatchLines([effectiveUserId])
      .then((created) => {
        if (cancelled) return;
        try {
          sessionStorage.setItem(key, "1");
        } catch {
          /* ignore */
        }
        if (created > 0) {
          console.info(`[inventory] Mirrored ${created} batch line(s) for display`);
        }
      })
      .catch((err) => console.warn("[inventory] Batch mirror failed", err));
    return () => {
      cancelled = true;
    };
  }, [effectiveUserId, inboundBatches]);

  // Backfill product photos onto inventory rows created before putaway copied images.
  useEffect(() => {
    if (!effectiveUserId || data.length === 0 || inventoryRequests.length === 0) return;
    let cancelled = false;
    const key = `inv-image-backfill-v1:${effectiveUserId}`;
    try {
      if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(key) === "1") return;
    } catch {
      /* ignore */
    }

    void (async () => {
      let patched = 0;
      for (const item of data) {
        if (cancelled) return;
        if (getImageUrls(item as InventoryItem & { imageUrl?: string; imageUrls?: string[] }).length > 0) {
          continue;
        }
        const sourceId = String((item as InventoryItem & { sourceRequestId?: string }).sourceRequestId ?? "").trim();
        if (!sourceId) continue;
        const req = inventoryRequests.find((r) => r.id === sourceId);
        const urls = getImageUrls(req as InventoryRequest & { imageUrl?: string; imageUrls?: string[] });
        if (urls.length === 0) continue;
        try {
          await updateDoc(doc(db, "users", effectiveUserId, "inventory", item.id), {
            imageUrls: urls,
            imageUrl: urls[0],
            updatedAt: Timestamp.now(),
          });
          patched += 1;
        } catch (err) {
          console.warn("[inventory] image backfill failed", item.id, err);
        }
      }
      if (cancelled) return;
      try {
        sessionStorage.setItem(key, "1");
      } catch {
        /* ignore */
      }
      if (patched > 0) {
        console.info(`[inventory] Backfilled images on ${patched} product(s)`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [effectiveUserId, data, inventoryRequests]);

  // Refresh stale carrier statuses (> 6 hours) when inventory loads
  useEffect(() => {
    if (!user || !effectiveUserId) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/inbound-tracking/refresh-stale", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ userId: effectiveUserId }),
        });
        if (!cancelled && res.ok) {
          const data = await res.json();
          if (data.refreshedRequests > 0) {
            toast({
              title: "Tracking updated",
              description: data.message,
            });
          }
        }
      } catch {
        /* non-blocking */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, effectiveUserId, toast]);

  const pendingCount =
    inboundBatches.filter(
      (b) =>
        (b.status === "pending" || b.status === "partial") && Number(b.totalLines || 0) > 1
    ).length +
    inventoryRequests.filter((req) => {
      if (req.status !== "pending") return false;
      const batchId = (req as InventoryRequest & { batchId?: string }).batchId;
      if (!batchId) return true;
      // 1-line batch mirrors count as normal pending requests (not batch parents).
      const parent = inboundBatches.find((b) => b.id === batchId);
      return !parent || Number(parent.totalLines || 0) <= 1;
    }).length;
  const awaitingReceivingCount = useMemo(
    () => inventoryRequests.filter((req) => shouldShowApprovedInboundRequestRow(req, data)).length,
    [inventoryRequests, data]
  );
  const rejectedCount = inventoryRequests.filter(req => req.status === "rejected").length;
  const cancelledCount = inventoryRequests.filter(req => req.status === "cancelled").length;
  const outOfStockCount = data.filter((item) => item.status === "Out of Stock").length;

  const handleRemarksClick = (
    remarks: string,
    imageUrls?: string | string[],
    photoAt?: unknown
  ) => {
    setSelectedRemarks(remarks);
    if (Array.isArray(imageUrls)) {
      setSelectedImageUrls(imageUrls);
    } else if (typeof imageUrls === "string") {
      setSelectedImageUrls([imageUrls]);
    } else {
      setSelectedImageUrls([]);
    }
    setSelectedPhotosAt(formatDateTime(photoAt));
    setIsRemarksDialogOpen(true);
  };

  const handleEditClick = (request: InventoryRequest) => {
    setEditingRequest(request);
    setEditProductName(request.productName || "");
    setEditSku((request as any).sku || "");
    setEditQuantity(request.quantity);
    setEditRetailIdentifier((request as any).retailIdentifier || "");
    setEditExpiryDate(toDateInputValue((request as any).expiryDate));
    setIsEditDialogOpen(true);
  };

  const handleImagePreview = (url: string, name?: string) => {
    setPreviewImageUrl(url);
    setPreviewImageName(name || "Inventory picture");
    setIsImagePreviewOpen(true);
  };

  const [editSku, setEditSku] = useState("");
  const [editRetailIdentifier, setEditRetailIdentifier] = useState("");
  const [editExpiryDate, setEditExpiryDate] = useState("");

  const handleCancelRequest = async () => {
    if (!cancellingRequest?.id || !effectiveUserId) return;
    if (cancellingRequest.status !== "pending") {
      toast({
        variant: "destructive",
        title: "Cannot cancel",
        description: "Only pending requests can be cancelled.",
      });
      setCancellingRequest(null);
      return;
    }

    const reason = cancellationReason.trim();
    if (!reason) {
      toast({
        variant: "destructive",
        title: "Reason required",
        description: "Please tell us why you are cancelling this request.",
      });
      return;
    }

    setIsCancelling(true);
    try {
      const requestRef = doc(db, `users/${effectiveUserId}/inventoryRequests`, cancellingRequest.id);
      await updateDoc(requestRef, {
        status: "cancelled",
        cancelledAt: Timestamp.now(),
        cancelledBy: user?.uid || effectiveUserId,
        cancellationReason: reason,
      });
      toast({
        title: "Request cancelled",
        description: "Your inbound request was cancelled.",
      });
      setCancellingRequest(null);
      setCancellationReason("");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to cancel request.",
      });
    } finally {
      setIsCancelling(false);
    }
  };

  const handleUpdateRequest = async () => {
    if (!editingRequest || !effectiveUserId) return;
    if (editingRequest.status !== "pending") {
      toast({
        variant: "destructive",
        title: "Cannot edit",
        description: "Only pending requests can be edited.",
      });
      return;
    }

    if (!editProductName.trim()) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Product name is required.",
      });
      return;
    }

    if (!editSku.trim()) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "SKU is required.",
      });
      return;
    }

    if (editQuantity <= 0) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Quantity must be greater than 0.",
      });
      return;
    }

    setIsUpdating(true);
    try {
      const requestRef = doc(db, `users/${effectiveUserId}/inventoryRequests`, editingRequest.id);
      const updatePayload: Record<string, unknown> = {
        productName: editProductName.trim(),
        sku: editSku.trim(),
        quantity: editQuantity,
        retailIdentifier: editRetailIdentifier.trim(),
      };
      if (editExpiryDate.trim()) {
        const d = new Date(`${editExpiryDate.trim()}T12:00:00`);
        if (!Number.isNaN(d.getTime())) updatePayload.expiryDate = Timestamp.fromDate(d);
      } else {
        updatePayload.expiryDate = null;
      }
      await updateDoc(requestRef, updatePayload);

      toast({
        title: "Success",
        description: "Inventory request updated successfully.",
      });

      setIsEditDialogOpen(false);
      setEditingRequest(null);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update inventory request.",
      });
    } finally {
      setIsUpdating(false);
    }
  };

  // Combine inventory items and pending/rejected requests into one list
  const combinedInventory = useMemo(() => {
    // Get approved requests to match with inventory items for remarks
    const approvedRequests = inventoryRequests.filter(req => req.status === "approved");

    const trackingsForBatch = (batchId: string): InboundTrackingEntry[] => {
      const linked = inventoryRequests.filter(
        (req) => (req as InventoryRequest & { batchId?: string }).batchId === batchId
      );
      const seen = new Set<string>();
      const out: InboundTrackingEntry[] = [];
      for (const req of linked) {
        for (const t of resolveInboundTrackings(req as InventoryRequest & { trackingNumber?: string; carrier?: string })) {
          const key = t.trackingNumber.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(t);
        }
      }
      return out;
    };
    
    const multiLineOpenBatchIds = new Set(
      inboundBatches
        .filter(
          (batch) =>
            (batch.status === "pending" || batch.status === "partial") &&
            Number(batch.totalLines || 0) > 1
        )
        .map((batch) => batch.id)
    );

    const mirroredOneLineBatchIds = new Set(
      inventoryRequests
        .map((req) => (req as InventoryRequest & { batchId?: string }).batchId)
        .filter((id): id is string => Boolean(id))
    );

    // Batches are for 2+ lines only. Legacy 1-line batches show as product rows once mirrored;
    // until then keep a temporary batch row so the request is not invisible.
    const pendingBatchItems = inboundBatches
      .filter((batch) => {
        if (batch.status !== "pending" && batch.status !== "partial") return false;
        const lines = Number(batch.totalLines || 0);
        if (lines > 1) return true;
        if (lines === 1 && !mirroredOneLineBatchIds.has(batch.id)) return true;
        return false;
      })
      .map((batch) => ({
        id: `batch-${batch.id}`,
        productName:
          Number(batch.totalLines || 0) > 1
            ? `Inbound batch (${batch.totalLines} items)`
            : "Inbound request (1 item)",
        sku: [
          formatShipmentTypeLabel(batch.shipmentType),
          batch.loadContents ? formatLoadContentsLabel(batch.loadContents) : null,
        ]
          .filter(Boolean)
          .join(" · ") || "—",
        variantLabel: undefined,
        color: undefined,
        size: undefined,
        productEntryMode: undefined,
        retailIdentifier: undefined,
        expiryDate: undefined,
        quantity: batch.totalLines,
        dateAdded: batch.addDate,
        receivingDate: undefined,
        status: "Pending" as "Pending" | "In Stock" | "Out of Stock" | "Rejected",
        inventoryType: "product" as const,
        requestedBy: batch.requestedBy,
        remarks: [
          `${batch.pendingLines} pending · ${batch.approvedLines} approved · ${batch.rejectedLines} rejected`,
          batch.productNotes?.trim() ? batch.productNotes.trim() : null,
        ]
          .filter(Boolean)
          .join(" · "),
        imageUrls: [] as string[],
        isRequest: true,
        isBatch: true,
        batchId: batch.id,
        batchData: batch,
        inboundTrackings: trackingsForBatch(batch.id),
        remarksPhotoAt: undefined,
      }));

    // Convert pending requests to display format (hide lines that belong to multi-line batch parents)
    const pendingItems = inventoryRequests
      .filter((req) => {
        if (req.status !== "pending") return false;
        const batchId = (req as InventoryRequest & { batchId?: string }).batchId;
        if (batchId && multiLineOpenBatchIds.has(batchId)) return false;
        return true;
      })
      .map(req => ({
        id: `request-${req.id}`,
        productName: req.productName,
        sku: (req as any).sku || "",
        variantLabel: (req as any).variantLabel,
        color: (req as any).color,
        size: (req as any).size,
        productEntryMode: (req as any).productEntryMode,
        retailIdentifier: (req as any).retailIdentifier,
        expiryDate: (req as any).expiryDate,
        quantity: req.quantity,
        dateAdded: req.addDate,
        receivingDate: undefined,
        status: "Pending" as "Pending" | "In Stock" | "Out of Stock" | "Rejected",
        inventoryType: req.inventoryType,
        requestedBy: req.requestedBy,
        remarks: req.remarks,
        imageUrls: getImageUrls(req as any),
        isRequest: true,
        requestId: req.id,
        requestData: req,
        inboundTrackings: resolveInboundTrackings(
          req as InventoryRequest & { trackingNumber?: string; carrier?: string }
        ),
        remarksPhotoAt: getRemarksPhotoAt(req),
      }));

    const awaitingInboundItems = approvedRequests
      .filter((req) => shouldShowApprovedInboundRequestRow(req, data))
      .map((req) => ({
        id: `awaiting-${req.id}`,
        productName: req.productName,
        sku: (req as any).sku || "",
        variantLabel: (req as any).variantLabel,
        color: (req as any).color,
        size: (req as any).size,
        productEntryMode: (req as any).productEntryMode,
        retailIdentifier: (req as any).retailIdentifier,
        expiryDate: (req as any).expiryDate,
        quantity: expectedApprovedInboundQty(req),
        requestedQuantity: (req as any).requestedQuantity ?? req.quantity,
        receivedQuantity: (req as any).receivedQuantity,
        dateAdded: req.approvedAt ?? req.addDate,
        receivingDate: req.receivingDate,
        status: inboundRequestDisplayStatus(req) as InboundTableDisplayStatus,
        inventoryType: req.inventoryType,
        requestedBy: req.requestedBy,
        remarks: req.remarks,
        imageUrls: getImageUrls(req as any),
        isRequest: true,
        requestId: req.id,
        requestData: req,
        inboundTrackings: resolveInboundTrackings(
          req as InventoryRequest & { trackingNumber?: string; carrier?: string }
        ),
        remarksPhotoAt: getRemarksPhotoAt(req),
      }));

    // Convert approved inventory items - get remarks from inventory item OR approved request
    const inventoryItems = data.map(item => {
      // Try to find matching approved request to get remarks
      const matchingRequest = approvedRequests.find((req) => {
        if ((item as any).sourceRequestId && req.id === (item as any).sourceRequestId) return true;
        const requestSku = ((req as any).sku || "").trim().toLowerCase();
        const itemSku = (((item as any).sku as string) || "").trim().toLowerCase();
        if (requestSku && itemSku) return requestSku === itemSku;
        const reqReceived = (req as any).receivedQuantity ?? req.quantity;
        return (
          req.productName === item.productName &&
          req.requestedBy === item.requestedBy &&
          (reqReceived === item.quantity || req.quantity === item.quantity)
        );
      });
      
      // Use remarks from inventory item first, then from approved request
      const remarks = item.remarks || matchingRequest?.remarks;
      
      const imageUrls = getImageUrls(item as any).length > 0
        ? getImageUrls(item as any)
        : getImageUrls(matchingRequest as any);
      
      return {
        ...item,
        status: item.status as "Pending" | "In Stock" | "Out of Stock" | "Rejected",
        isRequest: false,
        requestedQuantity:
          (item as any).requestedQuantity ??
          (matchingRequest as any)?.requestedQuantity ??
          (matchingRequest as any)?.quantity,
        receivedQuantity:
          (item as any).receivedQuantity ?? (matchingRequest as any)?.receivedQuantity ?? item.quantity,
        remarks: remarks && remarks.trim() ? remarks.trim() : undefined,
        imageUrls: imageUrls,
        retailIdentifier: (item as any).retailIdentifier || (matchingRequest as any)?.retailIdentifier,
        expiryDate: (item as any).expiryDate || (matchingRequest as any)?.expiryDate,
        variantLabel: (item as any).variantLabel || (matchingRequest as any)?.variantLabel,
        color: (item as any).color || (matchingRequest as any)?.color,
        size: (item as any).size || (matchingRequest as any)?.size,
        productEntryMode: (item as any).productEntryMode || (matchingRequest as any)?.productEntryMode,
        inboundTrackings:
          (item as InventoryItem).inboundTrackings ??
          (matchingRequest as { inboundTrackings?: InboundTrackingEntry[] } | undefined)?.inboundTrackings,
        sourceRequestId: (item as any).sourceRequestId,
        remarksPhotoAt: getRemarksPhotoAt(item, matchingRequest),
      };
    });

    // Combine active inventory only — rejected/cancelled/OOS open in side panels via badges
    const activeInventoryItems = inventoryItems.filter((item) => item.status !== "Out of Stock");
    return { combined: [...pendingBatchItems, ...pendingItems, ...awaitingInboundItems, ...activeInventoryItems], outOfStockItems: inventoryItems.filter((item) => item.status === "Out of Stock") };
  }, [data, inventoryRequests, inboundBatches]);

  const combinedData = combinedInventory.combined;
  const outOfStockRows: OutOfStockInventoryRow[] = useMemo(
    () =>
      combinedInventory.outOfStockItems.map((item) => ({
        id: item.id,
        productName: item.productName,
        sku: (item as any).sku,
        variantLabel: (item as any).variantLabel,
        retailIdentifier: (item as any).retailIdentifier,
        expiryDate: (item as any).expiryDate,
        quantity: item.quantity,
        dateAdded: item.dateAdded,
        receivingDate: item.receivingDate,
        remarks: item.remarks,
        imageUrls: (item as any).imageUrls,
        source: (item as any).source,
      })),
    [combinedInventory.outOfStockItems]
  );

  // Filtered and sorted inventory data (newest first)
  const filteredData = useMemo(() => {
    const filtered = combinedData.filter((item) => {
      const query = searchTerm.toLowerCase();
      const productName = (item.productName || "").toLowerCase();
      const sku = (((item as any).sku as string) || "").toLowerCase();
      const variantLabel = (((item as any).variantLabel as string) || "").toLowerCase();
      const retailIdentifier = (((item as any).retailIdentifier as string) || "").toLowerCase();
      const matchesSearch =
        productName.includes(query) ||
        sku.includes(query) ||
        variantLabel.includes(query) ||
        retailIdentifier.includes(query);
      const row = item as { status: string; isRequest?: boolean; quantity?: number; source?: string; shop?: string };
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "Pending" && isInboundPipelineStatus(row.status)) ||
        (statusFilter === "In Stock" && row.status === "In Stock") ||
        (statusFilter === LOW_STOCK_STATUS_VALUE && rowIsLowStock(row));
      const matchesSource =
        sourceFilter === "all" || inventorySourceKey(row) === sourceFilter;
      return matchesSearch && matchesStatus && matchesSource;
    });
    
    // Sort by dateAdded (newest first)
    return filtered.sort((a, b) => getTimestampMs(b.dateAdded) - getTimestampMs(a.dateAdded));
  }, [combinedData, searchTerm, statusFilter, sourceFilter]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedData = filteredData.slice(startIndex, endIndex);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter, sourceFilter]);

  return (
    <TooltipProvider delayDuration={200}>
    <Card className="w-full">
      <CardHeader className="pb-2 sm:pb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <CardTitle className="text-base sm:text-lg lg:text-xl">Your Inventory ({filteredData.length})</CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              A list of products currently in your inventory.
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              {pendingCount > 0 && (
                <Badge variant="outline" className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {pendingCount} Pending
                </Badge>
              )}
              {awaitingReceivingCount > 0 && (
                <Badge variant="outline" className="flex items-center gap-1 border-amber-300 text-amber-800 dark:text-amber-200">
                  <PackageX className="h-3 w-3" />
                  {awaitingReceivingCount} Awaiting receive
                </Badge>
              )}
              {rejectedCount > 0 && (
                <button
                  type="button"
                  onClick={() => setClosedRequestsSheet("rejected")}
                  className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <Badge variant="destructive" className="flex items-center gap-1 cursor-pointer hover:opacity-90">
                    <X className="h-3 w-3" />
                    {rejectedCount} Rejected
                  </Badge>
                </button>
              )}
              {cancelledCount > 0 && (
                <button
                  type="button"
                  onClick={() => setClosedRequestsSheet("cancelled")}
                  className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <Badge variant="outline" className="flex items-center gap-1 text-muted-foreground cursor-pointer hover:bg-muted/80">
                    <Trash2 className="h-3 w-3" />
                    {cancelledCount} Cancelled
                  </Badge>
                </button>
              )}
              {outOfStockCount > 0 && (
                <button
                  type="button"
                  onClick={() => setOutOfStockSheetOpen(true)}
                  className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <Badge variant="secondary" className="flex items-center gap-1 cursor-pointer hover:opacity-90">
                    <PackageX className="h-3 w-3" />
                    {outOfStockCount} Out of stock
                  </Badge>
                </button>
              )}
            </div>
            <AddInventoryRequestForm
              targetUserId={effectiveUserId}
              targetUserName={effectiveUserName}
              openSignal={openAddInventorySignal}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 sm:p-6">
        <InboundImportProgress userId={effectiveUserId} />
        {/* Search and Filter Controls */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6 px-6">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search product, SKU, variant, or identifier..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
              {searchTerm && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute right-2 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                  onClick={() => setSearchTerm("")}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:w-auto">
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="sm:w-[160px]">
                <SelectValue placeholder="All sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                <SelectItem value="shopify">Shopify</SelectItem>
                <SelectItem value="ebay">eBay</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="inbound">Inbound requests</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="sm:w-[200px]">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value={LOW_STOCK_STATUS_VALUE}>Low stock (qty 1–10)</SelectItem>
                <SelectItem value="Pending">Pending</SelectItem>
                <SelectItem value="In Stock">In Stock</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Mobile Card List */}
        <div className="block sm:hidden px-4 space-y-3">
          {filteredData.length > 0 ? (
            paginatedData.map((item) => {
              const isLowStockVisual = inventoryRowIsLowStockStyled(
                item as { quantity?: number; isRequest?: boolean; source?: string }
              );
              return (
              <div
                key={item.id}
                className={cn(
                  "rounded-lg border p-3 bg-white",
                  isLowStockVisual ? lowStockRowCardClass : "border-border"
                )}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <InventoryAvatar
                        item={item as any}
                        className="h-10 w-10 shrink-0"
                        onImageClick={handleImagePreview}
                      />
                      <InventoryProductName
                        name={item.productName}
                        textClassName={cn(
                          "font-semibold",
                          isLowStockVisual && lowStockTextClass
                        )}
                        onViewFull={setProductNamePreview}
                      />
                      {(item as any).isRequest && (item as any).requestData && item.status === "Pending" && (
                        <div className="flex shrink-0 items-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-auto p-1"
                            onClick={() => handleEditClick((item as any).requestData)}
                            title="Edit request"
                          >
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-auto p-1 text-destructive hover:text-destructive"
                            onClick={() => {
                              setCancellingRequest((item as any).requestData);
                              setCancellationReason("");
                            }}
                            title="Cancel request"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                      {(item as any).isBatch && (item as any).batchData && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto shrink-0 p-1"
                          onClick={() => setSelectedBatch((item as any).batchData)}
                          title="View batch details"
                        >
                          <Eye className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">SKU: {(item as any).sku || "N/A"}</div>
                    <div className="mt-1.5">
                      <InventorySourceBadge item={item as InventorySourceRow} />
                    </div>
                    {(item as any).variantLabel && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Variant: {(item as any).variantLabel}
                      </div>
                    )}
                    {(item as any).retailIdentifier && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Identifier: {(item as any).retailIdentifier}
                      </div>
                    )}
                    {(item as any).expiryDate && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Expiry: {formatOptionalDate((item as any).expiryDate)}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground mt-1">Added: {formatDate(item.dateAdded)}</div>
                    {item.receivingDate && (
                      <div className="text-xs text-muted-foreground mt-0.5">Receiving: {formatReceivingDate(item.receivingDate)}</div>
                    )}
                    {((item.remarks && item.remarks.trim()) ||
                      ((item as any).imageUrls?.length ?? 0) > 0 ||
                      (item as any).imageUrl) && (
                      <div className="mt-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto p-0 text-left justify-start text-xs"
                          onClick={() =>
                            handleRemarksClick(
                              item.remarks || "",
                              (item as any).imageUrls || (item as any).imageUrl,
                              (item as any).remarksPhotoAt
                            )
                          }
                        >
                          {item.remarks && item.remarks.trim() ? (
                            <span className="text-blue-600 italic">{item.remarks}</span>
                          ) : (
                            <span className="text-blue-600">View photos</span>
                          )}
                          <Eye className="h-3 w-3 ml-1 inline-block align-middle" />
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="text-right ml-2">
                    <div className={cn("text-xs", isLowStockVisual && lowStockTextClass)}>Qty</div>
                    <div
                      className={cn(
                        "font-semibold text-sm",
                        isLowStockVisual && lowStockQtyClass
                      )}
                    >
                      {formatRowQuantity(item as any)}
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge 
                    variant={inventoryStatusBadge(item.status).variant}
                    className={cn(
                      "text-[10px] px-2 py-1",
                      item.status === "Awaiting Receiving" &&
                        "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
                    )}
                  >
                    {inventoryStatusBadge(item.status).label}
                  </Badge>
                  {item.status !== "Rejected" && item.status !== "Cancelled" && (
                    <InboundTrackingStatusCell
                      trackings={(item as any).inboundTrackings}
                      canAddTracking={canAddInboundTracking(item as any, inventoryRequests)}
                      onAddTracking={() => {
                        const requestId =
                          (item as any).requestId || (item as any).sourceRequestId;
                        if (!requestId || !effectiveUserId) return;
                        setTrackingDialog({
                          requestId,
                          productName: item.productName,
                        });
                      }}
                      onViewTracking={() => {
                        setTrackingDetail({
                          productName: item.productName,
                          trackings: (item as any).inboundTrackings ?? [],
                        });
                      }}
                    />
                  )}
                  {!(item as any).isRequest && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => openHistory(item as InventoryItem)}
                    >
                      <History className="h-3 w-3 mr-1" />
                      History
                    </Button>
                  )}
                  {hasAdminActions && !(item as any).isRequest && (
                    <div className="flex flex-wrap items-center gap-1 ml-auto">
                      {adminActions?.onRestock && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[11px] border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                          onClick={() => adminActions.onRestock?.(item as InventoryItem)}
                        >
                          <PlusCircle className="h-3 w-3 mr-1" /> Restock
                        </Button>
                      )}
                      {adminActions?.onEdit && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[11px] border-blue-300 text-blue-700 hover:bg-blue-50"
                          onClick={() => adminActions.onEdit?.(item as InventoryItem)}
                        >
                          <Edit className="h-3 w-3 mr-1" /> Edit
                        </Button>
                      )}
                      {adminActions?.onDispose && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[11px] border-orange-300 text-orange-700 hover:bg-orange-50"
                          onClick={() => adminActions.onDispose?.(item as InventoryItem)}
                        >
                          <Recycle className="h-3 w-3 mr-1" /> Dispose
                        </Button>
                      )}
                      {adminActions?.onDelete && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[11px] border-red-300 text-red-700 hover:bg-red-50"
                          onClick={() => adminActions.onDelete?.(item as InventoryItem)}
                        >
                          <Trash2 className="h-3 w-3 mr-1" /> Delete
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
            })
          ) : (
            <div className="text-center py-8 text-xs text-gray-500">
              {combinedData.length === 0 ? "No inventory items or requests found." : "No items match your search criteria."}
            </div>
          )}
        </div>

        {/* Desktop/Table View */}
        <div className="hidden sm:block">
          <Table containerClassName="overflow-x-auto overflow-y-hidden mouse-h-scroll">
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs sm:text-sm w-[280px] max-w-[280px]">Product</TableHead>
                <TableHead className="text-xs sm:text-sm hidden md:table-cell w-[92px]">Source</TableHead>
                <TableHead className="text-xs sm:text-sm hidden md:table-cell">SKU</TableHead>
                <TableHead className="text-xs sm:text-sm hidden lg:table-cell">Identifier</TableHead>
                <TableHead className="text-xs sm:text-sm hidden xl:table-cell">Expiry</TableHead>
                <TableHead className="text-xs sm:text-sm hidden sm:table-cell">Quantity</TableHead>
                <TableHead className="text-xs sm:text-sm hidden sm:table-cell">Date Added</TableHead>
                <TableHead className="text-xs sm:text-sm hidden md:table-cell">Receiving Date</TableHead>
                <TableHead className="text-xs sm:text-sm hidden lg:table-cell">Remarks</TableHead>
                <TableHead className="text-xs sm:text-sm">Status</TableHead>
                <TableHead className="text-xs sm:text-sm text-center w-[88px]">Tracking</TableHead>
                <TableHead className="text-xs sm:text-sm text-center w-[72px]">History</TableHead>
                {hasAdminActions && (
                  <TableHead className="text-xs sm:text-sm text-right">Actions</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredData.length > 0 ? (
                paginatedData.map((item) => {
                  const isLowStockVisual = inventoryRowIsLowStockStyled(
                    item as { quantity?: number; isRequest?: boolean; source?: string }
                  );
                  return (
               <TableRow
                 key={item.id}
                 className={cn(
                   "text-xs sm:text-sm [&>td]:py-2 [&>td]:align-middle",
                   isLowStockVisual && lowStockRowCardClass
                 )}
               >
                    <TableCell className="font-medium w-[280px] max-w-[280px] align-top overflow-visible">
                      <div className="flex flex-col sm:block min-w-0">
                        <div className="flex items-start gap-2 min-w-0">
                          <InventoryAvatar
                            item={item as any}
                            className="h-8 w-8 shrink-0"
                            onImageClick={handleImagePreview}
                          />
                          <InventoryProductName
                            name={item.productName}
                            textClassName={isLowStockVisual ? lowStockTextClass : undefined}
                            onViewFull={setProductNamePreview}
                          />
                          {(item as any).isRequest && (item as any).requestData && item.status === "Pending" && (
                            <div className="inline-flex shrink-0 items-center">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-auto p-1"
                                onClick={() => handleEditClick((item as any).requestData)}
                                title="Edit request"
                              >
                                <Edit className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-auto p-1 text-destructive hover:text-destructive"
                                onClick={() => {
                                  setCancellingRequest((item as any).requestData);
                                  setCancellationReason("");
                                }}
                                title="Cancel request"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          )}
                          {(item as any).isBatch && (item as any).batchData && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-auto shrink-0 p-1"
                              onClick={() => setSelectedBatch((item as any).batchData)}
                              title="View batch details"
                            >
                              <Eye className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                        {(item as any).variantLabel && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {(item as any).variantLabel}
                          </p>
                        )}
                        <div className="sm:hidden mt-1 space-y-0.5">
                          <span
                            className={cn(
                              "text-xs",
                              isLowStockVisual ? lowStockQtyClass : "text-gray-500"
                            )}
                          >
                            Qty: {formatRowQuantity(item as any)}
                          </span>
                          <br />
                          <span className="text-gray-500 text-xs">Added: {formatDate(item.dateAdded)}</span>
                          {item.receivingDate && (
                            <>
                              <br />
                              <span className="text-gray-500 text-xs">Receiving: {formatReceivingDate(item.receivingDate)}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell align-top">
                      <InventorySourceBadge item={item as InventorySourceRow} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell whitespace-nowrap">{(item as any).sku || "N/A"}</TableCell>
                    <TableCell className="hidden lg:table-cell whitespace-nowrap">
                      {(item as any).retailIdentifier || "N/A"}
                    </TableCell>
                    <TableCell className="hidden xl:table-cell whitespace-nowrap">
                      {(item as any).expiryDate ? formatOptionalDate((item as any).expiryDate) : "N/A"}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "hidden sm:table-cell whitespace-nowrap",
                        isLowStockVisual && lowStockQtyClass
                      )}
                    >
                      {formatRowQuantity(item as any)}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell whitespace-nowrap">
                      {formatDate(item.dateAdded)}
                    </TableCell>
                    <TableCell className="hidden md:table-cell whitespace-nowrap">
                      {formatReceivingDate(item.receivingDate)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell max-w-[180px]">
                      {(item.remarks && item.remarks.trim()) ||
                      ((item as any).imageUrls?.length ?? 0) > 0 ||
                      (item as any).imageUrl ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto p-1 text-left justify-start w-full max-w-[180px] truncate"
                          onClick={() =>
                            handleRemarksClick(
                              item.remarks || "",
                              (item as any).imageUrls || (item as any).imageUrl,
                              (item as any).remarksPhotoAt
                            )
                          }
                        >
                          <span className="truncate text-xs">
                            {item.remarks && item.remarks.trim()
                              ? item.remarks
                              : "View photos"}
                          </span>
                          <Eye className="h-3 w-3 ml-1 flex-shrink-0" />
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge 
                        variant={inventoryStatusBadge(item.status).variant}
                        className={cn(
                          "text-xs px-2 py-1",
                          item.status === "Awaiting Receiving" &&
                            "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
                        )}
                      >
                        {inventoryStatusBadge(item.status).label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center whitespace-nowrap">
                      {item.status !== "Rejected" && item.status !== "Cancelled" ? (
                        <InboundTrackingStatusCell
                          trackings={(item as any).inboundTrackings}
                          canAddTracking={canAddInboundTracking(item as any, inventoryRequests)}
                          onAddTracking={() => {
                            const requestId =
                              (item as any).requestId ||
                              (item as any).sourceRequestId;
                            if (!requestId || !effectiveUserId) return;
                            setTrackingDialog({
                              requestId,
                              productName: item.productName,
                            });
                          }}
                          onViewTracking={() => {
                            setTrackingDetail({
                              productName: item.productName,
                              trackings: (item as any).inboundTrackings ?? [],
                            });
                          }}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center whitespace-nowrap">
                      {!(item as any).isRequest ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="View stock history"
                          onClick={() => openHistory(item as InventoryItem)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {hasAdminActions && (
                      <TableCell className="whitespace-nowrap text-right">
                        {!(item as any).isRequest ? (
                          <div className="inline-flex items-center gap-1">
                            {adminActions?.onRestock && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-emerald-700 hover:bg-emerald-50"
                                title="Restock"
                                onClick={() => adminActions.onRestock?.(item as InventoryItem)}
                              >
                                <PlusCircle className="h-4 w-4" />
                              </Button>
                            )}
                            {adminActions?.onEdit && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-blue-700 hover:bg-blue-50"
                                title="Edit (logged)"
                                onClick={() => adminActions.onEdit?.(item as InventoryItem)}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                            )}
                            {adminActions?.onDispose && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-orange-700 hover:bg-orange-50"
                                title="Dispose"
                                onClick={() => adminActions.onDispose?.(item as InventoryItem)}
                              >
                                <Recycle className="h-4 w-4" />
                              </Button>
                            )}
                            {adminActions?.onDelete && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-red-700 hover:bg-red-50"
                                title="Delete (logged)"
                                onClick={() => adminActions.onDelete?.(item as InventoryItem)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={hasAdminActions ? 11 : 10} className="text-center py-8">
                    <div className="text-xs sm:text-sm text-gray-500">
                      {combinedData.length === 0 ? "No inventory items or requests found." : "No items match your search criteria."}
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination Controls */}
        {filteredData.length > itemsPerPage && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t px-6">
            <div className="text-sm text-muted-foreground">
              Showing {startIndex + 1} to {Math.min(endIndex, filteredData.length)} of {filteredData.length} items
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              <span className="text-sm">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      {/* Remarks Dialog */}
      <Dialog open={isRemarksDialogOpen} onOpenChange={setIsRemarksDialogOpen}>
        <DialogContent className="max-w-full sm:max-w-md md:max-w-lg lg:max-w-xl xl:max-w-2xl h-[100dvh] sm:h-auto sm:max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Admin Remarks</DialogTitle>
            <DialogDescription>Remarks from admin for this inventory item</DialogDescription>
          </DialogHeader>
          <div className="mt-4 overflow-y-auto max-h-[60vh] space-y-4">
            {selectedImageUrls.length > 0 && (
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-sm font-semibold">
                  Inventory Pictures ({selectedImageUrls.length})
                </p>
                {selectedPhotosAt && (
                  <p className="text-xs text-muted-foreground mt-0.5 mb-2">
                    {selectedPhotosAt}
                  </p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {selectedImageUrls.map((url, index) => (
                    <div key={index} className="relative">
                      <img
                        src={url}
                        alt={`Inventory ${index + 1}`}
                        className="max-w-full h-auto rounded-lg border"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="text-sm font-semibold mb-2">Remarks</p>
              <p className="text-sm whitespace-pre-wrap break-words overflow-wrap-anywhere">
                {selectedRemarks || "No remarks available"}
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={cancellingRequest !== null}
        onOpenChange={(open) => {
          if (!open && !isCancelling) {
            setCancellingRequest(null);
            setCancellationReason("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel inbound request?</DialogTitle>
            <DialogDescription>
              This will mark your pending request for{" "}
              <strong>{cancellingRequest?.productName || "this product"}</strong> as cancelled.
              You cannot undo this action.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="inbound-cancellation-reason">
              Why are you cancelling? <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="inbound-cancellation-reason"
              value={cancellationReason}
              onChange={(e) => setCancellationReason(e.target.value)}
              placeholder="e.g. wrong quantity, ordered by mistake, no longer shipping this product..."
              rows={4}
              maxLength={500}
              disabled={isCancelling}
            />
            <p className="text-xs text-muted-foreground">{cancellationReason.length}/500</p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              disabled={isCancelling}
              onClick={() => {
                setCancellingRequest(null);
                setCancellationReason("");
              }}
            >
              Keep request
            </Button>
            <Button
              variant="destructive"
              disabled={isCancelling || !cancellationReason.trim()}
              onClick={() => void handleCancelRequest()}
            >
              {isCancelling ? "Cancelling..." : "Cancel request"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Inventory Request Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Inventory Request</DialogTitle>
            <DialogDescription>
              Update the product name and quantity. You can only edit pending requests.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div>
              <label htmlFor="edit-product-name" className="text-sm font-medium">Product Name</label>
              <Input
                id="edit-product-name"
                value={editProductName}
                onChange={(e) => setEditProductName(e.target.value)}
                placeholder="Enter product name"
                className="mt-1"
              />
            </div>
            <div>
              <label htmlFor="edit-sku" className="text-sm font-medium">SKU</label>
              <Input
                id="edit-sku"
                value={editSku}
                onChange={(e) => setEditSku(e.target.value)}
                placeholder="Enter SKU"
                className="mt-1"
              />
            </div>
            <div>
              <label htmlFor="edit-quantity" className="text-sm font-medium">Quantity</label>
              <Input
                id="edit-quantity"
                type="number"
                min="1"
                value={editQuantity}
                onChange={(e) => setEditQuantity(parseInt(e.target.value) || 0)}
                placeholder="Enter quantity"
                className="mt-1"
              />
            </div>
            <div>
              <label htmlFor="edit-retail-identifier" className="text-sm font-medium">
                UPC / EAN / FNSKU / ASIN (optional)
              </label>
              <Input
                id="edit-retail-identifier"
                value={editRetailIdentifier}
                onChange={(e) => setEditRetailIdentifier(e.target.value)}
                placeholder="Identifier for this product"
                className="mt-1"
              />
            </div>
            <div>
              <label htmlFor="edit-expiry" className="text-sm font-medium">Expiry date (optional)</label>
              <Input
                id="edit-expiry"
                type="date"
                value={editExpiryDate}
                onChange={(e) => setEditExpiryDate(e.target.value)}
                className="mt-1"
              />
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setIsEditDialogOpen(false);
                  setEditingRequest(null);
                }}
                disabled={isUpdating}
              >
                Cancel
              </Button>
              <Button
                onClick={handleUpdateRequest}
                disabled={isUpdating}
              >
                {isUpdating ? "Updating..." : "Update Request"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Image Preview Dialog */}
      <Dialog open={isImagePreviewOpen} onOpenChange={setIsImagePreviewOpen}>
        <DialogContent className="max-w-full sm:max-w-xl md:max-w-2xl lg:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{previewImageName || "Inventory picture"}</DialogTitle>
            <DialogDescription>Image preview</DialogDescription>
          </DialogHeader>
          {previewImageUrl && (
            <div className="mt-2 flex items-center justify-center rounded-lg border bg-muted/20 p-3">
              <img
                src={previewImageUrl}
                alt={previewImageName || "Inventory picture"}
                className="max-h-[70vh] w-auto max-w-full rounded-md object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <InventoryHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        item={historyItem}
        userId={effectiveUserId}
        ownerLabel={effectiveUserName}
      />

      <InboundBatchUserDialog
        batch={selectedBatch}
        userId={effectiveUserId}
        onClose={() => setSelectedBatch(null)}
      />

      {effectiveUserId && trackingDialog ? (
        <AddInboundTrackingDialog
          open={!!trackingDialog}
          onOpenChange={(open) => {
            if (!open) setTrackingDialog(null);
          }}
          userId={effectiveUserId}
          requestId={trackingDialog.requestId}
          productName={trackingDialog.productName}
          onAdded={() => setTrackingDialog(null)}
        />
      ) : null}

      <InboundTrackingDetailDialog
        open={!!trackingDetail}
        onOpenChange={(open) => {
          if (!open) setTrackingDetail(null);
        }}
        productName={trackingDetail?.productName ?? ""}
        trackings={trackingDetail?.trackings}
      />

      <InventoryClosedRequestsSheet
        mode="rejected"
        open={closedRequestsSheet === "rejected"}
        onOpenChange={(open) => {
          if (!open) setClosedRequestsSheet((prev) => (prev === "rejected" ? null : prev));
        }}
        requests={inventoryRequests}
      />
      <InventoryClosedRequestsSheet
        mode="cancelled"
        open={closedRequestsSheet === "cancelled"}
        onOpenChange={(open) => {
          if (!open) setClosedRequestsSheet((prev) => (prev === "cancelled" ? null : prev));
        }}
        requests={inventoryRequests}
      />
      <InventoryOutOfStockSheet
        open={outOfStockSheetOpen}
        onOpenChange={setOutOfStockSheetOpen}
        items={outOfStockRows}
        inventoryItems={combinedInventory.outOfStockItems as InventoryItem[]}
        userId={effectiveUserId}
        ownerLabel={effectiveUserName}
      />

      <Dialog
        open={productNamePreview !== null}
        onOpenChange={(open) => !open && setProductNamePreview(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Product name</DialogTitle>
          </DialogHeader>
          <p className="text-sm whitespace-pre-wrap break-words">{productNamePreview}</p>
        </DialogContent>
      </Dialog>
    </Card>
    </TooltipProvider>
  );
}

