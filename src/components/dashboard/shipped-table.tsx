"use client";

import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import type {
  InventoryItem,
  ShippedItem,
  ShipmentRequest,
  RestockHistory,
  UserProfile,
} from "@/types";
import { shippedNeedsOutboundInvoice } from "@/lib/invoice-line-catalog";
import { formatServiceLabel } from "@/types";
import {
  formatFbaPackDimsForClient,
  isFbaLabelWorkflowRequest,
  recordFbaLabelUpload,
} from "@/lib/fba-shipment-workflow";
import {
  getShipmentSummary,
  buildShippedOrderDetails,
  enrichShippedOrderDetailsFromInventory,
  shippedItemFromShipmentRequest,
  type ShippedOrderDetails,
} from "@/lib/shipment-utils";
import { doc, updateDoc, Timestamp, runTransaction } from "firebase/firestore";
import { restoreClientInventoryForOutboundRequest } from "@/lib/client-inventory-outbound-sync";
import { db } from "@/lib/firebase";
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
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Search, Filter, X, Eye, Clock, XCircle, Trash2, FileText, Pencil } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { useCollection } from "@/hooks/use-collection";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  ShippedOrderDetailsDialog,
  type ShippedOrderCorrectionContext,
} from "@/components/dashboard/shipped-order-details-dialog";
import { OutboundShipmentVideoDialog } from "@/components/dashboard/outbound-shipment-video-dialog";
import { ClientPendingOutboundEditDialog } from "@/components/dashboard/client-pending-outbound-edit-dialog";
import { formatOutboundPackLine } from "@/lib/warehouse-outbound-lines";
import { isWarehouseDispatchedRequest } from "@/lib/warehouse-outbound-request-status";
import { useWarehouseCameraSessions } from "@/hooks/use-warehouse-camera-sessions";

function outboundVideoShipmentId(item: {
  requestId?: string;
  shipmentRequestId?: string | null;
}): string | null {
  const id = String(item.requestId || item.shipmentRequestId || "").trim();
  return id || null;
}

function warehouseLineEditNotice(shipment: Record<string, unknown>): string | null {
  const from = String(shipment.warehouseLineEditFrom ?? "").trim();
  if (!from) return null;
  if (Boolean(shipment.warehouseLineRemoved)) {
    return `Warehouse updated: was ${from} · line removed`;
  }
  const qty = Math.max(0, Math.floor(Number(shipment.quantity) || 0));
  const packOf = Math.max(1, Math.floor(Number(shipment.packOf) || 1));
  const now = formatOutboundPackLine(qty, packOf);
  if (from === now) return null;
  return `Warehouse updated: ${from} → ${now}`;
}

function formatDate(date: ShippedItem["date"]) {
    if (typeof date === 'string') {
      return format(new Date(date), "PPP");
    }
    if (date && typeof date === 'object' && 'seconds' in date) {
      return format(new Date(date.seconds * 1000), "PPP");
    }
    return "N/A";
  }

/** Parse Firestore Timestamp / Date / ISO string to ms for sorting. */
function toSortTimeMs(value: unknown): number {
  if (!value) return 0;
  if (typeof value === "string") {
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : 0;
  }
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof value === "object" && value !== null) {
    if (typeof (value as { toDate?: () => Date }).toDate === "function") {
      try {
        const t = (value as { toDate: () => Date }).toDate().getTime();
        return Number.isFinite(t) ? t : 0;
      } catch {
        /* ignore */
      }
    }
    if (typeof (value as { seconds?: number }).seconds === "number") {
      return (value as { seconds: number }).seconds * 1000;
    }
  }
  return 0;
}

/** Prefer the ship date shown in the table; fall back to created/requested time. */
function rowSortTimeMs(item: { date?: unknown; createdAt?: unknown }): number {
  const byDate = toSortTimeMs(item.date);
  if (byDate > 0) return byDate;
  return toSortTimeMs(item.createdAt);
}

