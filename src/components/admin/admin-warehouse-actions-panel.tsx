"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Download,
  ImagePlus,
  Loader2,
  PackageCheck,
  Plus,
  RotateCcw,
  Trash2,
  Truck,
  Warehouse,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import {
  adminAutoPickAndPackOutbound,
  adminCompleteInboundReceiveAndPutaway,
  adminDispatchOutboundWithTracking,
  adminSaveOutboundTracking,
  adminShipOutboundFromInventoryOnly,
  assessAdminOutboundBinStock,
  type AdminInboundCompleteResult,
  type AdminOutboundBinAssessment,
  hasAdminWarehouseOverride,
} from "@/lib/admin-warehouse-override";
import { listWarehouseAreas } from "@/lib/warehouse-putaway-disposition";
import { listActiveWarehouseBins } from "@/lib/warehouse-cycle-count";
import {
  findBinByPath,
  firstAvailablePutawayBin,
  inspectBinContents,
  loadOccupiedBinIds,
} from "@/lib/warehouse-putaway";
import {
  PutawayDestinationFields,
  emptyPutawayLineSlot,
  isPutawayLineSlotReady,
  type PutawayLineSlot,
} from "@/components/warehouse-ops/putaway-destination-fields";
import { restorePickOrderToQueue } from "@/lib/warehouse-pick";
import { downloadReceiveLabels } from "@/lib/warehouse-receive-label-download";
import { pushShopifyInventoryHints } from "@/lib/shopify-inventory-sync";
import { pushEbayInventoryHints } from "@/lib/ebay-inventory-sync";
import { isDefaultNj2Warehouse } from "@/lib/warehouse-display";
import { isFbaLabelWorkflowRequest } from "@/lib/fba-shipment-workflow";
import {
  expectedApprovedInboundQty,
  warehouseGoodReceivedQty,
} from "@/lib/inventory-inbound-display";
import {
  closeInventoryRequest,
  healInboundReceivedQtyFromPutawayLogs,
} from "@/lib/client-inventory-inbound-sync";
import { uploadReceivePhotos } from "@/lib/inbound-receive-photos";
import { formatExpiryForInput } from "@/lib/warehouse-inbound-requests";
import { WarehouseOutboundLineEditPanel } from "@/components/warehouse-ops/warehouse-outbound-line-edit-panel";
import { cn } from "@/lib/utils";
import type {
  InventoryRequest,
  ShipmentRequest,
  UserProfile,
  WarehouseAreaDoc,
  WarehouseBinDoc,
  WarehouseCartonLine,
  WarehouseDoc,
} from "@/types";

type AdminReceiveRemarkDraft = {
  id: string;
  text: string;
  files: File[];
};

function newRemarkDraft(): AdminReceiveRemarkDraft {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return { id, text: "", files: [] };
}

type InboundProps = {
  mode: "inbound";
  clientUserId: string;
  clientDisplayName?: string | null;
  request: InventoryRequest;
  onComplete?: () => void;
};

async function resolvePutawaySlotFromPath(
  warehouseId: string,
  binPath: string
): Promise<PutawayLineSlot> {
  const path = binPath.trim();
  const bin = await findBinByPath(warehouseId, path);
  if (!bin) {
    return {
      ...emptyPutawayLineSlot(),
      binPath: path,
      resolved: null,
      loading: false,
      error: `Bin "${path}" was not found.`,
    };
  }
  const contents = await inspectBinContents(warehouseId, bin.id);
  return {
    ...emptyPutawayLineSlot(),
    binPath: bin.path,
    resolved: { bin, contents },
    loading: false,
    error: null,
  };
}

type OutboundProps = {
  mode: "outbound";
  clientUserId: string;
  request: ShipmentRequest & { id: string };
  /** Pick/pack stage finished — refresh UI but keep dialog open. */
  onProgress?: () => void;
  /** Fully dispatched (or admin closed) — close dialog. */
  onComplete?: () => void;
};

type AdminWarehouseActionsPanelProps = InboundProps | OutboundProps;

function remainingInboundQty(req: InventoryRequest): number {
  const expected =
    typeof req.receivedQuantity === "number" && req.receivedQuantity > 0
      ? req.receivedQuantity
      : typeof req.requestedQuantity === "number" && req.requestedQuantity > 0
        ? req.requestedQuantity
        : Math.max(0, req.quantity ?? 0);
  const received = Math.max(0, Number(req.warehouseGoodReceivedQty ?? 0));
  return Math.max(0, expected - received);
}

export function AdminWarehouseActionsPanel(props: AdminWarehouseActionsPanelProps) {
  const { user, userProfile } = useAuth();
  const { toast } = useToast();
  const canOverride = hasAdminWarehouseOverride(userProfile);
  const { data: warehouses } = useCollection<WarehouseDoc>("warehouses");

  const activeWarehouses = useMemo(
    () => warehouses.filter((w) => w.active !== false),
    [warehouses]
  );

  const [warehouseId, setWarehouseId] = useState("");
  const [areas, setAreas] = useState<WarehouseAreaDoc[]>([]);
  const [bins, setBins] = useState<WarehouseBinDoc[]>([]);
  const [occupiedBinIds, setOccupiedBinIds] = useState<Set<string>>(new Set());
  const [destinationsLoading, setDestinationsLoading] = useState(false);
  const [destinationSlot, setDestinationSlot] = useState<PutawayLineSlot>(
    emptyPutawayLineSlot()
  );
  const [damagedDestinationSlot, setDamagedDestinationSlot] =
    useState<PutawayLineSlot>(emptyPutawayLineSlot());
  const [qty, setQty] = useState(0);
  const [damagedQty, setDamagedQty] = useState(0);
  const [unitType, setUnitType] = useState<"loose" | "carton" | "pallet">("carton");
  const [packageCount, setPackageCount] = useState(1);
  const [lot, setLot] = useState("");
  const [expiry, setExpiry] = useState("");
  const [carrier, setCarrier] = useState("");
  const [inboundTracking, setInboundTracking] = useState("");
  const [remarkDrafts, setRemarkDrafts] = useState<AdminReceiveRemarkDraft[]>([
    newRemarkDraft(),
  ]);
  const [lastInboundResult, setLastInboundResult] =
    useState<AdminInboundCompleteResult | null>(null);
  const [trackingScan, setTrackingScan] = useState("");
  const [busy, setBusy] = useState(false);
  /** When false and a prior putaway exists, later partials land in the same bin. */
  const [changeGoodPutaway, setChangeGoodPutaway] = useState(false);
  const [changeDamagedPutaway, setChangeDamagedPutaway] = useState(false);
  /** Putaway-log heal overrides inflated warehouseGoodReceivedQty in the UI. */
  const [healedInboundGoodQty, setHealedInboundGoodQty] = useState<number | null>(null);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [closeRemarks, setCloseRemarks] = useState("");
  const inboundRequest = props.mode === "inbound" ? props.request : null;

  useEffect(() => {
    if (props.mode !== "inbound") {
      setHealedInboundGoodQty(null);
      return;
    }
    let cancelled = false;
    setHealedInboundGoodQty(null);
    void healInboundReceivedQtyFromPutawayLogs({
      clientUserId: props.clientUserId,
      requestId: props.request.id,
    })
      .then((totals) => {
        if (!cancelled) setHealedInboundGoodQty(totals.good);
      })
      .catch((err) => {
        console.warn("[admin inbound] received-qty heal skipped", err);
      });
    return () => {
      cancelled = true;
    };
  }, [
    props.mode,
    props.mode === "inbound" ? props.clientUserId : "",
    props.mode === "inbound" ? props.request.id : "",
  ]);
  const destinationLine = useMemo<WarehouseCartonLine>(
    () => ({
      lineId: "ADMIN-PREVIEW",
      sku: String(inboundRequest?.sku ?? "").trim(),
      productTitle: inboundRequest?.productName?.trim() || null,
      quantity: Math.max(1, qty),
      lot: lot.trim() || null,
      expiry: expiry.trim() || null,
      condition: "good",
      binId: null,
      allocationStatus: "allocated",
      clientId: props.mode === "inbound" ? props.clientUserId : null,
      inventoryRequestId: inboundRequest?.id ?? null,
    }),
    [expiry, inboundRequest, lot, props, qty]
  );
  const damagedDestinationLine = useMemo<WarehouseCartonLine>(
    () => ({
      lineId: "ADMIN-PREVIEW-DMG",
      sku: String(inboundRequest?.sku ?? "").trim(),
      productTitle: inboundRequest?.productName?.trim() || null,
      quantity: Math.max(1, damagedQty),
      lot: lot.trim() || null,
      expiry: expiry.trim() || null,
      condition: "damaged",
      binId: null,
      allocationStatus: "allocated",
      clientId: props.mode === "inbound" ? props.clientUserId : null,
      inventoryRequestId: inboundRequest?.id ?? null,
    }),
    [damagedQty, expiry, inboundRequest, lot, props]
  );

  useEffect(() => {
    if (!warehouseId && activeWarehouses.length > 0) {
      const nj2 = activeWarehouses.find(
        (w) => isDefaultNj2Warehouse(w.name) || isDefaultNj2Warehouse(w.code)
      );
      setWarehouseId(nj2?.id ?? activeWarehouses[0].id);
    }
  }, [activeWarehouses, warehouseId]);

  useEffect(() => {
    if (!warehouseId) {
      setAreas([]);
      setBins([]);
      setOccupiedBinIds(new Set());
      setDestinationSlot(emptyPutawayLineSlot());
      setDamagedDestinationSlot(emptyPutawayLineSlot());
      return;
    }
    let cancelled = false;
    setDestinationsLoading(true);
    void Promise.all([
      listWarehouseAreas(warehouseId),
      listActiveWarehouseBins(warehouseId),
      loadOccupiedBinIds(warehouseId),
    ])
      .then(async ([loadedAreas, loadedBins, occupied]) => {
        if (cancelled) return;
        setAreas(loadedAreas);
        setBins(loadedBins);
        setOccupiedBinIds(occupied);
        setDamagedDestinationSlot(emptyPutawayLineSlot());

        const inboundRequest =
          props.mode === "inbound" ? props.request : null;
        const reusePath =
          inboundRequest?.lastGoodPutawayWarehouseId === warehouseId
            ? String(inboundRequest.lastGoodPutawayBinPath ?? "").trim()
            : "";
        const reuseArea =
          inboundRequest?.lastGoodPutawayWarehouseId === warehouseId
            ? String(inboundRequest.lastGoodPutawayAreaCode ?? "").trim()
            : "";

        if (reusePath) {
          setChangeGoodPutaway(false);
          setDestinationSlot({
            ...emptyPutawayLineSlot(),
            binPath: reusePath,
            loading: true,
          });
          const slot = await resolvePutawaySlotFromPath(warehouseId, reusePath);
          if (cancelled) return;
          setDestinationSlot(slot);
          return;
        }

        if (reuseArea) {
          setChangeGoodPutaway(false);
          setDestinationSlot({
            ...emptyPutawayLineSlot(),
            areaCode: reuseArea,
            loading: false,
            error: null,
          });
          return;
        }

        setChangeGoodPutaway(true);
        const probeLine = {
          lineId: "admin-default-good",
          sku: String((inboundRequest as { sku?: string } | null)?.sku ?? "PENDING").trim() || "PENDING",
          productTitle: inboundRequest?.productName?.trim() || null,
          quantity: 1,
          lot: null,
          expiry: null,
          condition: "good" as const,
          binId: null,
          allocationStatus: "allocated" as const,
          clientId: props.mode === "inbound" ? props.clientUserId : null,
          inventoryRequestId: inboundRequest?.id ?? null,
        };
        const first = firstAvailablePutawayBin(
          loadedAreas,
          loadedBins,
          probeLine,
          occupied
        );
        if (!first) {
          setDestinationSlot(emptyPutawayLineSlot());
          return;
        }
        setDestinationSlot({
          ...emptyPutawayLineSlot(),
          binPath: first.path,
          loading: true,
        });
        try {
          const slot = await resolvePutawaySlotFromPath(warehouseId, first.path);
          if (cancelled) return;
          setDestinationSlot(slot);
        } catch (error: unknown) {
          if (cancelled) return;
          setDestinationSlot({
            ...emptyPutawayLineSlot(),
            binPath: first.path,
            resolved: null,
            loading: false,
            error:
              error instanceof Error
                ? error.message
                : "Could not validate the default storage bin.",
          });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        toast({
          variant: "destructive",
          title: "Could not load putaway destinations",
          description: error instanceof Error ? error.message : "Try selecting the warehouse again.",
        });
      })
      .finally(() => {
        if (!cancelled) setDestinationsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [toast, warehouseId]);

  useEffect(() => {
    if (props.mode !== "inbound") return;
    const rem = remainingInboundQty(props.request);
    // Default to remaining; if already at/over requested, start at 1 for over-receive.
    setQty(rem > 0 ? rem : 1);
    setDamagedQty(0);
    setPackageCount(1);
    setLot("");
    // Prefill client-provided expiry; admin can change before receive.
    setExpiry(formatExpiryForInput(props.request.expiryDate));
    setCarrier("");
    setInboundTracking("");
    setRemarkDrafts([newRemarkDraft()]);
    setLastInboundResult(null);
    setDamagedDestinationSlot(emptyPutawayLineSlot());
    setChangeDamagedPutaway(true);

    // Prefer the request's last putaway bin for later partials; otherwise first free bin.
    if (!warehouseId || destinationsLoading) {
      setDestinationSlot(emptyPutawayLineSlot());
      return;
    }

    const reusePath =
      props.request.lastGoodPutawayWarehouseId === warehouseId
        ? String(props.request.lastGoodPutawayBinPath ?? "").trim()
        : "";
    const reuseArea =
      props.request.lastGoodPutawayWarehouseId === warehouseId
        ? String(props.request.lastGoodPutawayAreaCode ?? "").trim()
        : "";
    const damagedReusePath =
      props.request.lastDamagedPutawayWarehouseId === warehouseId
        ? String(props.request.lastDamagedPutawayBinPath ?? "").trim()
        : "";
    const damagedReuseArea =
      props.request.lastDamagedPutawayWarehouseId === warehouseId
        ? String(props.request.lastDamagedPutawayAreaCode ?? "").trim()
        : "";

    let cancelled = false;
    void (async () => {
      if (reusePath) {
        setChangeGoodPutaway(false);
        setDestinationSlot({
          ...emptyPutawayLineSlot(),
          binPath: reusePath,
          loading: true,
        });
        const slot = await resolvePutawaySlotFromPath(warehouseId, reusePath);
        if (cancelled) return;
        setDestinationSlot(slot);
      } else if (reuseArea) {
        setChangeGoodPutaway(false);
        setDestinationSlot({
          ...emptyPutawayLineSlot(),
          areaCode: reuseArea,
          loading: false,
          error: null,
        });
      } else if (bins.length > 0) {
        setChangeGoodPutaway(true);
        const probeLine = {
          lineId: "admin-default-good",
          sku: String((props.request as { sku?: string }).sku ?? "PENDING").trim() || "PENDING",
          productTitle: props.request.productName?.trim() || null,
          quantity: 1,
          lot: null,
          expiry: null,
          condition: "good" as const,
          binId: null,
          allocationStatus: "allocated" as const,
          clientId: props.clientUserId,
          inventoryRequestId: props.request.id,
        };
        const first = firstAvailablePutawayBin(areas, bins, probeLine, occupiedBinIds);
        if (!first) {
          setDestinationSlot(emptyPutawayLineSlot());
        } else {
          setDestinationSlot({
            ...emptyPutawayLineSlot(),
            binPath: first.path,
            loading: true,
          });
          const slot = await resolvePutawaySlotFromPath(warehouseId, first.path);
          if (cancelled) return;
          setDestinationSlot(slot);
        }
      } else {
        setChangeGoodPutaway(true);
        setDestinationSlot(emptyPutawayLineSlot());
      }

      if (damagedReusePath) {
        setChangeDamagedPutaway(false);
        const slot = await resolvePutawaySlotFromPath(warehouseId, damagedReusePath);
        if (cancelled) return;
        setDamagedDestinationSlot(slot);
      } else if (damagedReuseArea) {
        setChangeDamagedPutaway(false);
        setDamagedDestinationSlot({
          ...emptyPutawayLineSlot(),
          areaCode: damagedReuseArea,
          loading: false,
          error: null,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    props.mode,
    props.mode === "inbound" ? props.request.id : "",
    props.mode === "inbound" ? props.request.warehouseGoodReceivedQty : 0,
    props.mode === "inbound" ? props.request.lastGoodPutawayBinPath : "",
    props.mode === "inbound" ? props.request.lastDamagedPutawayBinPath : "",
    warehouseId,
    destinationsLoading,
    bins.length,
    // areas / occupiedBinIds intentionally omitted — avoid resetting qty mid-edit
  ]);

  if (!canOverride) return null;

  if (props.mode === "inbound") {
    const { request, clientUserId, clientDisplayName, onComplete } = props;
    const isProduct = request.inventoryType === "product";
    const isApproved = request.status === "approved";
    // Exact "open" only — missing status means legacy admin-fulfilled, not Warehouse Ops.
    const isOpen = String(request.fulfillmentStatus ?? "").trim().toLowerCase() === "open";
    const requestForQty =
      healedInboundGoodQty != null
        ? ({ ...request, warehouseGoodReceivedQty: healedInboundGoodQty } as InventoryRequest)
        : request;
    const remaining = remainingInboundQty(requestForQty);
    const requestedTotal = expectedApprovedInboundQty(request);
    const receivedSoFar = warehouseGoodReceivedQty(requestForQty);
    const hasSavedGoodPutaway = Boolean(
      (request.lastGoodPutawayBinPath || request.lastGoodPutawayAreaCode) &&
        request.lastGoodPutawayWarehouseId === warehouseId
    );
    const hasSavedDamagedPutaway = Boolean(
      (request.lastDamagedPutawayBinPath || request.lastDamagedPutawayAreaCode) &&
        request.lastDamagedPutawayWarehouseId === warehouseId
    );
    const savedGoodLabel =
      request.lastGoodPutawayBinPath?.trim() ||
      (request.lastGoodPutawayAreaCode
        ? `Area ${request.lastGoodPutawayAreaCode}`
        : "");
    const savedDamagedLabel =
      request.lastDamagedPutawayBinPath?.trim() ||
      (request.lastDamagedPutawayAreaCode
        ? `Area ${request.lastDamagedPutawayAreaCode}`
        : "");

    if (!isProduct || !isApproved || !isOpen) return null;
    const overReceived = receivedSoFar > requestedTotal && requestedTotal > 0;
    const goodDestinationReady =
      qty <= 0 ||
      isPutawayLineSlotReady(destinationLine, destinationSlot, { areas, bins });
    const damagedDestinationReady =
      damagedQty <= 0 ||
      isPutawayLineSlotReady(damagedDestinationLine, damagedDestinationSlot, {
        areas,
        bins,
      });
    const destinationReady =
      qty + damagedQty >= 1 && goodDestinationReady && damagedDestinationReady;

    const resolveDestinationBin = async (
      pathOverride?: string,
      target: "good" | "damaged" = "good"
    ) => {
      const slot = target === "good" ? destinationSlot : damagedDestinationSlot;
      const setSlot =
        target === "good" ? setDestinationSlot : setDamagedDestinationSlot;
      const path = (pathOverride ?? slot.binPath).trim();
      if (!warehouseId || !path) return;
      setSlot((previous) => ({
        ...previous,
        binPath: path,
        resolved: null,
        loading: true,
        error: null,
      }));
      try {
        const bin = await findBinByPath(warehouseId, path);
        if (!bin) throw new Error("Bin not found. Search and select a valid warehouse bin.");
        const contents = await inspectBinContents(warehouseId, bin.id);
        setSlot((previous) => ({
          ...previous,
          binPath: bin.path,
          resolved: { bin, contents },
          loading: false,
          error: null,
        }));
      } catch (error: unknown) {
        setSlot((previous) => ({
          ...previous,
          resolved: null,
          loading: false,
          error: error instanceof Error ? error.message : "Could not validate bin.",
        }));
      }
    };

    const closeSummary =
      receivedSoFar < requestedTotal
        ? `Received ${receivedSoFar} of ${requestedTotal} requested (short).`
        : receivedSoFar > requestedTotal
          ? `Received ${receivedSoFar} of ${requestedTotal} requested (over-receive).`
          : `Received ${receivedSoFar} of ${requestedTotal} requested.`;

    const handleCloseInboundConfirm = async () => {
      if (!user?.uid) {
        toast({ variant: "destructive", title: "Sign in required" });
        return;
      }
      setBusy(true);
      try {
        const closeReason =
          receivedSoFar < requestedTotal
            ? `Closed short by admin (${receivedSoFar}/${requestedTotal})`
            : receivedSoFar > requestedTotal
              ? `Closed by admin after over-receive (${receivedSoFar}/${requestedTotal})`
              : "Closed by admin";
        await closeInventoryRequest({
          clientUserId,
          requestId: request.id,
          closedBy: user.uid,
          closeReason,
          closeRemarks: closeRemarks.trim() || null,
        });
        toast({
          title: "Inbound closed",
          description: closeRemarks.trim()
            ? `${closeReason} · Remarks saved for the client.`
            : closeReason,
        });
        setCloseDialogOpen(false);
        setCloseRemarks("");
        onComplete?.();
      } catch (error: unknown) {
        toast({
          variant: "destructive",
          title: "Could not close inbound",
          description: error instanceof Error ? error.message : "Try again.",
        });
      } finally {
        setBusy(false);
      }
    };

    const handleReceive = async () => {
      if (!warehouseId) {
        toast({ variant: "destructive", title: "Select a warehouse" });
        return;
      }
      if (qty + damagedQty < 1) {
        toast({
          variant: "destructive",
          title: "Quantity required",
          description: "Enter at least 1 good or damaged unit.",
        });
        return;
      }
      if (!destinationReady) {
        toast({
          variant: "destructive",
          title: "Select and validate putaway destinations",
          description:
            damagedQty > 0
              ? "Good stock needs a storage bin; damaged needs a quarantine bin."
              : "Select and validate a storage bin for good stock.",
        });
        return;
      }
      setBusy(true);
      try {
        const draftsWithContent = remarkDrafts.filter(
          (d) => d.text.trim() || d.files.length > 0
        );
        const remarksLogEntries: Array<{ text: string | null; imageUrls: string[] }> = [];
        for (const draft of draftsWithContent) {
          let imageUrls: string[] = [];
          if (draft.files.length > 0) {
            try {
              imageUrls = await uploadReceivePhotos({
                warehouseId,
                files: draft.files,
                uploadedBy: userProfile?.uid ?? null,
              });
              if (imageUrls.length < draft.files.length) {
                toast({
                  title: "Some photos did not upload",
                  description: `${imageUrls.length} of ${draft.files.length} photos saved for this remark.`,
                });
              }
            } catch (uploadError: unknown) {
              toast({
                variant: "destructive",
                title: "Photo upload failed",
                description:
                  uploadError instanceof Error
                    ? uploadError.message
                    : "Could not upload receive photos.",
              });
              setBusy(false);
              return;
            }
          }
          remarksLogEntries.push({
            text: draft.text.trim() || null,
            imageUrls,
          });
        }
        const combinedNotes = remarksLogEntries
          .map((e) => e.text)
          .filter(Boolean)
          .join("\n\n");
        const allPhotoUrls = [
          ...new Set(remarksLogEntries.flatMap((e) => e.imageUrls)),
        ];

        const result = await adminCompleteInboundReceiveAndPutaway({
          clientUserId,
          requestId: request.id,
          warehouseId,
          stagingArea: destinationSlot.areaCode || null,
          binPath: destinationSlot.resolved?.bin.path || null,
          damagedStagingArea: damagedDestinationSlot.areaCode || null,
          damagedBinPath: damagedDestinationSlot.resolved?.bin.path || null,
          quantity: qty,
          damagedQuantity: damagedQty,
          unitType,
          packageCount,
          lot,
          expiry,
          carrier,
          trackingNumber: inboundTracking,
          notes: combinedNotes || null,
          photoUrls: allPhotoUrls,
          remarksLogEntries,
          operatorId: userProfile?.uid ?? null,
          operatorName: userProfile?.name ?? userProfile?.email ?? null,
          clientDisplayName,
        });
        setRemarkDrafts([newRemarkDraft()]);
        setLastInboundResult(result);
        if (user && (result.shopifyPushHints?.length || result.ebayPushHints?.length)) {
          try {
            const token = await user.getIdToken();
            if (result.shopifyPushHints?.length) {
              const sync = await pushShopifyInventoryHints(token, result.shopifyPushHints);
              if (sync.errors.length > 0) {
                toast({
                  variant: "destructive",
                  title: "PrepCorex updated; Shopify did not update",
                  description: sync.errors[0],
                });
              }
            }
            if (result.ebayPushHints?.length) {
              const sync = await pushEbayInventoryHints(token, result.ebayPushHints);
              if (sync.errors.length > 0) {
                toast({
                  variant: "destructive",
                  title: "PrepCorex updated; eBay did not update",
                  description: sync.errors[0],
                });
              }
            }
          } catch (e) {
            toast({
              variant: "destructive",
              title: "PrepCorex updated; channel inventory did not update",
              description: e instanceof Error ? e.message : "Re-connect the store in Integrations.",
            });
          }
        }
        const receivedAfter =
          Math.max(
            0,
            Number(healedInboundGoodQty ?? request.warehouseGoodReceivedQty ?? 0)
          ) + qty;
        setHealedInboundGoodQty(receivedAfter);
        const left = remainingInboundQty({
          ...request,
          warehouseGoodReceivedQty: receivedAfter,
        } as InventoryRequest);
        toast({
          title: "Receive complete — stock added",
          description: `${result.quantityReceived} unit(s) → ${result.putawayDestination}. ${
            left > 0
              ? `${left} still under requested qty.`
              : receivedAfter > requestedTotal
                ? `Over requested (${receivedAfter}/${requestedTotal}). Close when done.`
                : "Requested qty met — close when you are done receiving."
          }`,
        });
        const selectedWarehouse = activeWarehouses.find(
          (warehouse) => warehouse.id === warehouseId
        );
        try {
          await downloadReceiveLabels({
            warehouseCode:
              selectedWarehouse?.code || selectedWarehouse?.name || warehouseId,
            cartons: result.cartons,
            pallets: result.pallets,
          });
        } catch (labelError: unknown) {
          toast({
            title: "Receive complete — labels need reprint",
            description:
              labelError instanceof Error
                ? labelError.message
                : "Use the warehouse receive log to reprint labels.",
          });
        }
        onComplete?.();
      } catch (error: unknown) {
        toast({
          variant: "destructive",
          title: "Receive failed",
          description: error instanceof Error ? error.message : "Could not complete receive.",
        });
      } finally {
        setBusy(false);
      }
    };

    return (
      <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Warehouse className="h-4 w-4 text-primary" />
          Admin inbound processing
        </div>
        <p className="text-xs text-muted-foreground">
          Receive in partials anytime — including more than requested. Request stays open until you
          close it. First receive chooses the bin; later receives reuse it unless you change it.
        </p>
        <div className="grid grid-cols-3 gap-2 rounded-md border bg-background/80 p-2 text-center text-xs">
          <div>
            <p className="text-muted-foreground">Requested</p>
            <p className="text-sm font-semibold tabular-nums">{requestedTotal}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Received</p>
            <p
              className={cn(
                "text-sm font-semibold tabular-nums",
                overReceived ? "text-amber-700" : "text-emerald-700"
              )}
            >
              {receivedSoFar}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">{overReceived ? "Over by" : "Remaining"}</p>
            <p
              className={cn(
                "text-sm font-semibold tabular-nums",
                overReceived ? "text-amber-700" : "text-amber-700"
              )}
            >
              {overReceived ? receivedSoFar - requestedTotal : remaining}
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Warehouse</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger>
                <SelectValue placeholder="Select warehouse" />
              </SelectTrigger>
              <SelectContent>
                {activeWarehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name || w.code || w.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Receiving unit</Label>
            <Select
              value={unitType}
              onValueChange={(value) =>
                setUnitType(value as "loose" | "carton" | "pallet")
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="carton">Carton</SelectItem>
                <SelectItem value="pallet">Pallet</SelectItem>
                <SelectItem value="loose">Loose units</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Good qty this receive</Label>
            <Input
              type="number"
              min={0}
              value={qty}
              onChange={(e) =>
                setQty(Math.max(0, parseInt(e.target.value, 10) || 0))
              }
            />
            <p className="text-[10px] text-muted-foreground">
              {remaining > 0
                ? `Under requested by ${remaining}. You may enter more than remaining.`
                : overReceived
                  ? "Already over requested — more units still allowed until you close."
                  : "Requested qty met — more units still allowed until you close."}{" "}
              Leave 0 if only damaged arrived.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-red-700">Damaged qty</Label>
            <Input
              type="number"
              min={0}
              value={damagedQty}
              onChange={(e) =>
                setDamagedQty(Math.max(0, parseInt(e.target.value, 10) || 0))
              }
              className={damagedQty > 0 ? "border-red-300" : ""}
            />
          </div>
          {unitType !== "loose" && qty > 0 ? (
            <div className="space-y-1.5">
              <Label>{unitType === "pallet" ? "Cartons on pallet" : "Number of cartons"}</Label>
              <Input
                type="number"
                min={1}
                max={Math.max(1, qty)}
                value={packageCount}
                onChange={(e) =>
                  setPackageCount(
                    Math.max(1, Math.min(Math.max(1, qty), parseInt(e.target.value, 10) || 1))
                  )
                }
              />
            </div>
          ) : null}
          {qty > 0 ? (
            <div className="space-y-1.5 sm:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label>Good putaway (storage)</Label>
                {hasSavedGoodPutaway ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      const next = !changeGoodPutaway;
                      setChangeGoodPutaway(next);
                      if (!next && warehouseId && savedGoodLabel) {
                        const path = String(request.lastGoodPutawayBinPath ?? "").trim();
                        const area = String(request.lastGoodPutawayAreaCode ?? "").trim();
                        if (path) {
                          setDestinationSlot({
                            ...emptyPutawayLineSlot(),
                            binPath: path,
                            loading: true,
                          });
                          void resolvePutawaySlotFromPath(warehouseId, path).then(setDestinationSlot);
                        } else if (area) {
                          setDestinationSlot({
                            ...emptyPutawayLineSlot(),
                            areaCode: area,
                            loading: false,
                            error: null,
                          });
                        }
                      }
                    }}
                  >
                    {changeGoodPutaway ? "Use same bin again" : "Change bin"}
                  </Button>
                ) : null}
              </div>
              {hasSavedGoodPutaway && !changeGoodPutaway ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-xs text-emerald-900">
                  Adding this receive into the same location as before:{" "}
                  <span className="font-semibold">{savedGoodLabel}</span>
                </div>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    {hasSavedGoodPutaway
                      ? "Pick a new storage bin for this and future receives."
                      : "First receive — choose the storage bin. Later partials will reuse it."}
                  </p>
                  <PutawayDestinationFields
                    line={destinationLine}
                    slot={destinationSlot}
                    warehouseAreas={areas}
                    warehouseBins={bins}
                    occupiedBinIds={occupiedBinIds}
                    occupancyLoading={destinationsLoading}
                    areasLoading={destinationsLoading}
                    onBinPathChange={(value) =>
                      setDestinationSlot((previous) => ({
                        ...previous,
                        binPath: value,
                        resolved: null,
                        error: null,
                      }))
                    }
                    onResolveBin={(path) => void resolveDestinationBin(path, "good")}
                    onAreaChange={(areaCode) =>
                      setDestinationSlot((previous) => ({
                        ...previous,
                        areaCode,
                        resolved: null,
                        error: null,
                      }))
                    }
                  />
                </>
              )}
            </div>
          ) : null}
          {damagedQty > 0 ? (
            <div className="space-y-1.5 sm:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="text-red-700">Damaged putaway (quarantine)</Label>
                {hasSavedDamagedPutaway ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      const next = !changeDamagedPutaway;
                      setChangeDamagedPutaway(next);
                      if (!next && warehouseId) {
                        const path = String(request.lastDamagedPutawayBinPath ?? "").trim();
                        const area = String(request.lastDamagedPutawayAreaCode ?? "").trim();
                        if (path) {
                          void resolvePutawaySlotFromPath(warehouseId, path).then(
                            setDamagedDestinationSlot
                          );
                        } else if (area) {
                          setDamagedDestinationSlot({
                            ...emptyPutawayLineSlot(),
                            areaCode: area,
                            loading: false,
                            error: null,
                          });
                        }
                      }
                    }}
                  >
                    {changeDamagedPutaway ? "Use same bin again" : "Change quarantine bin"}
                  </Button>
                ) : null}
              </div>
              {hasSavedDamagedPutaway && !changeDamagedPutaway ? (
                <div className="rounded-md border border-red-200 bg-red-50/80 px-3 py-2 text-xs text-red-900">
                  Damaged units go to the same quarantine location:{" "}
                  <span className="font-semibold">{savedDamagedLabel}</span>
                </div>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    Damaged units must go to a quarantine bin or quarantine area, same as Warehouse
                    Ops.
                  </p>
                  <PutawayDestinationFields
                    line={damagedDestinationLine}
                    slot={damagedDestinationSlot}
                    warehouseAreas={areas}
                    warehouseBins={bins}
                    occupiedBinIds={occupiedBinIds}
                    occupancyLoading={destinationsLoading}
                    areasLoading={destinationsLoading}
                    onBinPathChange={(value) =>
                      setDamagedDestinationSlot((previous) => ({
                        ...previous,
                        binPath: value,
                        resolved: null,
                        error: null,
                      }))
                    }
                    onResolveBin={(path) => void resolveDestinationBin(path, "damaged")}
                    onAreaChange={(areaCode) =>
                      setDamagedDestinationSlot((previous) => ({
                        ...previous,
                        areaCode,
                        resolved: null,
                        error: null,
                      }))
                    }
                  />
                </>
              )}
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label>Lot (optional)</Label>
            <Input value={lot} onChange={(e) => setLot(e.target.value)} placeholder="Lot number" />
          </div>
          <div className="space-y-1.5">
            <Label>Expiry (optional)</Label>
            <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            {formatExpiryForInput(request.expiryDate) ? (
              <p className="text-[10px] text-muted-foreground">
                Prefills from the client request
                {expiry === formatExpiryForInput(request.expiryDate)
                  ? " (using their date)."
                  : " — you changed it for this receive."}
              </p>
            ) : (
              <p className="text-[10px] text-muted-foreground">
                Client did not set an expiry on this request.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Carrier (optional)</Label>
            <Input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="UPS, FedEx, USPS…" />
          </div>
          <div className="space-y-1.5">
            <Label>Inbound tracking (optional)</Label>
            <Input
              value={inboundTracking}
              onChange={(e) => setInboundTracking(e.target.value)}
              placeholder="Tracking number"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Remarks &amp; photos (optional)</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={busy}
                onClick={() => setRemarkDrafts((prev) => [...prev, newRemarkDraft()])}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add remark
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Add one remark with photos, or several remarks each with their own photos. Shown to
              the client in Remarks as a dated log.
            </p>
            <div className="space-y-3">
              {remarkDrafts.map((draft, index) => (
                <div
                  key={draft.id}
                  className="space-y-2 rounded-md border bg-background/80 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      Remark {index + 1}
                    </p>
                    {remarkDrafts.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        disabled={busy}
                        title="Remove remark"
                        onClick={() =>
                          setRemarkDrafts((prev) => prev.filter((d) => d.id !== draft.id))
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                  <Textarea
                    value={draft.text}
                    disabled={busy}
                    onChange={(e) =>
                      setRemarkDrafts((prev) =>
                        prev.map((d) =>
                          d.id === draft.id ? { ...d, text: e.target.value } : d
                        )
                      )
                    }
                    placeholder="Condition, package details, or admin notes"
                    rows={2}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Label
                      htmlFor={`admin-receive-photos-${draft.id}`}
                      className={cn(
                        "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-xs",
                        busy && "pointer-events-none opacity-50"
                      )}
                    >
                      <ImagePlus className="h-3.5 w-3.5" />
                      Add photos
                    </Label>
                    <input
                      id={`admin-receive-photos-${draft.id}`}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      disabled={busy}
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        e.target.value = "";
                        if (files.length === 0) return;
                        setRemarkDrafts((prev) =>
                          prev.map((d) =>
                            d.id === draft.id
                              ? { ...d, files: [...d.files, ...files].slice(0, 12) }
                              : d
                          )
                        );
                      }}
                    />
                    {draft.files.length > 0 ? (
                      <span className="text-[10px] text-muted-foreground">
                        {draft.files.length} photo{draft.files.length === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                  {draft.files.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {draft.files.map((file, fileIndex) => (
                        <div
                          key={`${draft.id}-${file.name}-${fileIndex}`}
                          className="relative h-14 w-14 overflow-hidden rounded border bg-muted"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={URL.createObjectURL(file)}
                            alt={file.name}
                            className="h-full w-full object-cover"
                          />
                          <button
                            type="button"
                            className="absolute right-0 top-0 rounded-bl bg-black/60 p-0.5 text-white"
                            disabled={busy}
                            aria-label="Remove photo"
                            onClick={() =>
                              setRemarkDrafts((prev) =>
                                prev.map((d) =>
                                  d.id === draft.id
                                    ? {
                                        ...d,
                                        files: d.files.filter((_, i) => i !== fileIndex),
                                      }
                                    : d
                                )
                              )
                            }
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={busy || !warehouseId || destinationsLoading || !destinationReady}
            onClick={() => void handleReceive()}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackageCheck className="mr-2 h-4 w-4" />}
            {remaining > 0 && qty + damagedQty >= remaining
              ? "Receive remaining & put away"
              : remaining <= 0
                ? "Receive more & put away"
                : "Receive partial & put away"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setCloseRemarks("");
              setCloseDialogOpen(true);
            }}
          >
            Close inbound request
          </Button>
          <Dialog
            open={closeDialogOpen}
            onOpenChange={(open) => {
              if (busy) return;
              setCloseDialogOpen(open);
              if (!open) setCloseRemarks("");
            }}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Close inbound request</DialogTitle>
                <DialogDescription>
                  {closeSummary} You will not be able to receive more on this request.
                  Optional remarks are shown to the client on inventory.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label htmlFor="close-inbound-remarks">Remarks (optional)</Label>
                <Textarea
                  id="close-inbound-remarks"
                  value={closeRemarks}
                  onChange={(e) => setCloseRemarks(e.target.value)}
                  placeholder="e.g. Short shipment — rest not arriving / Extra units from vendor"
                  rows={3}
                  disabled={busy}
                />
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setCloseDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleCloseInboundConfirm()}
                >
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Close request
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          {lastInboundResult ? (
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                const warehouse = activeWarehouses.find((item) => item.id === warehouseId);
                try {
                  await downloadReceiveLabels({
                    warehouseCode: warehouse?.code || warehouse?.name || warehouseId,
                    cartons: lastInboundResult.cartons,
                    pallets: lastInboundResult.pallets,
                  });
                } catch (error: unknown) {
                  toast({
                    variant: "destructive",
                    title: "Label download failed",
                    description: error instanceof Error ? error.message : "Could not create labels.",
                  });
                }
              }}
            >
              <Download className="mr-2 h-4 w-4" />
              Download warehouse labels
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const { request, clientUserId, onProgress, onComplete } = props;
  const reqData = request as unknown as Record<string, unknown>;
  const packStatus = String(reqData.warehousePackStatus ?? "").trim().toLowerCase();
  const dispatchStatus = String(reqData.warehouseDispatchStatus ?? "").trim().toLowerCase();
  const pickStatus = String(reqData.warehousePickStatus ?? "").trim().toLowerCase();
  const requestWarehouseId = String(reqData.warehouseId ?? "").trim();
  const status = String(request.status ?? "").trim().toLowerCase();
  const readyToDispatch = packStatus === "ready_to_dispatch" && dispatchStatus !== "dispatched";
  const isDispatched = dispatchStatus === "dispatched";
  const isPicked = pickStatus === "picked";
  const pickWasSkipped = pickStatus === "skipped";
  const inventoryOnly = Boolean(reqData.warehouseAdminInventoryOnlyFulfillment);
  const isFbaOrder = isFbaLabelWorkflowRequest(reqData);
  const savedTracking = String(reqData.warehouseCourierTracking ?? "").trim();
  const needsPickPack =
    status === "confirmed" && !isDispatched && !readyToDispatch && !pickWasSkipped;
  const preferredWarehouseId = requestWarehouseId || warehouseId || activeWarehouses[0]?.id || "";
  const selectedWarehouse = activeWarehouses.find((w) => w.id === preferredWarehouseId) ?? null;

  const [binAssessment, setBinAssessment] = useState<AdminOutboundBinAssessment | null>(null);
  const [assessmentLoading, setAssessmentLoading] = useState(false);

  useEffect(() => {
    if (status !== "confirmed" || isDispatched || !preferredWarehouseId || !selectedWarehouse) {
      setBinAssessment(null);
      return;
    }
    let cancelled = false;
    setAssessmentLoading(true);
    assessAdminOutboundBinStock({
      warehouse: selectedWarehouse,
      clientUserId,
      shipmentRequestId: request.id,
    })
      .then((result) => {
        if (!cancelled) setBinAssessment(result);
      })
      .catch(() => {
        if (!cancelled) setBinAssessment(null);
      })
      .finally(() => {
        if (!cancelled) setAssessmentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientUserId, isDispatched, preferredWarehouseId, request.id, selectedWarehouse, status]);

  useEffect(() => {
    if (readyToDispatch && savedTracking) {
      setTrackingScan((prev) => prev || savedTracking);
    }
  }, [readyToDispatch, savedTracking]);

  const focusQuery = `userId=${encodeURIComponent(clientUserId)}&requestId=${encodeURIComponent(request.id)}`;

  return (
    <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Truck className="h-4 w-4 text-primary" />
        Admin outbound fulfillment
      </div>
      <p className="text-xs text-muted-foreground">
        Fast-path: auto pick &amp; pack in one step, optionally save courier tracking, then dispatch
        {isFbaOrder ? " (FBA — no master-case dimensions required)" : ""}. Or ship from client
        inventory when bins are empty but inventory table shows stock.
      </p>
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-md border bg-background px-2 py-1">Status: {status || "—"}</span>
        <span className="rounded-md border bg-background px-2 py-1">Pick: {pickStatus || "—"}</span>
        <span className="rounded-md border bg-background px-2 py-1">Pack: {packStatus || "—"}</span>
        <span className="rounded-md border bg-background px-2 py-1">Dispatch: {dispatchStatus || "—"}</span>
        {inventoryOnly ? (
          <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900">
            Inventory-only ship
          </span>
        ) : null}
        {isFbaOrder ? (
          <span className="rounded-md border border-violet-300 bg-violet-50 px-2 py-1 text-violet-900">
            FBA
          </span>
        ) : null}
      </div>

      {activeWarehouses.length > 0 && !isDispatched ? (
        <div className="space-y-1.5">
          <Label className="text-xs">Warehouse</Label>
          <Select
            value={preferredWarehouseId}
            onValueChange={setWarehouseId}
            disabled={Boolean(requestWarehouseId)}
          >
            <SelectTrigger className="h-8 max-w-xs">
              <SelectValue placeholder="Select warehouse" />
            </SelectTrigger>
            <SelectContent>
              {activeWarehouses.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name || w.code || w.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {!isDispatched && preferredWarehouseId && user?.uid ? (
        <div className="border-t pt-3 space-y-2">
          <p className="text-xs font-medium text-foreground">Correct outbound lines</p>
          <p className="text-xs text-muted-foreground">
            Edit qty / pack of / unit price, remove a line, or add another product before dispatch.
            Client reserved stock updates when units change.
          </p>
          <WarehouseOutboundLineEditPanel
            mode="admin"
            warehouseId={preferredWarehouseId}
            clientUserId={clientUserId}
            shipmentRequestId={request.id}
            operatorId={user.uid}
            onEdited={() => onProgress?.()}
          />
        </div>
      ) : null}

      {needsPickPack && !readyToDispatch ? (
        <div className="space-y-2 border-t pt-3">
          {assessmentLoading ? (
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Checking bin stock…
            </p>
          ) : binAssessment ? (
            <p className="text-xs text-muted-foreground">
              {binAssessment.hasFullBinStock
                ? `${binAssessment.pickStepCount} pick step${binAssessment.pickStepCount === 1 ? "" : "s"} ready in bins.`
                : binAssessment.shortfalls.length > 0
                  ? `Bin shortfall: ${binAssessment.shortfalls
                      .map((s) => `${s.sku} (${s.planned}/${s.needed})`)
                      .join(", ")}`
                  : "No bin stock — ship from client inventory if available."}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy || !selectedWarehouse || assessmentLoading || binAssessment?.hasFullBinStock === false}
              onClick={async () => {
                if (!selectedWarehouse || !user) return;
                setBusy(true);
                try {
                  await adminAutoPickAndPackOutbound({
                    warehouse: selectedWarehouse,
                    clientUserId,
                    shipmentRequestId: request.id,
                    operatorId: user.uid,
                  });
                  toast({
                    title: "Pick & pack complete",
                    description: "Add tracking if you have it, then dispatch.",
                  });
                  onProgress?.();
                } catch (error: unknown) {
                  toast({
                    variant: "destructive",
                    title: "Pick & pack failed",
                    description: error instanceof Error ? error.message : "Could not complete.",
                  });
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackageCheck className="mr-2 h-4 w-4" />}
              Complete pick &amp; pack
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy || !preferredWarehouseId}
              onClick={async () => {
                if (!preferredWarehouseId || !user) return;
                setBusy(true);
                try {
                  await adminShipOutboundFromInventoryOnly({
                    warehouseId: preferredWarehouseId,
                    clientUserId,
                    shipmentRequestId: request.id,
                    operatorId: user.uid,
                  });
                  toast({
                    title: "Ready from inventory",
                    description: "Add tracking if you have it, then dispatch.",
                  });
                  onProgress?.();
                } catch (error: unknown) {
                  toast({
                    variant: "destructive",
                    title: "Could not ship from inventory",
                    description: error instanceof Error ? error.message : "Failed.",
                  });
                } finally {
                  setBusy(false);
                }
              }}
            >
              Ship from client inventory
            </Button>
          </div>
        </div>
      ) : null}

      {pickWasSkipped && !isDispatched ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy || !preferredWarehouseId}
          onClick={async () => {
            if (!preferredWarehouseId) return;
            setBusy(true);
            try {
              await restorePickOrderToQueue({
                clientUserId,
                shipmentRequestId: request.id,
                warehouseId: preferredWarehouseId,
                operatorId: userProfile?.uid ?? null,
              });
              toast({ title: "Returned to pick queue" });
              onProgress?.();
            } catch (error: unknown) {
              toast({
                variant: "destructive",
                title: "Restore failed",
                description: error instanceof Error ? error.message : "Could not restore.",
              });
            } finally {
              setBusy(false);
            }
          }}
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          Return to pick queue
        </Button>
      ) : null}

      {readyToDispatch ? (
        <div className="space-y-2 border-t pt-3">
          <Label>Courier tracking (optional)</Label>
          <p className="text-xs text-muted-foreground">
            Save tracking before dispatch, or leave blank and dispatch without it.
            {savedTracking ? ` On file: ${savedTracking}` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <Input
              className="max-w-xs font-mono text-sm"
              value={trackingScan}
              onChange={(e) => setTrackingScan(e.target.value)}
              placeholder="Tracking barcode or number"
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy || !trackingScan.trim()}
              onClick={async () => {
                if (!user) return;
                setBusy(true);
                try {
                  await adminSaveOutboundTracking({
                    clientUserId,
                    shipmentRequestId: request.id,
                    trackingNumber: trackingScan.trim(),
                    operatorId: user.uid,
                  });
                  toast({ title: "Tracking saved" });
                  onProgress?.();
                } catch (error: unknown) {
                  toast({
                    variant: "destructive",
                    title: "Could not save tracking",
                    description: error instanceof Error ? error.message : "Failed.",
                  });
                } finally {
                  setBusy(false);
                }
              }}
            >
              Save tracking
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || !preferredWarehouseId}
              onClick={async () => {
                if (!preferredWarehouseId || !user) return;
                setBusy(true);
                try {
                  const hints = await adminDispatchOutboundWithTracking({
                    warehouseId: preferredWarehouseId,
                    clientUserId,
                    shipmentRequestId: request.id,
                    trackingNumber: trackingScan.trim() || undefined,
                    operatorId: user.uid,
                  });
                  if (hints.length > 0) {
                    try {
                      const token = await user.getIdToken();
                      await pushShopifyInventoryHints(token, hints);
                    } catch {
                      // non-blocking
                    }
                  }
                  toast({
                    title: "Order dispatched",
                    description: trackingScan.trim()
                      ? "Client inventory updated with tracking."
                      : "Dispatched without tracking.",
                  });
                  setTrackingScan("");
                  onComplete?.();
                } catch (error: unknown) {
                  toast({
                    variant: "destructive",
                    title: "Dispatch failed",
                    description: error instanceof Error ? error.message : "Could not dispatch.",
                  });
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {trackingScan.trim() || savedTracking ? "Confirm dispatch" : "Dispatch without tracking"}
            </Button>
          </div>
        </div>
      ) : null}

      {!isDispatched ? (
        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Button type="button" variant="ghost" size="sm" asChild>
            <Link href={`/warehouse-ops/pick?tab=ready&${focusQuery}`}>Warehouse Ops pick</Link>
          </Button>
          <Button type="button" variant="ghost" size="sm" asChild>
            <Link href={`/warehouse-ops/pack?${focusQuery}`}>Warehouse Ops pack</Link>
          </Button>
          <Button type="button" variant="ghost" size="sm" asChild>
            <Link href={`/warehouse-ops/dispatch?${focusQuery}`}>Warehouse Ops dispatch</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