/** Local calendar day key so sort matches the Date column (not event time-of-day). */
function calendarDayKey(ms: number): number {
  if (!ms) return 0;
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return 0;
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** Newest calendar date first; same day → newer timestamp; then id. */
function compareRowsByDateDesc(
  a: { id?: string; date?: unknown; createdAt?: unknown },
  b: { id?: string; date?: unknown; createdAt?: unknown }
): number {
  const aMs = rowSortTimeMs(a);
  const bMs = rowSortTimeMs(b);
  const dayDiff = calendarDayKey(bMs) - calendarDayKey(aMs);
  if (dayDiff !== 0) return dayDiff;
  if (bMs !== aMs) return bMs - aMs;
  return String(b.id || "").localeCompare(String(a.id || ""));
}

function formatRestockDate(restockedAt: RestockHistory["restockedAt"]) {
  if (typeof restockedAt === "string") {
    return format(new Date(restockedAt), "d MMM yyyy");
  }
  if (restockedAt && typeof restockedAt === "object" && "seconds" in restockedAt) {
    return format(new Date(restockedAt.seconds * 1000), "d MMM yyyy");
  }
  return "N/A";
  }

type ShippedRowStatus =
  | "Pending"
  | "Awaiting ship"
  | "Awaiting label"
  | "Shipped"
  | "Rejected"
  | "Cancelled";

const STATUS_URL_PENDING = "pending";
const STATUS_URL_SHIPPED = "shipped";
const STATUS_URL_REJECTED = "rejected";
const STATUS_URL_CANCELLED = "cancelled";

/** Open outbound requests still reserved / in warehouse flow (not yet in `shipped`). */
const OPEN_SHIPMENT_REQUEST_STATUSES = new Set([
  "pending",
  "confirmed",
  "awaiting_label_upload",
]);

const DATE_FILTER_KEYS = new Set(["all", "today", "week", "month", "year"]);

function isOpenShipmentRequestStatus(status: string | undefined | null): boolean {
  return OPEN_SHIPMENT_REQUEST_STATUSES.has(String(status || "").toLowerCase());
}

function isOpenUndispatchedShipmentRequest(req: ShipmentRequest): boolean {
  if (!isOpenShipmentRequestStatus(req.status)) return false;
  return !isWarehouseDispatchedRequest(req as unknown as Record<string, unknown>);
}

function displayStatusForOpenRequest(
  reqStatus: string | undefined | null
): Extract<ShippedRowStatus, "Pending" | "Awaiting ship" | "Awaiting label"> {
  const s = String(reqStatus || "pending").toLowerCase();
  if (s === "awaiting_label_upload") return "Awaiting label";
  if (s === "confirmed") return "Awaiting ship";
  return "Pending";
}

function isAwaitingFulfillmentRowStatus(status: string | undefined | null): boolean {
  return (
    status === "Pending" ||
    status === "Awaiting ship" ||
    status === "Awaiting label"
  );
}

function OpenOutboundStatusBadge({ status }: { status: string }) {
  if (status === "Awaiting ship") {
    return (
      <Badge
        variant="outline"
        className="flex items-center gap-1 w-fit border-sky-300 text-sky-800 bg-sky-50"
      >
        <Clock className="h-3 w-3" />
        Awaiting ship
      </Badge>
    );
  }
  if (status === "Awaiting label") {
    return (
      <Badge
        variant="outline"
        className="flex items-center gap-1 w-fit border-violet-300 text-violet-800 bg-violet-50"
      >
        <Clock className="h-3 w-3" />
        Awaiting label
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="flex items-center gap-1 w-fit">
      <Clock className="h-3 w-3" />
      Pending
    </Badge>
  );
}

function rowMatchesStatusFilter(
  item: { status?: string },
  statusFilter: string
): boolean {
  const s = (item.status || "") as ShippedRowStatus;
  if (statusFilter === STATUS_URL_SHIPPED) return s === "Shipped";
  if (statusFilter === STATUS_URL_PENDING) return isAwaitingFulfillmentRowStatus(s);
  if (statusFilter === STATUS_URL_REJECTED) return s === "Rejected";
  if (statusFilter === STATUS_URL_CANCELLED) return s === "Cancelled";
  return true;
}

export type ShippedTableAdminOptions = {
  clientUserId: string;
  getAuthToken: () => Promise<string>;
  onDeleteShippedOrder?: (item: ShippedItem) => Promise<void> | void;
  onCorrected?: () => void;
  /** After full dispatch — create invoice until one exists. */
  onCreateInvoice?: (item: ShippedItem) => void;
  /** Optional client profile fields for invoice header. */
  clientUser?: Pick<UserProfile, "uid" | "name" | "email" | "phone" | "outboundBilling">;
  /** When false, show Add services → CRM instead of Create Invoice. */
  allowPrepcorexCreateInvoice?: boolean;
};

export function ShippedTable({
  data,
  inventory,
  admin,
  embedded = false,
}: {
  data: ShippedItem[];
  inventory: InventoryItem[];
  admin?: ShippedTableAdminOptions;
  /** When true, omit outer Card/title — parent provides page chrome (admin inventory). */
  embedded?: boolean;
}) {
  const searchParams = useSearchParams();
  const { user, userProfile } = useAuth();
  const { toast } = useToast();
  const clientUserId = admin?.clientUserId ?? userProfile?.uid;
  const isAdminView = Boolean(admin);
  const { recordedShipmentIds } = useWarehouseCameraSessions(clientUserId);
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState<string>("all");
  /** Tabs: pending (open/cancelled/rejected) vs shipped only. */
  const [statusFilter, setStatusFilter] = useState<string>(STATUS_URL_PENDING);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedUploadRequest, setSelectedUploadRequest] = useState<ShipmentRequest | null>(null);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [isUploadingLabel, setIsUploadingLabel] = useState(false);
  const [cancellingRequest, setCancellingRequest] = useState<ShipmentRequest | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);
  const [editingRequest, setEditingRequest] = useState<ShipmentRequest | null>(null);

  useEffect(() => {
    const raw = searchParams.get("status")?.toLowerCase();
    if (
      raw === STATUS_URL_PENDING ||
      raw === STATUS_URL_SHIPPED ||
      raw === STATUS_URL_REJECTED ||
      raw === STATUS_URL_CANCELLED
    ) {
      setStatusFilter(raw);
    }
    const dateRaw = searchParams.get("date")?.toLowerCase();
    if (dateRaw && DATE_FILTER_KEYS.has(dateRaw)) {
      setDateFilter(dateRaw);
    }
  }, [searchParams]);
  const itemsPerPage = 10;
  const [selectedRemarks, setSelectedRemarks] = useState<string>("");
  const [isRemarksDialogOpen, setIsRemarksDialogOpen] = useState(false);
  const [selectedShipTo, setSelectedShipTo] = useState<string>("");
  const [isShipToDialogOpen, setIsShipToDialogOpen] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<Array<{productName: string, quantity: number, packOf: number, shippedQty: number, unitPrice: number}>>([]);
  const [isProductsDialogOpen, setIsProductsDialogOpen] = useState(false);
  const [selectedAdditionalServices, setSelectedAdditionalServices] = useState<any>(null);
  const [isAdditionalServicesDialogOpen, setIsAdditionalServicesDialogOpen] = useState(false);
  const [shipmentDetails, setShipmentDetails] = useState<ShippedOrderDetails | null>(null);
  const [isShipmentDetailsOpen, setIsShipmentDetailsOpen] = useState(false);
  const [shipmentDetailsItem, setShipmentDetailsItem] = useState<ShippedItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShippedItem | null>(null);
  const [isDeletingShipped, setIsDeletingShipped] = useState(false);

  // Fetch pending shipment requests
  const { data: pendingShipmentRequests } = useCollection<ShipmentRequest>(
    clientUserId ? `users/${clientUserId}/shipmentRequests` : ""
  );

  const { data: restockHistory } = useCollection<RestockHistory>(
    clientUserId ? `users/${clientUserId}/restockHistory` : ""
  );

  // Latest restock per product (by productName) for "Last restocked" column
  const latestRestockByProduct = useMemo(() => {
    const map = new Map<
      string,
      { restockedAt: RestockHistory["restockedAt"]; restockedQuantity: number; restockedBy: string }
    >();
    for (const r of restockHistory) {
      const at =
        typeof r.restockedAt === "string"
          ? new Date(r.restockedAt).getTime()
          : r.restockedAt?.seconds != null
            ? r.restockedAt.seconds * 1000
            : 0;
      const existing = map.get(r.productName);
      const existingAt = existing
        ? typeof existing.restockedAt === "string"
          ? new Date(existing.restockedAt).getTime()
          : existing.restockedAt?.seconds != null
            ? existing.restockedAt.seconds * 1000
            : 0
        : 0;
      if (at > existingAt) {
        map.set(r.productName, {
          restockedAt: r.restockedAt,
          restockedQuantity: r.restockedQuantity,
          restockedBy: r.restockedBy,
        });
      }
    }
    return map;
  }, [restockHistory]);

  const pendingCount = pendingShipmentRequests.filter(isOpenUndispatchedShipmentRequest).length;

  const handleCancelShipmentRequest = async () => {
    if (!cancellingRequest?.id || !userProfile?.uid) return;
    if (String(cancellingRequest.status || "").trim().toLowerCase() !== "pending") {
      toast({
        variant: "destructive",
        title: "Cannot cancel",
        description: "Only pending outbound requests can be cancelled.",
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
      await runTransaction(db, async (transaction) => {
        const requestRef = doc(db, `users/${userProfile.uid}/shipmentRequests`, cancellingRequest.id);
        const snap = await transaction.get(requestRef);
        if (!snap.exists()) throw new Error("Request not found.");
        const status = String(snap.data()?.status || "").trim().toLowerCase();
        if (status !== "pending" && status !== "awaiting_label_upload") {
          throw new Error("Only pending outbound requests can be cancelled.");
        }
        transaction.update(requestRef, {
          status: "cancelled",
          cancelledAt: Timestamp.now(),
          cancelledBy: user?.uid || userProfile.uid,
          cancellationReason: reason,
        });
      });

      await restoreClientInventoryForOutboundRequest({
        clientUserId: userProfile.uid,
        shipmentRequestId: cancellingRequest.id,
        reason,
      });

      toast({
        title: "Request cancelled",
        description: "Your outbound shipment request was cancelled and inventory was restored.",
      });
      setCancellingRequest(null);
      setCancellationReason("");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to cancel shipment request.",
      });
    } finally {
      setIsCancelling(false);
    }
  };

  const handleRemarksClick = (remarks: string) => {
    setSelectedRemarks(remarks);
    setIsRemarksDialogOpen(true);
  };

  const handleShipToClick = (shipTo: string) => {
    setSelectedShipTo(shipTo);
    setIsShipToDialogOpen(true);
  };

  const handleProductsClick = (products: Array<{productName: string, quantity: number, packOf: number, shippedQty: number, unitPrice: number}>) => {
    setSelectedProducts(products);
    setIsProductsDialogOpen(true);
  };

  const handleAdditionalServicesClick = (additionalServices: any) => {
    setSelectedAdditionalServices(additionalServices);
    setIsAdditionalServicesDialogOpen(true);
  };

  const resolveShippedDoc = (item: { shippedDocId?: string; id?: string }): ShippedItem | null => {
    const docId = String(item.shippedDocId || item.id || "").trim();
    if (!docId) return null;
    return data.find((row) => row.id === docId) ?? null;
  };

  const handleShipmentDetailsClick = (item: any) => {
    const rawRequest = item.rawRequest as ShipmentRequest | undefined;
    let payload: ShippedItem;
    let detailsItem: ShippedItem | null = null;

    if (item.isRequest && rawRequest) {
      payload = shippedItemFromShipmentRequest(rawRequest);
    } else if (rawRequest && String(item.status || "") === "Shipped") {
      // Prefer full request lines when multiple legacy shipped docs were merged.
      payload = shippedItemFromShipmentRequest(rawRequest);
      detailsItem = resolveShippedDoc(item);
    } else {
      detailsItem = resolveShippedDoc(item);
      const base = (detailsItem || item) as ShippedItem;
      const mergedItems = Array.isArray(item.items) ? item.items : base.items;
      payload = {
        ...base,
        items: mergedItems,
        productName: item.productName || base.productName,
        boxesShipped: item.boxesShipped ?? base.boxesShipped,
        shippedQty: item.shippedQty ?? base.shippedQty,
        totalBoxes: item.totalBoxes ?? (base as { totalBoxes?: number }).totalBoxes,
        totalUnits: item.totalUnits ?? (base as { totalUnits?: number }).totalUnits,
      } as ShippedItem;
    }

    setShipmentDetailsItem(detailsItem);
    setShipmentDetails(
      enrichShippedOrderDetailsFromInventory(
        buildShippedOrderDetails(payload, {
          status: item.status,
          dateLabel: formatDate(item.date),
        }),
        inventory
      )
    );
    setIsShipmentDetailsOpen(true);
  };

  const handleDeleteShipped = async () => {
    if (!deleteTarget || !admin?.onDeleteShippedOrder) return;
    setIsDeletingShipped(true);
    try {
      await admin.onDeleteShippedOrder(deleteTarget);
      setDeleteTarget(null);
    } finally {
      setIsDeletingShipped(false);
    }
  };

  const adminCorrection: ShippedOrderCorrectionContext | null =
    isAdminView && admin && shipmentDetailsItem?.id
      ? {
          userId: admin.clientUserId,
          shippedId: shipmentDetailsItem.id,
          inventory,
          getAuthToken: admin.getAuthToken,
          onCorrected: admin.onCorrected,
        }
      : null;

  const uploadOneLabelForRequest = async (file: File): Promise<string> => {
    if (!userProfile?.uid) throw new Error("User profile is missing.");
    const currentDate = new Date();
    const clientName =
      String(userProfile.name || userProfile.email || userProfile.uid || "client")
        .replace(/[\\/:*?"<>|]/g, "_")
        .trim() || "client";
    const formData = new FormData();
    formData.append("file", file);
    formData.append("clientName", clientName);
    if (file.name) {
      formData.append("fileName", file.name);
    }
    const year = currentDate.getFullYear().toString();
    const month = currentDate.toLocaleString("en-US", { month: "long" });
    const dateStr = currentDate.toISOString().split("T")[0];
    formData.append("folderPath", `${year}/${month}/${clientName}/${dateStr}`);

    const response = await fetch("/api/onedrive/upload", { method: "POST", body: formData });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Label upload failed.");
    }
    const result = await response.json();
    const urlToStore = result.webUrl || result.downloadURL;
    if (!urlToStore) throw new Error("Label upload failed.");
    return urlToStore;
  };

  const handleDirectLabelUpload = async () => {
    if (!selectedUploadRequest?.id || !userProfile?.uid) return;
    if (uploadFiles.length === 0) {
      toast({
        variant: "destructive",
        title: "No files selected",
        description: "Please choose one or more label files.",
      });
      return;
    }
    setIsUploadingLabel(true);
    try {
      const uploadedUrls: string[] = [];
      for (const file of uploadFiles) {
        const uploadedUrl = await uploadOneLabelForRequest(file);
        uploadedUrls.push(uploadedUrl);
      }
      const existingUrls = String(selectedUploadRequest.labelUrl || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const allUrls = Array.from(new Set([...existingUrls, ...uploadedUrls]));

      if (
        selectedUploadRequest.fbaLabelWorkflow ||
        isFbaLabelWorkflowRequest(selectedUploadRequest as unknown as Record<string, unknown>)
      ) {
        await recordFbaLabelUpload({
          clientUserId: userProfile.uid,
          shipmentRequestId: selectedUploadRequest.id,
          labelUrls: uploadedUrls,
          uploadedBy: "client",
          warehouseId: String((selectedUploadRequest as ShipmentRequest).warehouseId ?? ""),
        });
      } else {
        await updateDoc(doc(db, `users/${userProfile.uid}/shipmentRequests`, selectedUploadRequest.id), {
          labelUrl: allUrls.join(","),
          labelUploadedAt: Timestamp.now(),
        });
      }

      toast({
        title: "Label uploaded",
        description: uploadedUrls.length === 1
          ? "Label uploaded successfully."
          : `${uploadedUrls.length} labels uploaded successfully.`,
      });
      setSelectedUploadRequest(null);
      setUploadFiles([]);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: error?.message || "Failed to upload label.",
      });
    } finally {
      setIsUploadingLabel(false);
    }
  };

  // Combine shipped items, pending, and rejected shipment requests into one list
  const combinedData = useMemo(() => {
    /** One table row per outbound request (not per product line). */
    const convertRequestToDisplay = (req: ShipmentRequest, status: ShippedRowStatus) => {
      const shipments = Array.isArray(req.shipments) ? req.shipments : [];
      const activeLines = shipments.filter((s) => !Boolean((s as { warehouseLineRemoved?: boolean }).warehouseLineRemoved));
      const lines = activeLines.length > 0 ? activeLines : shipments;

      let totalBoxes = 0;
      let totalUnits = 0;
      const packSizes = new Set<number>();
      const productNames: string[] = [];
      const editNotices: string[] = [];
      let isPrepOutbound = Boolean((req as { isPrepOutbound?: boolean }).isPrepOutbound);
      let additionalServices =
        (req as { additionalServices?: unknown }).additionalServices ??
        (req as { selectedAdditionalServices?: unknown }).selectedAdditionalServices;

      for (const shipment of lines) {
        const boxes = Math.max(0, Math.floor(Number(shipment.quantity) || 0));
        const packOf = Math.max(1, Math.floor(Number(shipment.packOf) || 1));
        totalBoxes += boxes;
        totalUnits += boxes * packOf;
        packSizes.add(packOf);

        const inventoryItem = inventory.find((item) => item.id === shipment.productId);
        const name =
          inventoryItem?.productName ||
          String(shipment.productName ?? "").trim() ||
          "Unknown Product";
        productNames.push(name);

        const notice = warehouseLineEditNotice(shipment as Record<string, unknown>);
        if (notice) editNotices.push(`${name}: ${notice}`);

        if (
          (shipment as { sourceInventoryRequestId?: string }).sourceInventoryRequestId ||
          String(shipment.productId ?? "").startsWith("prep:")
        ) {
          isPrepOutbound = true;
        }
        if ((shipment as { selectedAdditionalServices?: unknown }).selectedAdditionalServices) {
          additionalServices =
            (shipment as { selectedAdditionalServices?: unknown }).selectedAdditionalServices;
        }
      }

      const uniqueNames = Array.from(
        new Set(productNames.map((n) => n.trim()).filter(Boolean))
      );
      const productName =
        uniqueNames.length === 0
          ? "Outbound request"
          : uniqueNames.length === 1
            ? uniqueNames[0]!
            : `${uniqueNames[0]} +${uniqueNames.length - 1} more`;

      return {
        id: `request-${req.id}`,
        productName,
        searchText: uniqueNames.join(" ").toLowerCase(),
        lineCount: uniqueNames.length,
        date: req.date,
        shippedQty: totalUnits,
        boxesShipped: totalBoxes,
        packOf: packSizes.size === 1 ? [...packSizes][0]! : "Mixed",
        unitPrice: 0,
        shipTo: req.shipTo || "",
        service: req.service || "FBA/WFS/TFS",
        productType: req.productType || "Standard",
        remarks:
          status === "Rejected"
            ? ((req as { rejectionReason?: string }).rejectionReason || req.remarks || "")
            : status === "Cancelled"
              ? ((req as { cancellationReason?: string }).cancellationReason || req.remarks || "")
              : (req.remarks || ""),
        status: status as ShippedRowStatus,
        isRequest: true,
        requestId: req.id,
        shipmentRequestId: req.id,
        requestStatus: req.status || "pending",
        rawRequest: req,
        isPrepOutbound,
        createdAt: req.requestedAt,
        additionalServices,
        // Client may edit/cancel only before admin approval (status pending).
        canCancelRequest: String(req.status || "pending").trim().toLowerCase() === "pending",
        canEditRequest: String(req.status || "pending").trim().toLowerCase() === "pending",
        warehouseLineEditNotice:
          editNotices.length === 0
            ? null
            : editNotices.length === 1
              ? editNotices[0]
              : `${editNotices.length} lines updated by warehouse`,
        warehouseLineEditReason: null,
      };
    };

    const shippedRequestIds = new Set<string>();
    data.forEach((item) => {
      const id = String((item as { shipmentRequestId?: string }).shipmentRequestId ?? "").trim();
      if (id) shippedRequestIds.add(id);
    });

    // Open outbound requests (pending admin, confirmed/awaiting ship, or awaiting FBA label)
    const pendingItems: any[] = [];
    pendingShipmentRequests
      .filter(isOpenUndispatchedShipmentRequest)
      .forEach((req) => {
        const rowStatus = displayStatusForOpenRequest(req.status);
        pendingItems.push({
          ...convertRequestToDisplay(req, rowStatus),
          rowKey: `pending-${req.id}`,
        });
      });

    // Warehouse dispatched but no row in `shipped` yet (legacy sync gap)
    const dispatchedFallbackItems: any[] = [];
    pendingShipmentRequests
      .filter((req) => isWarehouseDispatchedRequest(req as unknown as Record<string, unknown>))
      .filter((req) => !shippedRequestIds.has(req.id))
      .forEach((req) => {
        const dispatchDate =
          (req as { warehouseDispatchedAt?: unknown }).warehouseDispatchedAt ||
          (req as { warehouseDispatchedClientSyncAt?: unknown }).warehouseDispatchedClientSyncAt ||
          req.confirmedAt ||
          req.date;
        dispatchedFallbackItems.push({
          ...convertRequestToDisplay(req, "Shipped"),
          date: dispatchDate,
          status: "Shipped" as const,
          isRequest: false,
          rowKey: `dispatch-fallback-${req.id}`,
        });
      });

    const rejectedItems: any[] = [];
    pendingShipmentRequests
      .filter((req) => req.status?.toLowerCase() === "rejected")
      .forEach((req) => {
        rejectedItems.push({
          ...convertRequestToDisplay(req, "Rejected"),
          rowKey: `rejected-${req.id}`,
        });
      });

    const cancelledItems: any[] = [];
    pendingShipmentRequests
      .filter((req) => req.status === "cancelled")
      .forEach((req) => {
        cancelledItems.push({
          ...convertRequestToDisplay(req, "Cancelled"),
          rowKey: `cancelled-${req.id}`,
        });
      });

    /** Build one display row from one or more shipped docs (legacy = 1 doc per SKU). */
    const buildShippedOrderRow = (docs: ShippedItem[], groupKey: string) => {
      const sorted = [...docs].sort((a, b) => rowSortTimeMs(b) - rowSortTimeMs(a));
      const primary = sorted[0]!;
      const mergedLines: Array<Record<string, unknown>> = [];
      const packSizes = new Set<number>();
      const searchNames: string[] = [];
      let sumBoxes = 0;
      let sumUnits = 0;

      for (const docRow of sorted) {
        const lines = Array.isArray(docRow.items) ? docRow.items : [];
        if (lines.length > 0) {
          for (const it of lines) {
            const boxes = Math.max(0, Math.floor(Number(it.boxesShipped) || 0));
            const pack = Math.max(1, Math.floor(Number(it.packOf) || Number(docRow.packOf) || 1));
            const units = Math.max(0, Math.floor(Number(it.shippedQty) || boxes * pack));
            sumBoxes += boxes;
            sumUnits += units;
            packSizes.add(pack);
            const name = String(it.productName || "").trim();
            if (name) searchNames.push(name);
            mergedLines.push({ ...it });
          }
        } else {
          const boxes = Math.max(
            0,
            Math.floor(
              Number((docRow as { totalBoxes?: number; boxesShipped?: number }).totalBoxes) ||
                Number(docRow.boxesShipped) ||
                0
            )
          );
          const pack = Math.max(1, Math.floor(Number(docRow.packOf) || 1));
          const units = Math.max(
            0,
            Math.floor(
              Number((docRow as { totalUnits?: number; shippedQty?: number }).totalUnits) ||
                Number(docRow.shippedQty) ||
                boxes * pack
            )
          );
          sumBoxes += boxes;
          sumUnits += units;
          packSizes.add(pack);
          const name = String(docRow.productName || "").trim();
          if (name) searchNames.push(name);
          mergedLines.push({
            productName: name || "Product",
            boxesShipped: boxes,
            shippedQty: units,
            packOf: pack,
            unitPrice: docRow.unitPrice || 0,
          });
        }
      }

      const uniqueNames = Array.from(new Set(searchNames.map((n) => n.trim()).filter(Boolean)));
      const productName =
        uniqueNames.length === 0
          ? String(primary.productName || "Shipped order").trim() || "Shipped order"
          : uniqueNames.length === 1
            ? uniqueNames[0]!
            : `${uniqueNames[0]} +${uniqueNames.length - 1} more`;

      const reqId = String(
        (primary as { shipmentRequestId?: string }).shipmentRequestId ?? ""
      ).trim();
      const linkedRequest = reqId
        ? pendingShipmentRequests.find((r) => r.id === reqId) ?? null
        : null;

      return {
        ...primary,
        shippedDocId: primary.id,
        shippedDocIds: sorted.map((d) => d.id).filter(Boolean),
        id: reqId ? `shipped-req-${reqId}` : `shipped-doc-${String(primary.id || groupKey)}`,
        rowKey: reqId ? `shipped-req-${reqId}` : `shipped-doc-${String(primary.id || groupKey)}`,
        shipmentRequestId: reqId || null,
        requestId: reqId || undefined,
        rawRequest: linkedRequest,
        items: mergedLines,
        productName,
        searchText: uniqueNames.join(" ").toLowerCase(),
        lineCount: Math.max(1, uniqueNames.length || mergedLines.length || 1),
        shippedQty: sumUnits,
        boxesShipped: sumBoxes,
        totalBoxes: sumBoxes,
        totalUnits: sumUnits,
        packOf: packSizes.size === 1 ? [...packSizes][0]! : "Mixed",
        status: "Shipped" as const,
        isRequest: false,
        additionalServices:
          primary.additionalServices ||
          (primary as { selectedAdditionalServices?: unknown }).selectedAdditionalServices,
      };
    };

    // One row per outbound request. Legacy data often wrote one `shipped` doc per SKU.
    const shippedItems: any[] = [];
    const shippedGroups = new Map<string, ShippedItem[]>();
    const orphanShipped: ShippedItem[] = [];

    for (const item of data) {
      const reqId = String(
        (item as { shipmentRequestId?: string }).shipmentRequestId ?? ""
      ).trim();
      if (reqId) {
        const list = shippedGroups.get(reqId) ?? [];
        list.push(item);
        shippedGroups.set(reqId, list);
      } else {
        orphanShipped.push(item);
      }
    }

    for (const [reqId, docs] of shippedGroups) {
      shippedItems.push(buildShippedOrderRow(docs, reqId));
    }
    for (const item of orphanShipped) {
      shippedItems.push(buildShippedOrderRow([item], String(item.id || shippedItems.length)));
    }

    // Combine and sort by ship Date column (most recent first)
    const allItems = [
      ...pendingItems,
      ...rejectedItems,
      ...cancelledItems,
      ...dispatchedFallbackItems,
      ...shippedItems,
    ];

    const sortedItems = allItems.sort(compareRowsByDateDesc);

    // Show "Last restocked" only once per product (on the first/latest row)
    // and guarantee unique React keys even if source data collides.
    const seenProducts = new Set<string>();
    const seenKeys = new Set<string>();
    return sortedItems.map((item, index) => {
      const productKey = String(item.productName || "").trim().toLowerCase();
      const showLastRestock = productKey ? !seenProducts.has(productKey) : false;
      if (productKey && showLastRestock) {
        seenProducts.add(productKey);
      }
      let rowKey = String(
        (item as { rowKey?: string }).rowKey || item.id || `row-${index}`
      ).trim();
      if (!rowKey || seenKeys.has(rowKey)) {
        rowKey = `${rowKey || "row"}__${index}`;
      }
      seenKeys.add(rowKey);
      return { ...item, showLastRestock, rowKey };
    });
  }, [data, pendingShipmentRequests, inventory]);

  const pendingTabCount = useMemo(
    () => combinedData.filter((item) => rowMatchesStatusFilter(item, STATUS_URL_PENDING)).length,
    [combinedData]
  );
  const shippedTabCount = useMemo(
    () => combinedData.filter((item) => rowMatchesStatusFilter(item, STATUS_URL_SHIPPED)).length,
    [combinedData]
  );
  const rejectedTabCount = useMemo(
    () => combinedData.filter((item) => rowMatchesStatusFilter(item, STATUS_URL_REJECTED)).length,
    [combinedData]
  );
  const cancelledTabCount = useMemo(
    () => combinedData.filter((item) => rowMatchesStatusFilter(item, STATUS_URL_CANCELLED)).length,
    [combinedData]
  );

  // Filtered data — date-wise within the active tab (newest calendar day first)
  const filteredData = useMemo(() => {
    const filtered = combinedData.filter((item) => {
      const q = searchTerm.toLowerCase().trim();
      const haystack = String(
        (item as { searchText?: string }).searchText || item.productName || ""
      ).toLowerCase();
      const matchesSearch = !q || haystack.includes(q) || item.productName.toLowerCase().includes(q);
      const matchesStatus = rowMatchesStatusFilter(item, statusFilter);

      let matchesDate = true;
      if (dateFilter !== "all") {
        const itemDateMs = rowSortTimeMs(item);
        const itemDate = new Date(itemDateMs || 0);
        const now = new Date();
        const daysDiff = Math.floor((now.getTime() - itemDate.getTime()) / (1000 * 60 * 60 * 24));
        
        switch (dateFilter) {
          case "today":
            matchesDate = daysDiff === 0;
            break;
          case "week":
            matchesDate = daysDiff <= 7;
            break;
          case "month":
            matchesDate = daysDiff <= 30;
            break;
          case "year":
            matchesDate = daysDiff <= 365;
            break;
        }
      }
      
      return matchesSearch && matchesDate && matchesStatus;
    });

    return [...filtered].sort(compareRowsByDateDesc);
  }, [combinedData, searchTerm, dateFilter, statusFilter]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedData = filteredData.slice(startIndex, endIndex);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, dateFilter, statusFilter]);

  const createInvoiceButton = (item: any) => {
    if (!admin?.onCreateInvoice || item.isRequest || item.status !== "Shipped") return null;
    const shippedDoc = resolveShippedDoc(item);
    if (!shippedDoc) return null;
    const allowCreate = admin.allowPrepcorexCreateInvoice !== false;
    if (shippedNeedsOutboundInvoice(shippedDoc, { allowPrepcorexCreateInvoice: allowCreate })) {
      return (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-8 shrink-0 gap-1 text-xs"
          title="Create invoice for this shipped order"
          onClick={() => admin.onCreateInvoice?.(shippedDoc)}
        >
          <FileText className="h-3.5 w-3.5" />
          Create Invoice
        </Button>
      );
    }
    // Lazy import of CRM helper gate via same pending check when Create Invoice is off.
    if (
      !allowCreate &&
      !shippedDoc.invoiceId &&
      !shippedDoc.crmExternalInvoiceId &&
      String(shippedDoc.invoiceStatus || "").trim().toLowerCase() === "pending"
    ) {
      return (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-8 shrink-0 gap-1 text-xs"
          title="Add services and append to CRM draft invoice"
          onClick={() => admin.onCreateInvoice?.(shippedDoc)}
        >
          <FileText className="h-3.5 w-3.5" />
          Add services → CRM
        </Button>
      );
    }
    return null;
  };

  const deleteShippedButton = (item: any) => {
    if (!admin?.onDeleteShippedOrder || item.isRequest || item.status !== "Shipped") return null;
    const shippedDoc = resolveShippedDoc(item);
    if (!shippedDoc) return null;
    return (
      <AlertDialog
        open={deleteTarget?.id === shippedDoc.id}
        onOpenChange={(open) => !open && !isDeletingShipped && setDeleteTarget(null)}
      >
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={() => setDeleteTarget(shippedDoc)}
            title="Delete shipped order"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete shipped order?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove this shipped order record for &quot;{item.productName}&quot;? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingShipped}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeletingShipped}
              onClick={() => void handleDeleteShipped()}
            >
              {isDeletingShipped ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  };

  const content = (
    <>
      {!embedded ? (
      <CardHeader className="pb-2 sm:pb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <CardTitle className="text-base sm:text-lg lg:text-xl">
              Ship orders
              <span className="text-sm font-normal text-muted-foreground ml-2">
                ({filteredData.length}{" "}
                {statusFilter === STATUS_URL_SHIPPED
                  ? "shipped"
                  : statusFilter === STATUS_URL_REJECTED
                    ? "rejected"
                    : statusFilter === STATUS_URL_CANCELLED
                      ? "cancelled"
                      : "pending"}
                )
              </span>
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              One row per outbound request. Use the tabs for pending, shipped, rejected, or cancelled.
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            {pendingCount > 0 && statusFilter === STATUS_URL_SHIPPED ? (
              <Badge variant="outline" className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {pendingCount} awaiting ship
              </Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>
      ) : null}
      <CardContent className={embedded ? "p-0 sm:p-6" : "p-0 sm:p-6"}>
        {/* Tabs + search / date filter */}
        <div className="flex flex-col gap-4 mb-6 px-6">
          <Tabs
            value={statusFilter}
            onValueChange={(value) => {
              setStatusFilter(value);
              setCurrentPage(1);
            }}
          >
            <TabsList className="grid w-full max-w-3xl grid-cols-2 sm:grid-cols-4 bg-muted/80 p-1 h-auto gap-1">
              <TabsTrigger
                value={STATUS_URL_PENDING}
                className="data-[state=active]:bg-amber-500 data-[state=active]:text-white data-[state=active]:shadow-sm data-[state=inactive]:text-amber-900/70 hover:text-amber-950"
              >
                Pending ({pendingTabCount})
              </TabsTrigger>
              <TabsTrigger
                value={STATUS_URL_SHIPPED}
                className="data-[state=active]:bg-sky-600 data-[state=active]:text-white data-[state=active]:shadow-sm data-[state=inactive]:text-sky-900/70 hover:text-sky-950"
              >
                Shipped ({shippedTabCount})
              </TabsTrigger>
              <TabsTrigger
                value={STATUS_URL_REJECTED}
                className="data-[state=active]:bg-rose-600 data-[state=active]:text-white data-[state=active]:shadow-sm data-[state=inactive]:text-rose-900/70 hover:text-rose-950"
              >
                Rejected ({rejectedTabCount})
              </TabsTrigger>
              <TabsTrigger
                value={STATUS_URL_CANCELLED}
                className="data-[state=active]:bg-slate-600 data-[state=active]:text-white data-[state=active]:shadow-sm data-[state=inactive]:text-slate-700/70 hover:text-slate-900"
              >
                Cancelled ({cancelledTabCount})
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
            <div className="min-w-0 flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={
                    statusFilter === STATUS_URL_SHIPPED
                      ? "Search shipped orders..."
                      : statusFilter === STATUS_URL_REJECTED
                        ? "Search rejected orders..."
                        : statusFilter === STATUS_URL_CANCELLED
                          ? "Search cancelled orders..."
                          : "Search pending orders..."
                  }
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
            <div className="w-full sm:max-w-[11rem] lg:shrink-0">
              <Select
                value={dateFilter}
                onValueChange={(value) => {
                  setDateFilter(value);
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger>
                  <Filter className="h-4 w-4 mr-2 shrink-0" />
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
          </div>
        </div>

        {/* Mobile Card List */}
        <div className="block sm:hidden px-4 space-y-3">
          {filteredData.length > 0 ? (
            paginatedData.map((item, index) => (
              <div
                key={String((item as { rowKey?: string }).rowKey || item.id || `m-${index}`)}
                className="border rounded-lg p-3 bg-white"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold text-sm">{item.productName}</div>
                    {(item as { lineCount?: number }).lineCount != null &&
                    (item as { lineCount?: number }).lineCount! > 1 ? (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {(item as { lineCount?: number }).lineCount} products · open Details
                      </p>
                    ) : null}
                    {(item as { warehouseLineEditNotice?: string | null }).warehouseLineEditNotice ? (
                      <p className="mt-1 text-[11px] font-normal text-amber-800">
                        {(item as { warehouseLineEditNotice?: string | null }).warehouseLineEditNotice}
                      </p>
                    ) : null}
                    <div className="text-xs text-muted-foreground mt-1">{formatDate(item.date)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs">Shipped Units</div>
                    <div className="font-semibold text-sm">{(item as any).boxesShipped ?? item.shippedQty}</div>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="text-muted-foreground">Pack</div>
                    <div className="font-medium">{item.packOf}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Ship To</div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-auto p-0 text-left justify-start text-xs"
                      onClick={() => handleShipToClick(item.shipTo || "")}
                    >
                      <span className="truncate max-w-[140px] inline-block align-middle">{item.shipTo || '-'}</span>
                      <Eye className="h-3 w-3 ml-1 inline-block align-middle" />
                    </Button>
                  </div>
                </div>
                {item.remarks && (
                  <div className="mt-2">
                    <div className="text-xs text-muted-foreground">Remarks</div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-auto p-0 text-left justify-start text-xs"
                      onClick={() => handleRemarksClick(item.remarks || "")}
                    >
                      <span className="truncate max-w-[200px] inline-block align-middle">{item.remarks}</span>
                      <Eye className="h-3 w-3 ml-1 inline-block align-middle" />
                    </Button>
                  </div>
                )}
                {(() => {
                  if (!(item as any).showLastRestock) return null;
                  const latest = latestRestockByProduct.get(item.productName);
                  if (!latest) return null;
                  const text = `${formatRestockDate(latest.restockedAt)} (+${latest.restockedQuantity})`;
                  return (
                    <div className="mt-2">
                      <div className="text-xs text-muted-foreground">Last restocked</div>
                      {latest.restockedBy ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-xs cursor-default">{text}</span>
                          </TooltipTrigger>
                          <TooltipContent>Restocked by {latest.restockedBy}</TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-xs">{text}</span>
                      )}
                    </div>
                  );
                })()}
                <div className="mt-2">
                  <div className="text-xs text-muted-foreground">Status</div>
                  {isAwaitingFulfillmentRowStatus((item as any).status) ? (
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <OpenOutboundStatusBadge status={String((item as any).status)} />
                      {(item as any).isPrepOutbound ? (
                        <Badge
                          variant="outline"
                          className="border-amber-400 text-amber-800 w-fit"
                        >
                          Pre outbound
                        </Badge>
                      ) : null}
                    </div>
                  ) : (item as any).status === "Rejected" ? (
                    <Badge variant="destructive" className="flex items-center gap-1 w-fit mt-1">
                      <XCircle className="h-3 w-3" />
                      Rejected
                    </Badge>
                  ) : (item as any).status === "Cancelled" ? (
                    <Badge variant="secondary" className="flex items-center gap-1 w-fit mt-1">
                      <Trash2 className="h-3 w-3" />
                      Cancelled
                    </Badge>
                  ) : (
                    <Badge variant="default" className="w-fit mt-1">Shipped</Badge>
                  )}
                  <div className="mt-2 flex flex-row flex-nowrap items-center gap-1.5 overflow-x-auto">
                    {!isAdminView && (item as any).canEditRequest && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 shrink-0 text-xs"
                        onClick={() => setEditingRequest((item as any).rawRequest as ShipmentRequest)}
                      >
                        <Pencil className="h-3 w-3 mr-1" />
                        Edit
                      </Button>
                    )}
                    {!isAdminView && (item as any).canCancelRequest && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 shrink-0 text-xs text-destructive border-destructive/40 hover:text-destructive"
                        onClick={() => {
                          setCancellingRequest((item as any).rawRequest as ShipmentRequest);
                          setCancellationReason("");
                        }}
                      >
                        <Trash2 className="h-3 w-3 mr-1" />
                        Cancel
                      </Button>
                    )}
                    {!isAdminView &&
                      (item as any).isRequest &&
                      ((item as any).requestStatus === "awaiting_label_upload" ||
                        ((((item as any).rawRequest?.fbaMasterCases?.length > 0 ||
                          (item as any).rawRequest?.fbaPallets?.length > 0) &&
                          (item as any).rawRequest?.fbaLabelWorkflow))) && (
                      <Button
                        size="sm"
                        className="h-7 shrink-0 text-xs"
                        onClick={() => {
                          setSelectedUploadRequest((item as any).rawRequest as ShipmentRequest);
                          setUploadFiles([]);
                        }}
                      >
                        {(item as any).rawRequest?.fbaMasterCases?.length ||
                        (item as any).rawRequest?.fbaPallets?.length
                          ? "Upload label"
                          : "Upload Label"}
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 gap-1 text-xs"
                      onClick={() => handleShipmentDetailsClick(item)}
                    >
                      <FileText className="h-3 w-3" />
                      Details
                    </Button>
                    {createInvoiceButton(item)}
                    {(() => {
                      const shipmentId = outboundVideoShipmentId(item as any);
                      if (!shipmentId || !recordedShipmentIds.has(shipmentId)) return null;
                      return (
                        <OutboundShipmentVideoDialog
                          shipmentRequestId={shipmentId}
                          clientUserId={clientUserId}
                          triggerLabel="Watch outbound video"
                        />
                      );
                    })()}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-8 text-xs text-gray-500">
              {combinedData.length === 0 ? "No shipped orders or pending requests found." : "No orders match your search criteria."}
            </div>
          )}
        </div>

        {/* Desktop/Table View */}
        <div className="hidden sm:block">
        <Table containerClassName="overflow-x-auto overflow-y-hidden mouse-h-scroll">
          <TableHeader>
            <TableRow>
                  <TableHead className="text-xs sm:text-sm">Product</TableHead>
                  <TableHead className="text-xs sm:text-sm hidden sm:table-cell">Date</TableHead>
                  <TableHead className="text-xs sm:text-sm hidden sm:table-cell">Shipped</TableHead>
                  <TableHead className="text-xs sm:text-sm hidden md:table-cell">Pack</TableHead>
                  <TableHead className="text-xs sm:text-sm hidden md:table-cell">Service</TableHead>
                  <TableHead className="text-xs sm:text-sm hidden md:table-cell">Product Type</TableHead>
                  <TableHead className="text-xs sm:text-sm hidden md:table-cell">Ship To</TableHead>
                  <TableHead className="text-xs sm:text-sm hidden lg:table-cell">Remarks</TableHead>
                  <TableHead className="text-xs sm:text-sm hidden lg:table-cell">Additional Services</TableHead>
                  <TableHead className="text-xs sm:text-sm hidden md:table-cell">Last restocked</TableHead>
                  <TableHead className="text-xs sm:text-sm">Status</TableHead>
                  <TableHead className="text-xs sm:text-sm text-right">Details</TableHead>
                  {admin?.onDeleteShippedOrder || admin?.onCreateInvoice ? (
                    <TableHead className="text-xs sm:text-sm text-right w-12">Actions</TableHead>
                  ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
                {filteredData.length > 0 ? (
                  paginatedData.map((item, index) => (
                    <TableRow
                      key={String((item as { rowKey?: string }).rowKey || item.id || `t-${index}`)}
                      className="text-xs sm:text-sm"
                    >
                      <TableCell className="font-medium max-w-32 sm:max-w-none truncate">
                        <div className="flex flex-col sm:block">
                          <span className="font-medium">{item.productName}</span>
                          {(item as { lineCount?: number }).lineCount != null &&
                          (item as { lineCount?: number }).lineCount! > 1 ? (
                            <p className="mt-0.5 text-[11px] font-normal text-muted-foreground">
                              {(item as { lineCount?: number }).lineCount} products · open Details
                            </p>
                          ) : null}
                          {(item as { warehouseLineEditNotice?: string | null }).warehouseLineEditNotice ? (
                            <p className="mt-1 text-[11px] font-normal text-amber-800 dark:text-amber-200">
                              {(item as { warehouseLineEditNotice?: string | null }).warehouseLineEditNotice}
                            </p>
                          ) : null}
                          <div className="sm:hidden mt-1 space-y-0.5 text-xs text-gray-500">
                            <span>{formatDate(item.date)}</span>
                            <br />
                            <span>Shipped Units: {(item as any).boxesShipped ?? item.shippedQty}</span>
                            <br />
                            <span>Pack: {item.packOf}</span>
                            <br />
                            <span>Service: {formatServiceLabel((item as any).service)}</span>
                            <br />
                            <span>Product Type: {(item as any).productType === "Standard"
                              ? "Standard (6x6x6)"
                              : (item as any).productType === "Large"
                              ? "Large (10x10x10)"
                              : (item as any).productType || "N/A"}</span>
                            {(() => {
                              const additionalServices = (item as any).additionalServices;
                              const hasServices = additionalServices && (
                                (Array.isArray(additionalServices) && additionalServices.length > 0) ||
                                (typeof additionalServices === 'object' && (
                                  additionalServices.bubbleWrapFeet > 0 ||
                                  additionalServices.stickerRemovalItems > 0 ||
                                  additionalServices.warningLabels > 0
                                ))
                              );
                              return hasServices ? (
                                <>
                                  <br />
                                  <div className="flex items-center gap-1">
                                    <span className="font-semibold">Additional Services:</span>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-auto p-0 text-xs text-gray-500"
                                      onClick={() => handleAdditionalServicesClick(additionalServices)}
                                    >
                                      <Eye className="h-3 w-3 ml-1 flex-shrink-0" />
                                    </Button>
                                  </div>
                                </>
                              ) : null;
                            })()}
                            <br />
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-auto p-0 text-left justify-start text-xs text-gray-500"
                              onClick={() => handleShipToClick(item.shipTo || "")}
                            >
                              <span>Ship To: {item.shipTo}</span>
                              <Eye className="h-3 w-3 ml-1 flex-shrink-0" />
                            </Button>
                            {item.remarks && (
                              <>
                                <br />
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-auto p-0 text-left justify-start text-xs text-gray-500"
                                  onClick={() => handleRemarksClick(item.remarks || "")}
                                >
                                  <span>Remarks: {item.remarks}</span>
                                  <Eye className="h-3 w-3 ml-1 flex-shrink-0" />
                                </Button>
                              </>
                            )}
                            <br />
                            <span>
                              Status: {isAwaitingFulfillmentRowStatus((item as any).status) ? (
                                <span className="ml-1 inline-flex">
                                  <OpenOutboundStatusBadge status={String((item as any).status)} />
                                </span>
                              ) : (item as any).status === "Rejected" ? (
                                <Badge variant="destructive" className="ml-1">
                                  <XCircle className="h-3 w-3 mr-1" />
                                  Rejected
                                </Badge>
                              ) : (item as any).status === "Cancelled" ? (
                                <Badge variant="secondary" className="ml-1">
                                  <Trash2 className="h-3 w-3 mr-1" />
                                  Cancelled
                                </Badge>
                              ) : (
                                <Badge variant="default" className="ml-1">Shipped</Badge>
                              )}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <span className="text-xs">{formatDate(item.date)}</span>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">{(item as any).boxesShipped ?? item.shippedQty}</TableCell>
                      <TableCell className="hidden md:table-cell">{item.packOf}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        {formatServiceLabel((item as any).service)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {(item as any).productType === "Standard"
                          ? "Standard (6x6x6)"
                          : (item as any).productType === "Large"
                          ? "Large (10x10x10)"
                          : (item as any).productType || "N/A"}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto p-1 text-left justify-start max-w-20 truncate"
                          onClick={() => handleShipToClick(item.shipTo || "")}
                        >
                          <span className="truncate">{item.shipTo}</span>
                          <Eye className="h-3 w-3 ml-1 flex-shrink-0" />
                        </Button>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {item.remarks ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-auto p-1 text-left justify-start max-w-20 truncate"
                            onClick={() => handleRemarksClick(item.remarks || "")}
                          >
                            <span className="truncate">{item.remarks}</span>
                            <Eye className="h-3 w-3 ml-1 flex-shrink-0" />
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {(() => {
                          const additionalServices = (item as any).additionalServices;
                          const hasServices = additionalServices && (
                            (Array.isArray(additionalServices) && additionalServices.length > 0) ||
                            (typeof additionalServices === 'object' && (
                              additionalServices.bubbleWrapFeet > 0 ||
                              additionalServices.stickerRemovalItems > 0 ||
                              additionalServices.warningLabels > 0
                            ))
                          );
                          return hasServices ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-auto p-1"
                              onClick={() => handleAdditionalServicesClick(additionalServices)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground">
                        {(() => {
                          if (!(item as any).showLastRestock) return <span>—</span>;
                          const latest = latestRestockByProduct.get(item.productName);
                          if (!latest) return <span>—</span>;
                          const text = `${formatRestockDate(latest.restockedAt)} (+${latest.restockedQuantity})`;
                          return latest.restockedBy ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-default">{text}</span>
                              </TooltipTrigger>
                              <TooltipContent>Restocked by {latest.restockedBy}</TooltipContent>
                            </Tooltip>
                          ) : (
                            <span>{text}</span>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        {isAwaitingFulfillmentRowStatus((item as any).status) ? (
                          <div className="space-y-2">
                            <OpenOutboundStatusBadge status={String((item as any).status)} />
                            <div className="flex flex-wrap items-center gap-1.5">
                              {!isAdminView && (item as any).canEditRequest ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 shrink-0 gap-1 text-xs"
                                  onClick={() =>
                                    setEditingRequest((item as any).rawRequest as ShipmentRequest)
                                  }
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                  Edit
                                </Button>
                              ) : null}
                              {!isAdminView && (item as any).canCancelRequest ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 shrink-0 gap-1 text-xs text-destructive border-destructive/40 hover:text-destructive"
                                  onClick={() => {
                                    setCancellingRequest((item as any).rawRequest as ShipmentRequest);
                                    setCancellationReason("");
                                  }}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  Cancel
                                </Button>
                              ) : null}
                              {!isAdminView &&
                              (item as any).isRequest &&
                              ((item as any).requestStatus === "awaiting_label_upload" ||
                                ((((item as any).rawRequest?.fbaMasterCases?.length > 0 ||
                                  (item as any).rawRequest?.fbaPallets?.length > 0) &&
                                  (item as any).rawRequest?.fbaLabelWorkflow))) ? (
                                <Button
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => {
                                    setSelectedUploadRequest((item as any).rawRequest as ShipmentRequest);
                                    setUploadFiles([]);
                                  }}
                                >
                                  Upload Label
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        ) : (item as any).status === "Rejected" ? (
                          <Badge variant="destructive" className="flex items-center gap-1 w-fit">
                            <XCircle className="h-3 w-3" />
                            Rejected
                          </Badge>
                        ) : (item as any).status === "Cancelled" ? (
                          <Badge variant="secondary" className="flex items-center gap-1 w-fit">
                            <Trash2 className="h-3 w-3" />
                            Cancelled
                          </Badge>
                        ) : (
                          <Badge variant="default" className="w-fit">Shipped</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-row flex-nowrap items-center justify-end gap-1.5 whitespace-nowrap">
                          {(() => {
                            const shipmentId = outboundVideoShipmentId(item as any);
                            if (!shipmentId || !recordedShipmentIds.has(shipmentId)) return null;
                            return (
                              <OutboundShipmentVideoDialog
                                shipmentRequestId={shipmentId}
                                clientUserId={clientUserId}
                                compact
                                triggerLabel="Watch outbound video"
                              />
                            );
                          })()}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 shrink-0 gap-1 text-xs"
                            onClick={() => handleShipmentDetailsClick(item)}
                          >
                            <FileText className="h-3.5 w-3.5" />
                            Details
                          </Button>
                        </div>
                      </TableCell>
                      {admin?.onDeleteShippedOrder || admin?.onCreateInvoice ? (
                        <TableCell className="text-right">
                          <div className="flex flex-wrap items-center justify-end gap-1">
                            {createInvoiceButton(item)}
                            {deleteShippedButton(item)}
                          </div>
                        </TableCell>
                      ) : null}
                </TableRow>
              ))
            ) : (
              <TableRow>
                    <TableCell colSpan={admin?.onDeleteShippedOrder || admin?.onCreateInvoice ? 13 : 12} className="text-center py-8">
                      <div className="text-xs sm:text-sm text-gray-500">
                        {combinedData.length === 0 ? "No shipped orders or pending requests found." : "No orders match your search criteria."}
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

      {/* Shipment details (products + total) */}
      <ShippedOrderDetailsDialog
        open={isShipmentDetailsOpen}
        onOpenChange={(open) => {
          setIsShipmentDetailsOpen(open);
          if (!open) {
            setShipmentDetails(null);
            setShipmentDetailsItem(null);
          }
        }}
        details={shipmentDetails}
        allowCorrectWarehouseProduct={Boolean(
          shipmentDetailsItem &&
            (shipmentDetailsItem.quickFulfill === true ||
              String(shipmentDetailsItem.source || "").toLowerCase() === "shopify")
        )}
        correction={adminCorrection}
      />

      {/* Remarks Dialog */}
      <Dialog open={isRemarksDialogOpen} onOpenChange={setIsRemarksDialogOpen}>
        <DialogContent className="max-w-full sm:max-w-md md:max-w-lg lg:max-w-xl xl:max-w-2xl h-[100dvh] sm:h-auto sm:max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Full Remarks</DialogTitle>
            <DialogDescription>Complete remarks for this shipment</DialogDescription>
          </DialogHeader>
          <div className="mt-4 overflow-y-auto max-h-[60vh]">
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="text-sm whitespace-pre-wrap break-words overflow-wrap-anywhere">
                {selectedRemarks || "No remarks available"}
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Ship To Dialog */}
      <Dialog open={isShipToDialogOpen} onOpenChange={setIsShipToDialogOpen}>
        <DialogContent className="max-w-full sm:max-w-md md:max-w-lg lg:max-w-xl xl:max-w-2xl h-[100dvh] sm:h-auto sm:max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Ship To Details</DialogTitle>
            <DialogDescription>Complete shipping address for this shipment</DialogDescription>
          </DialogHeader>
          <div className="mt-4 overflow-y-auto max-h-[60vh]">
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="text-sm whitespace-pre-wrap break-words overflow-wrap-anywhere">
                {selectedShipTo || "No shipping address available"}
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Products Dialog */}
      <Dialog open={isProductsDialogOpen} onOpenChange={setIsProductsDialogOpen}>
        <DialogContent className="max-w-full sm:max-w-md md:max-w-lg lg:max-w-xl xl:max-w-2xl h-[100dvh] sm:h-auto sm:max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>All Products in Shipment</DialogTitle>
            <DialogDescription>Complete list of products in this shipment order</DialogDescription>
          </DialogHeader>
          <div className="mt-4 overflow-y-auto max-h-[60vh]">
            <div className="space-y-4">
              {selectedProducts.map((product, index) => (
                <div key={index} className="bg-gray-50 p-4 rounded-lg border">
                  <div className="font-semibold text-sm mb-2">{product.productName}</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Quantity (Boxes):</span>
                      <span className="ml-2 font-medium">{product.quantity}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Pack Of:</span>
                      <span className="ml-2 font-medium">{product.packOf}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Total Units:</span>
                      <span className="ml-2 font-medium">{product.shippedQty}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Unit Price:</span>
                      <span className="ml-2 font-medium">${product.unitPrice.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Additional Services Dialog */}
      <Dialog open={isAdditionalServicesDialogOpen} onOpenChange={setIsAdditionalServicesDialogOpen}>
        <DialogContent className="max-w-full sm:max-w-md md:max-w-lg lg:max-w-xl xl:max-w-2xl h-[100dvh] sm:h-auto sm:max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Additional Services</DialogTitle>
            <DialogDescription>Complete list of additional services for this shipment</DialogDescription>
          </DialogHeader>
          <div className="mt-4 overflow-y-auto max-h-[60vh]">
            <div className="bg-gray-50 p-4 rounded-lg">
              {selectedAdditionalServices ? (
                <div className="space-y-3">
                  {Array.isArray(selectedAdditionalServices) ? (
                    // New array format
                    selectedAdditionalServices.length > 0 ? (
                      selectedAdditionalServices.map((service: string, index: number) => (
                        <div key={index} className="text-sm">
                          <span className="font-medium">• </span>
                          <span className="capitalize">
                            {service === "bubbleWrap" ? "Bubble Wrap" :
                             service === "stickerRemoval" ? "Sticker Removal" :
                             service === "warningLabels" ? "Warning Labels" :
                             service}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">No additional services selected</p>
                    )
                  ) : (
                    // Old object format
                    <>
                      {selectedAdditionalServices.bubbleWrapFeet > 0 && (
                        <div className="text-sm">
                          <span className="font-medium">• Bubble Wrap:</span>
                          <span className="ml-2">{selectedAdditionalServices.bubbleWrapFeet} feet</span>
                        </div>
                      )}
                      {selectedAdditionalServices.stickerRemovalItems > 0 && (
                        <div className="text-sm">
                          <span className="font-medium">• Sticker Removal:</span>
                          <span className="ml-2">{selectedAdditionalServices.stickerRemovalItems} items</span>
                        </div>
                      )}
                      {selectedAdditionalServices.warningLabels > 0 && (
                        <div className="text-sm">
                          <span className="font-medium">• Warning Labels:</span>
                          <span className="ml-2">{selectedAdditionalServices.warningLabels} labels</span>
                        </div>
                      )}
                      {(!selectedAdditionalServices.bubbleWrapFeet || selectedAdditionalServices.bubbleWrapFeet === 0) &&
                       (!selectedAdditionalServices.stickerRemovalItems || selectedAdditionalServices.stickerRemovalItems === 0) &&
                       (!selectedAdditionalServices.warningLabels || selectedAdditionalServices.warningLabels === 0) && (
                        <p className="text-sm text-muted-foreground">No additional services selected</p>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No additional services available</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ClientPendingOutboundEditDialog
        open={editingRequest !== null}
        onOpenChange={(open) => {
          if (!open) setEditingRequest(null);
        }}
        request={editingRequest}
        clientUserId={userProfile?.uid || ""}
        editedBy={user?.uid || userProfile?.uid || ""}
        inventory={inventory}
      />

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
            <DialogTitle>Cancel outbound request?</DialogTitle>
            <DialogDescription>
              This will mark your pending shipment request as cancelled. You cannot undo this action.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="outbound-cancellation-reason">
              Why are you cancelling? <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="outbound-cancellation-reason"
              value={cancellationReason}
              onChange={(e) => setCancellationReason(e.target.value)}
              placeholder="e.g. wrong products selected, shipment no longer needed, incorrect ship-to address..."
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
              onClick={() => void handleCancelShipmentRequest()}
            >
              {isCancelling ? "Cancelling..." : "Cancel request"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Direct Upload Label Dialog */}
      <Dialog
        open={!!selectedUploadRequest}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedUploadRequest(null);
            setUploadFiles([]);
          }
        }}
      >
        <DialogContent className="max-w-full sm:max-w-md md:max-w-lg lg:max-w-xl xl:max-w-2xl h-[100dvh] sm:h-auto sm:max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Upload Shipping Label</DialogTitle>
            <DialogDescription>
              {selectedUploadRequest?.fbaMasterCases?.length ||
              selectedUploadRequest?.fbaPallets?.length
                ? "Use the pack dimensions below to generate your label, then upload it here."
                : "Upload label directly for this approved request. No need to submit a new request."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            {selectedUploadRequest?.fbaMasterCases?.length ||
            selectedUploadRequest?.fbaPallets?.length ? (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <p className="text-sm font-medium">
                  {selectedUploadRequest.fbaShipMode === "ltl" ||
                  (selectedUploadRequest.fbaPallets?.length ?? 0) > 0
                    ? "Pallet / LTL details"
                    : "Master case details"}
                </p>
                {formatFbaPackDimsForClient({
                  fbaShipMode: selectedUploadRequest.fbaShipMode,
                  fbaMasterCases: selectedUploadRequest.fbaMasterCases,
                  fbaPallets: selectedUploadRequest.fbaPallets,
                }).map((line, idx) => (
                  <p key={`upload-dim-${idx}`} className="text-xs text-muted-foreground whitespace-pre-wrap">
                    {line}
                  </p>
                ))}
              </div>
            ) : null}
            <Input
              type="file"
              accept="image/*,application/pdf"
              multiple
              onChange={(e) => setUploadFiles(Array.from(e.target.files || []))}
              disabled={isUploadingLabel}
            />
            <p className="text-xs text-muted-foreground">
              {uploadFiles.length > 0 ? `${uploadFiles.length} file(s) selected` : "No files selected"}
            </p>
            <div className="flex gap-2">
              <Button
                onClick={handleDirectLabelUpload}
                disabled={isUploadingLabel || uploadFiles.length === 0}
                className="flex-1"
              >
                {isUploadingLabel ? "Uploading..." : "Upload Label"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedUploadRequest(null);
                  setUploadFiles([]);
                }}
                disabled={isUploadingLabel}
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );

  return (
    <TooltipProvider>
      {embedded ? content : <Card className="w-full">{content}</Card>}
    </TooltipProvider>
  );
}

