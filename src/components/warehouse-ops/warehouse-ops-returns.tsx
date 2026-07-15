"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { WarehouseOpsHeader } from "@/components/warehouse-ops/warehouse-ops-header";
import {
  ReturnsFloorFlows,
  type FloorFlow,
  type WalkPhase,
  type RecvPhase,
} from "@/components/warehouse-ops/warehouse-ops-returns-floor-flows";

import { useWarehouseOpsLive } from "@/components/warehouse-ops/warehouse-ops-live-provider";
import { useWarehouseOpsClients } from "@/hooks/use-warehouse-ops-clients";
import { formatClientOptionLabel } from "@/components/warehouse-ops/crossdock-client-combobox";
import {
  useAllProductReturns,
  type AdminProductReturn,
  getReturnOwnerId,
} from "@/hooks/use-all-product-returns";
import {
  approveProductReturn,
  rejectProductReturn,
  receiveReturnWithCarton,
  createWalkInReturnWithUser,
  receiveReturnWalkInUnknownUser,
  startReturnFromAllocatedWalkIn,
  shipReturnQuantity,
  closeProductReturnWithInvoice,
  isReturnWalkInCarton,
  resolveReturnProductName,
  resolveReturnSku,
} from "@/lib/product-return-ops";
import {
  buildReturnStockLocations,
  type ReturnReceiveUnitType,
} from "@/lib/warehouse-returns";
import { generateCrossdockReceiveLot } from "@/lib/warehouse-crossdock";
import { buildWarehousePalletLabelsPdf } from "@/lib/warehouse-pallet-label-pdf";
import { getWarehousePallet } from "@/lib/warehouse-receive-corrections";
import { allocateLine } from "@/lib/warehouse-allocate";
import {
  buildWarehouseCartonLabelsPdf,
  downloadUint8ArrayAsFile,
} from "@/lib/warehouse-carton-label-pdf";
import { getWarehouseCarton } from "@/lib/warehouse-receive-corrections";
import { uploadReceivePhotos } from "@/lib/inbound-receive-photos";
import { ScanCameraButton } from "@/components/warehouse-ops/scan-camera-button";
import {
  normalizeReturnTracking,
  parseReturnTrackings,
} from "@/lib/return-tracking-client";
import type { InventoryItem, UserProfile, WarehouseCartonDoc, WarehouseDoc } from "@/types";
import {
  Archive,
  CheckCircle2,
  ClipboardList,
  FileText,
  Inbox,
  Loader2,
  MapPin,
  Package,
  PackagePlus,
  ScanLine,
  Search,
  Ship,
  UserPlus,
  XCircle,
} from "lucide-react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { cn } from "@/lib/utils";

type Props = { warehouse: WarehouseDoc };
type StatusTab = "pending" | "open" | "in_progress" | "closed" | "all";

function returnMatchesTrackingScan(row: AdminProductReturn, trackingRaw: string): boolean {
  const needle = normalizeReturnTracking(trackingRaw);
  if (!needle) return false;
  const trackings = parseReturnTrackings(row.returnTrackings);
  if (trackings.some((t) => normalizeReturnTracking(t.trackingNumber) === needle)) {
    return true;
  }
  for (const ship of row.shipments ?? []) {
    const tn = (ship as { trackingNumber?: string; tracking?: string }).trackingNumber
      ?? (ship as { tracking?: string }).tracking;
    if (typeof tn === "string" && normalizeReturnTracking(tn) === needle) return true;
  }
  return false;
}

function trackingHaystack(row: AdminProductReturn): string {
  const parts: string[] = [];
  for (const t of parseReturnTrackings(row.returnTrackings)) {
    parts.push(t.trackingNumber);
  }
  for (const ship of row.shipments ?? []) {
    const tn = (ship as { trackingNumber?: string; tracking?: string }).trackingNumber
      ?? (ship as { tracking?: string }).tracking;
    if (typeof tn === "string") parts.push(tn);
  }
  return parts.join(" ");
}
function clientMatchesWarehouse(client: UserProfile, warehouse: WarehouseDoc): boolean {
  const linked = String(warehouse.linkedLocationId ?? "").trim();
  if (!linked) return true;
  const locs = Array.isArray(client.locations) ? client.locations : [];
  return locs.map(String).includes(linked);
}

function displayName(client: UserProfile | undefined, uid: string): string {
  if (!client) return uid.slice(0, 8);
  return formatClientOptionLabel(client);
}

function walkInUnitKind(c: WarehouseCartonDoc): "PLT" | "PKG" | "CTN" {
  if (c.palletId) return "PLT";
  if (c.isPackage) return "PKG";
  return "CTN";
}

function walkInUnitSearchHay(c: WarehouseCartonDoc): string {
  return [
    c.cartonCode,
    c.barcode,
    c.receiveLot,
    c.lot,
    c.receivedForClient,
    c.productTitle,
    c.notes,
    walkInUnitKind(c),
    String(c.quantity),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function StatusBadge({ status }: { status?: string }) {
  const s = String(status || "");
  if (s === "pending")
    return (
      <Badge className="bg-amber-500/15 text-amber-800 border-amber-300/60 hover:bg-amber-500/20 border">
        Pending
      </Badge>
    );
  if (s === "approved")
    return (
      <Badge className="bg-sky-500/15 text-sky-800 border-sky-300/60 hover:bg-sky-500/20 border">
        Open
      </Badge>
    );
  if (s === "in_progress")
    return (
      <Badge className="bg-orange-500/15 text-orange-900 border-orange-300/70 hover:bg-orange-500/20 border">
        In progress
      </Badge>
    );
  if (s === "closed")
    return (
      <Badge variant="secondary" className="border border-border/60">
        Closed
      </Badge>
    );
  if (s === "cancelled") return <Badge variant="destructive">Cancelled</Badge>;
  return <Badge variant="outline">{s || "—"}</Badge>;
}

function ReceiveProgress({ received, requested }: { received: number; requested: number }) {
  const req = Math.max(0, requested);
  const rec = Math.max(0, received);
  const pct = req > 0 ? Math.min(100, Math.round((rec / req) * 100)) : 0;
  return (
    <div className="space-y-1.5 min-w-[7.5rem]">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-muted-foreground">Received</span>
        <span className="font-semibold tabular-nums text-foreground">
          {rec}/{req || "—"}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            pct >= 100 ? "bg-emerald-500" : pct > 0 ? "bg-orange-500" : "bg-transparent"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

const TAB_META: Array<{
  id: StatusTab;
  label: string;
  hint: string;
  tone: string;
}> = [
  {
    id: "pending",
    label: "Pending",
    hint: "Approve or reject",
    tone: "data-[state=active]:bg-amber-500 data-[state=active]:text-white",
  },
  {
    id: "open",
    label: "Open",
    hint: "Ready to receive",
    tone: "data-[state=active]:bg-sky-600 data-[state=active]:text-white",
  },
  {
    id: "in_progress",
    label: "In progress",
    hint: "Partial receive",
    tone: "data-[state=active]:bg-orange-600 data-[state=active]:text-white",
  },
  {
    id: "closed",
    label: "Closed",
    hint: "History",
    tone: "data-[state=active]:bg-slate-700 data-[state=active]:text-white",
  },
  {
    id: "all",
    label: "All",
    hint: "Everything",
    tone: "data-[state=active]:bg-foreground data-[state=active]:text-background",
  },
];

export function WarehouseOpsReturns({ warehouse }: Props) {
  const { toast } = useToast();
  const { user, userProfile } = useAuth();
  const operatorId = user?.uid ?? userProfile?.uid ?? "";
  const operatorName = userProfile?.name || userProfile?.email || operatorId;
  const { cartons, liveLoading } = useWarehouseOpsLive();
  const { clients, loading: clientsLoading } = useWarehouseOpsClients({
    includeUnapproved: true,
  });
  const { data: allReturns, loading: returnsLoading } = useAllProductReturns();

  const [tab, setTab] = useState<StatusTab>("pending");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<AdminProductReturn | null>(null);
  const [busy, setBusy] = useState(false);

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const [floorFlow, setFloorFlow] = useState<FloorFlow>("queue");
  const [walkPhase, setWalkPhase] = useState<WalkPhase>("pick-mode");
  const [recvPhase, setRecvPhase] = useState<RecvPhase>("pick-unit");

  const [recvQty, setRecvQty] = useState("1");
  const [recvSku, setRecvSku] = useState("");
  const [recvTitle, setRecvTitle] = useState("");
  const [recvNotes, setRecvNotes] = useState("");
  const [recvCloseReady, setRecvCloseReady] = useState(false);
  const [recvUnitType, setRecvUnitType] = useState<ReturnReceiveUnitType>("carton");
  const [recvLot, setRecvLot] = useState("");
  const [recvExpiry, setRecvExpiry] = useState("");
  const [recvCondition, setRecvCondition] = useState<"good" | "damaged">("good");
  const [binPathById, setBinPathById] = useState<Map<string, string>>(new Map());
  const [trackingScan, setTrackingScan] = useState("");
  const [recvTracking, setRecvTracking] = useState("");
  const [recvPhotoFiles, setRecvPhotoFiles] = useState<File[]>([]);
  const [recvPhotoPreviews, setRecvPhotoPreviews] = useState<string[]>([]);
  const [walkProductId, setWalkProductId] = useState("");
  const [walkExpiry, setWalkExpiry] = useState("");
  const [walkInventory, setWalkInventory] = useState<InventoryItem[]>([]);
  const [walkInventoryLoading, setWalkInventoryLoading] = useState(false);

  const [shipOpen, setShipOpen] = useState(false);
  const [shipQty, setShipQty] = useState("");
  const [shipTo, setShipTo] = useState("");
  const [shipNotes, setShipNotes] = useState("");
  const [shipUnitPrice, setShipUnitPrice] = useState("");
  const [shipInvoice, setShipInvoice] = useState(false);

  const [closeOpen, setCloseOpen] = useState(false);
  const [returnFee, setReturnFee] = useState("");
  const [packingFee, setPackingFee] = useState("");
  const [boxQuantity, setBoxQuantity] = useState("1");
  const [palletFee, setPalletFee] = useState("");
  const [palletQuantity, setPalletQuantity] = useState("1");
  const [closeShipUnit, setCloseShipUnit] = useState("");
  const [generateInvoice, setGenerateInvoice] = useState(true);
  const [shipRemainingOnClose, setShipRemainingOnClose] = useState(false);

  const [walkInMode, setWalkInMode] = useState<"with_user" | "no_user">("with_user");
  const [walkClientId, setWalkClientId] = useState("");
  const [walkClientLabel, setWalkClientLabel] = useState("");
  const [walkType, setWalkType] = useState<"existing" | "new">("existing");
  const [walkReturnType, setWalkReturnType] = useState<"combine" | "partial">("partial");
  const [walkName, setWalkName] = useState("");
  const [walkSku, setWalkSku] = useState("");
  const [walkQty, setWalkQty] = useState("1");
  const [walkNotes, setWalkNotes] = useState("");
  const [walkUnknownName, setWalkUnknownName] = useState("");
  const [walkUnitType, setWalkUnitType] = useState<"carton" | "pallet" | "package">("carton");
  const [walkLot, setWalkLot] = useState(() => generateCrossdockReceiveLot());

  const [linkCartonId, setLinkCartonId] = useState("");
  const [linkClientId, setLinkClientId] = useState("");
  const [linkClientLabel, setLinkClientLabel] = useState("");
  const [linkType, setLinkType] = useState<"existing" | "new">("new");
  const [linkName, setLinkName] = useState("");
  const [linkSku, setLinkSku] = useState("");
  const [linkQty, setLinkQty] = useState("1");
  const [linkUnitQuery, setLinkUnitQuery] = useState("");

  const clientById = useMemo(() => {
    const m = new Map<string, UserProfile>();
    for (const c of clients) m.set(c.uid, c);
    return m;
  }, [clients]);

  const eligibleOwnerIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of clients) {
      if (clientMatchesWarehouse(c, warehouse)) set.add(c.uid);
    }
    return set;
  }, [clients, warehouse]);

  const warehouseReturns = useMemo(() => {
    return allReturns.filter((r) => {
      const owner = getReturnOwnerId(r);
      return owner && eligibleOwnerIds.has(owner);
    });
  }, [allReturns, eligibleOwnerIds]);

  const counts = useMemo(() => {
    let pending = 0;
    let open = 0;
    let in_progress = 0;
    let closed = 0;
    for (const r of warehouseReturns) {
      if (r.status === "pending") pending += 1;
      else if (r.status === "approved") open += 1;
      else if (r.status === "in_progress") in_progress += 1;
      else if (r.status === "closed") closed += 1;
    }
    return { pending, open, in_progress, closed, all: warehouseReturns.length };
  }, [warehouseReturns]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return warehouseReturns
      .filter((r) => {
        if (tab === "pending" && r.status !== "pending") return false;
        if (tab === "open" && r.status !== "approved") return false;
        if (tab === "in_progress" && r.status !== "in_progress") return false;
        if (tab === "closed" && r.status !== "closed" && r.status !== "cancelled")
          return false;
        if (!q) return true;
        const owner = getReturnOwnerId(r);
        const client = clientById.get(owner);
        const hay = [
          displayName(client, owner),
          resolveReturnProductName(r),
          resolveReturnSku(r),
          r.id,
          r.userRemarks,
          r.status,
          trackingHaystack(r),
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => {
        const order = { pending: 0, approved: 1, in_progress: 2, closed: 3, cancelled: 4 };
        const ao = order[a.status as keyof typeof order] ?? 9;
        const bo = order[b.status as keyof typeof order] ?? 9;
        if (ao !== bo) return ao - bo;
        return resolveReturnProductName(a).localeCompare(resolveReturnProductName(b));
      });
  }, [warehouseReturns, tab, query, clientById]);

  const trackingMatches = useMemo(() => {
    const needle = trackingScan.trim();
    if (!needle) return [] as AdminProductReturn[];
    return warehouseReturns.filter(
      (r) =>
        (r.status === "approved" || r.status === "in_progress" || r.status === "pending") &&
        returnMatchesTrackingScan(r, needle)
    );
  }, [warehouseReturns, trackingScan]);

  const unallocatedReturnCartons = useMemo(() => {
    return cartons.filter(
      (c) =>
        isReturnWalkInCarton(c) &&
        !c.clientId &&
        c.status !== "voided" &&
        c.status !== "closed"
    );
  }, [cartons]);

  const filteredLinkUnits = useMemo(() => {
    const q = linkUnitQuery.trim().toLowerCase();
    if (!q) return unallocatedReturnCartons;
    return unallocatedReturnCartons.filter((c) => walkInUnitSearchHay(c).includes(q));
  }, [unallocatedReturnCartons, linkUnitQuery]);

  const selectedLinkUnit = useMemo(
    () => unallocatedReturnCartons.find((c) => c.id === linkCartonId) ?? null,
    [unallocatedReturnCartons, linkCartonId]
  );

  function pickLinkUnit(c: WarehouseCartonDoc) {
    setLinkCartonId(c.id);
    setLinkQty(String(Math.max(1, c.quantity || 1)));
    if (!linkName.trim() && c.receivedForClient?.trim()) {
      setLinkName(c.receivedForClient.trim());
    }
  }

  const priorLocations = useMemo(() => {
    if (!selected?.id) return [];
    return buildReturnStockLocations({
      cartons,
      productReturnId: selected.id,
      binPathById,
    });
  }, [selected?.id, cartons, binPathById]);

  useEffect(() => {
    if (floorFlow !== "receive") return;
    let cancelled = false;
    void (async () => {
      try {
        const { listActiveWarehouseBins } = await import("@/lib/warehouse-cycle-count");
        const bins = await listActiveWarehouseBins(warehouse.id);
        if (cancelled) return;
        const map = new Map<string, string>();
        for (const b of bins) map.set(b.id, b.path);
        setBinPathById(map);
      } catch {
        /* paths optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [floorFlow, warehouse.id]);

  useEffect(() => {
    if (!walkClientId || floorFlow !== "walk-in") {
      setWalkInventory([]);
      return;
    }
    let cancelled = false;
    setWalkInventoryLoading(true);
    void (async () => {
      try {
        const snap = await getDocs(collection(db, "users", walkClientId, "inventory"));
        if (cancelled) return;
        const items: InventoryItem[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<InventoryItem, "id">),
        }));
        setWalkInventory(
          items
            .filter((item) => {
              const inventoryType = (item as InventoryItem & { inventoryType?: string })
                .inventoryType;
              const isPackaging =
                inventoryType === "box" ||
                inventoryType === "container" ||
                inventoryType === "pallet";
              return !isPackaging;
            })
            .sort((a, b) =>
              String(a.productName || "").localeCompare(String(b.productName || ""))
            )
        );
      } catch {
        if (!cancelled) setWalkInventory([]);
      } finally {
        if (!cancelled) setWalkInventoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [walkClientId, floorFlow]);

  function openReceive(row: AdminProductReturn, options?: { tracking?: string }) {
    setSelected(row);
    setRecvQty(
      String(
        Math.max(1, (row.requestedQuantity || 0) - (row.receivedQuantity || 0) || 1)
      )
    );
    setRecvSku(resolveReturnSku(row));
    setRecvTitle(resolveReturnProductName(row));
    setRecvNotes("");
    setRecvCloseReady(false);
    setRecvUnitType("carton");
    setRecvCondition("good");

    const prior = buildReturnStockLocations({
      cartons,
      productReturnId: row.id || "",
      binPathById,
    });
    const priorLot = prior.find((p) => p.lot?.trim())?.lot?.trim() || "";
    setRecvLot(priorLot);
    const expiryFromReturn =
      typeof row.expiryDate === "string" ? row.expiryDate.trim().slice(0, 10) : "";
    setRecvExpiry(expiryFromReturn);
    setRecvTracking(options?.tracking?.trim() || trackingScan.trim() || "");
    setRecvPhotoFiles([]);
    setRecvPhotoPreviews((prev) => {
      prev.forEach((u) => URL.revokeObjectURL(u));
      return [];
    });
    setRecvPhase(prior.length > 0 ? "form" : "pick-unit");
    if (prior.length > 0) setRecvUnitType("carton");
    setFloorFlow("receive");
  }

  function onRecvPhotosChange(files: File[]) {
    setRecvPhotoPreviews((prev) => {
      prev.forEach((u) => URL.revokeObjectURL(u));
      return files.map((f) => URL.createObjectURL(f));
    });
    setRecvPhotoFiles(files);
  }

  function applyTrackingScan(value: string) {
    setTrackingScan(value);
    const needle = value.trim();
    if (!needle) return;
    const matches = warehouseReturns.filter(
      (r) =>
        (r.status === "approved" || r.status === "in_progress") &&
        returnMatchesTrackingScan(r, needle)
    );
    if (matches.length === 1) {
      openReceive(matches[0], { tracking: needle });
    } else if (matches.length > 1) {
      setQuery(needle);
      setTab("all");
      toast({
        title: `${matches.length} returns match this tracking`,
        description: "Select a row below to receive (partial multi-SKU supported).",
      });
    } else {
      const pending = warehouseReturns.filter(
        (r) => r.status === "pending" && returnMatchesTrackingScan(r, needle)
      );
      if (pending.length > 0) {
        setQuery(needle);
        setTab("pending");
        toast({
          title: "Tracking matched pending return(s)",
          description: "Approve first, then receive.",
        });
      }
    }
  }

  function openWalkIn() {
    setWalkInMode("with_user");
    setWalkPhase("pick-mode");
    setWalkClientId("");
    setWalkClientLabel("");
    setWalkType("existing");
    setWalkReturnType("partial");
    setWalkName("");
    setWalkSku("");
    setWalkProductId("");
    setWalkExpiry("");
    setWalkQty("1");
    setWalkNotes("");
    setWalkUnknownName("");
    setWalkUnitType("carton");
    setWalkLot(generateCrossdockReceiveLot());
    setFloorFlow("walk-in");
  }

  function openLinkUnallocated() {
    const first = unallocatedReturnCartons[0] ?? null;
    setLinkCartonId(first?.id ?? "");
    setLinkClientId("");
    setLinkClientLabel("");
    setLinkType("new");
    setLinkName(first?.receivedForClient?.trim() ?? "");
    setLinkSku("");
    setLinkQty(String(Math.max(1, first?.quantity || 1)));
    setLinkUnitQuery("");
    setFloorFlow("link");
  }

  function backToQueue() {
    setFloorFlow("queue");
    setWalkPhase("pick-mode");
    setRecvPhase("pick-unit");
    setLinkUnitQuery("");
  }

  function openShip(row: AdminProductReturn) {
    setSelected(row);
    const avail = Math.max(0, (row.receivedQuantity || 0) - (row.shippedQuantity || 0));
    setShipQty(String(Math.max(1, avail || 1)));
    setShipTo("");
    setShipNotes("");
    setShipUnitPrice("");
    setShipInvoice(false);
    setShipOpen(true);
  }

  function openClose(row: AdminProductReturn) {
    setSelected(row);
    setReturnFee("");
    setPackingFee("");
    setBoxQuantity("1");
    setPalletFee("");
    setPalletQuantity("1");
    setCloseShipUnit("");
    setGenerateInvoice(true);
    setShipRemainingOnClose(!!row.additionalServices?.shipToAddress);
    setCloseOpen(true);
  }

  async function handleApprove(row: AdminProductReturn) {
    const owner = getReturnOwnerId(row);
    if (!owner || !operatorId || !row.id) return;
    setBusy(true);
    try {
      await approveProductReturn({
        ownerUserId: owner,
        returnId: row.id,
        operatorId,
      });
      toast({ title: "Approved", description: resolveReturnProductName(row) });
      setSelected(null);
    } catch (e) {
      toast({
        title: "Approve failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    const owner = getReturnOwnerId(selected);
    if (!selected?.id || !owner) return;
    setBusy(true);
    try {
      await rejectProductReturn({
        ownerUserId: owner,
        returnId: selected.id,
        reason: rejectReason,
      });
      toast({ title: "Rejected" });
      setRejectOpen(false);
      setRejectReason("");
      setSelected(null);
    } catch (e) {
      toast({
        title: "Reject failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleReceive() {
    const owner = getReturnOwnerId(selected);
    if (!selected?.id || !owner) return;
    const qty = parseInt(recvQty, 10);
    if (!recvSku.trim() || !(qty >= 1)) {
      toast({
        title: "SKU and quantity required",
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      let photoUrls: string[] = [];
      if (recvPhotoFiles.length > 0) {
        photoUrls = await uploadReceivePhotos({
          warehouseId: warehouse.id,
          files: recvPhotoFiles,
          uploadedBy: operatorId,
        });
      }
      const result = await receiveReturnWithCarton({
        warehouseId: warehouse.id,
        ownerUserId: owner,
        productReturnId: selected.id,
        sku: recvSku.trim(),
        productTitle: recvTitle.trim() || resolveReturnProductName(selected),
        quantity: qty,
        condition: recvCondition,
        unitType: recvUnitType,
        lot: recvLot.trim() || null,
        expiry: recvExpiry.trim() || null,
        trackingNumber: recvTracking.trim() || null,
        notes: recvNotes.trim() || null,
        photoUrls: photoUrls.length > 0 ? photoUrls : null,
        receivedBy: operatorName,
        operatorId,
        closeAfter: recvCloseReady,
      });
      const unitLabel =
        recvUnitType === "pallet"
          ? result.palletCode || "PLT"
          : result.cartonCode;
      toast({
        title: "Return received",
        description: `${unitLabel} · lot ${result.receiveLot} → Putaway`,
      });
      try {
        const carton = await getWarehouseCarton(warehouse.id, result.cartonId);
        if (carton) {
          const pdf = await buildWarehouseCartonLabelsPdf({
            title: warehouse.code || warehouse.name || "Warehouse",
            cartons: [carton],
          });
          downloadUint8ArrayAsFile(pdf, `${result.cartonCode}-label.pdf`);
        }
        if (result.palletId) {
          const pallet = await getWarehousePallet(warehouse.id, result.palletId);
          if (pallet) {
            const palletPdf = await buildWarehousePalletLabelsPdf({
              title: warehouse.code || warehouse.name || "Warehouse",
              pallets: [pallet],
            });
            downloadUint8ArrayAsFile(
              palletPdf,
              `${result.palletCode || result.palletId}-label.pdf`
            );
          }
        }
      } catch {
        /* label optional */
      }
      setFloorFlow("queue");
      setRecvPhase("pick-unit");
      setRecvPhotoFiles([]);
      setRecvPhotoPreviews((prev) => {
        prev.forEach((u) => URL.revokeObjectURL(u));
        return [];
      });
      setSelected(null);
    } catch (e) {
      toast({
        title: "Receive failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleShip() {
    const owner = getReturnOwnerId(selected);
    if (!selected?.id || !owner) return;
    setBusy(true);
    try {
      const result = await shipReturnQuantity({
        ownerUserId: owner,
        returnId: selected.id,
        quantity: parseInt(shipQty, 10),
        shipTo,
        notes: shipNotes,
        operatorId,
        client: clientById.get(owner),
        shippingUnitPrice: parseFloat(shipUnitPrice) || 0,
        generateInvoice: shipInvoice,
        writeShippedOrder: true,
      });
      toast({
        title: "Shipped",
        description: result.invoiceNumber
          ? `Shipped orders updated · Invoice ${result.invoiceNumber}`
          : "Shipped orders updated",
      });
      setShipOpen(false);
    } catch (e) {
      toast({
        title: "Ship failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleClose() {
    const owner = getReturnOwnerId(selected);
    if (!selected?.id || !owner) return;
    setBusy(true);
    try {
      const result = await closeProductReturnWithInvoice({
        ownerUserId: owner,
        returnId: selected.id,
        operatorId,
        client: clientById.get(owner),
        returnFee: parseFloat(returnFee),
        packingFee: parseFloat(packingFee) || 0,
        boxQuantity: parseFloat(boxQuantity) || 1,
        palletFee: parseFloat(palletFee) || 0,
        palletQuantity: parseFloat(palletQuantity) || 1,
        shippingUnitPrice: parseFloat(closeShipUnit) || 0,
        generateInvoice,
        shipRemainingOnClose,
      });
      toast({
        title: "Return closed",
        description: result.invoiceNumber
          ? `Invoice ${result.invoiceNumber} generated`
          : "Closed without invoice",
      });
      setCloseOpen(false);
      setSelected(null);
    } catch (e) {
      toast({
        title: "Close failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleWalkIn() {
    setBusy(true);
    try {
      if (walkInMode === "no_user") {
        if (!walkUnknownName.trim()) {
          throw new Error("Enter a name for the label (shipper / sender).");
        }
        const result = await receiveReturnWalkInUnknownUser({
          warehouseId: warehouse.id,
          displayName: walkUnknownName.trim(),
          quantity: parseInt(walkQty, 10) || 1,
          unitType: walkUnitType,
          receiveLot: walkLot.trim() || null,
          notes: walkNotes.trim() || null,
          receivedBy: operatorName,
          operatorId,
        });
        toast({
          title: "Closed return received",
          description: `${result.palletCode || result.cartonCode} · ${result.receiveLot} · ${walkUnknownName.trim()}`,
        });
        try {
          const carton = await getWarehouseCarton(warehouse.id, result.cartonId);
          if (carton) {
            const pdf = await buildWarehouseCartonLabelsPdf({
              title: warehouse.code || warehouse.name || "Warehouse",
              cartons: [carton],
            });
            downloadUint8ArrayAsFile(pdf, `${result.cartonCode}-label.pdf`);
          }
          if (result.palletId) {
            const pallet = await getWarehousePallet(warehouse.id, result.palletId);
            if (pallet) {
              const palletPdf = await buildWarehousePalletLabelsPdf({
                title: warehouse.code || warehouse.name || "Warehouse",
                pallets: [pallet],
              });
              downloadUint8ArrayAsFile(
                palletPdf,
                `${result.palletCode || result.palletId}-label.pdf`
              );
            }
          }
        } catch {
          /* optional */
        }
      } else {
        if (!walkClientId) throw new Error("Select a client.");
        if (walkType === "existing" && !walkProductId && !walkName.trim()) {
          throw new Error("Select an existing product or enter a name.");
        }
        if (walkType === "new" && !walkName.trim()) throw new Error("Enter a product name.");
        const { returnId } = await createWalkInReturnWithUser({
          ownerUserId: walkClientId,
          type: walkType,
          returnType: walkReturnType,
          productId: walkType === "existing" ? walkProductId || null : null,
          productName: walkType === "existing" ? walkName : null,
          sku: walkType === "existing" ? walkSku : null,
          newProductName: walkType === "new" ? walkName : null,
          newProductSku: walkType === "new" ? walkSku : null,
          requestedQuantity: parseInt(walkQty, 10) || 1,
          userRemarks: walkNotes.trim() || null,
          expiryDate: walkExpiry.trim() || null,
          operatorId,
        });
        toast({
          title: "Walk-in return created",
          description: `Approved · receive from Open / In progress (${returnId.slice(0, 8)}…)`,
        });
      }
      setFloorFlow("queue");
      setWalkPhase("pick-mode");
      setWalkName("");
      setWalkSku("");
      setWalkNotes("");
      setWalkClientId("");
      setWalkClientLabel("");
      setWalkUnknownName("");
      setWalkUnitType("carton");
      setWalkLot(generateCrossdockReceiveLot());
      setWalkQty("1");
    } catch (e) {
      toast({
        title: "Walk-in failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleLinkWalkIn() {
    if (!linkCartonId || !linkClientId) {
      toast({ title: "Select unit and client", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const carton = cartons.find((c) => c.id === linkCartonId);
      if (carton?.lines?.[0] && !carton.clientId) {
        await allocateLine({
          warehouseId: warehouse.id,
          cartonId: linkCartonId,
          lineId: carton.lines[0].lineId || "L1",
          clientId: linkClientId,
          operatorId,
        });
      }
      const { returnId } = await startReturnFromAllocatedWalkIn({
        warehouseId: warehouse.id,
        cartonId: linkCartonId,
        clientUserId: linkClientId,
        type: linkType,
        productName: linkType === "existing" ? linkName : null,
        sku: linkType === "existing" ? linkSku : null,
        newProductName: linkType === "new" ? linkName || "Return walk-in product" : null,
        newProductSku: linkType === "new" ? linkSku : null,
        requestedQuantity: parseInt(linkQty, 10) || carton?.quantity || 1,
        operatorId,
      });
      toast({
        title: "Return started",
        description: `Linked · receive / putaway (${returnId.slice(0, 8)}…)`,
      });
      setFloorFlow("queue");
      setLinkUnitQuery("");
    } catch (e) {
      toast({
        title: "Link failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  const loading = returnsLoading || liveLoading || clientsLoading;
  const activeWork = counts.pending + counts.open + counts.in_progress;

  return (
    <div className="space-y-5">
      <WarehouseOpsHeader
        title="Returns"
        description="Inbound-style receive · open/partial RMA · ship during receive · invoice on close"
      />


      {floorFlow !== "queue" ? (
        <ReturnsFloorFlows
          floorFlow={floorFlow}
          busy={busy}
          clients={clients}
          onBack={backToQueue}
          onWalkIn={() => void handleWalkIn()}
          onReceive={() => void handleReceive()}
          onLink={() => void handleLinkWalkIn()}
          walkPhase={walkPhase}
          setWalkPhase={setWalkPhase}
          walkInMode={walkInMode}
          setWalkInMode={setWalkInMode}
          walkClientId={walkClientId}
          walkClientLabel={walkClientLabel}
          setWalkClientId={setWalkClientId}
          setWalkClientLabel={setWalkClientLabel}
          walkType={walkType}
          setWalkType={setWalkType}
          walkReturnType={walkReturnType}
          setWalkReturnType={setWalkReturnType}
          walkName={walkName}
          setWalkName={setWalkName}
          walkSku={walkSku}
          setWalkSku={setWalkSku}
          walkProductId={walkProductId}
          setWalkProductId={setWalkProductId}
          walkInventory={walkInventory}
          walkInventoryLoading={walkInventoryLoading}
          walkExpiry={walkExpiry}
          setWalkExpiry={setWalkExpiry}
          walkQty={walkQty}
          setWalkQty={setWalkQty}
          walkNotes={walkNotes}
          setWalkNotes={setWalkNotes}
          walkUnknownName={walkUnknownName}
          setWalkUnknownName={setWalkUnknownName}
          walkUnitType={walkUnitType}
          setWalkUnitType={setWalkUnitType}
          walkLot={walkLot}
          setWalkLot={setWalkLot}
          selected={selected}
          priorLocations={priorLocations}
          recvPhase={recvPhase}
          setRecvPhase={setRecvPhase}
          recvUnitType={recvUnitType}
          setRecvUnitType={setRecvUnitType}
          recvSku={recvSku}
          setRecvSku={setRecvSku}
          recvTitle={recvTitle}
          setRecvTitle={setRecvTitle}
          recvQty={recvQty}
          setRecvQty={setRecvQty}
          recvLot={recvLot}
          setRecvLot={setRecvLot}
          recvExpiry={recvExpiry}
          setRecvExpiry={setRecvExpiry}
          recvCondition={recvCondition}
          setRecvCondition={setRecvCondition}
          recvNotes={recvNotes}
          setRecvNotes={setRecvNotes}
          recvCloseReady={recvCloseReady}
          setRecvCloseReady={setRecvCloseReady}
          recvTracking={recvTracking}
          setRecvTracking={setRecvTracking}
          recvPhotoFiles={recvPhotoFiles}
          recvPhotoPreviews={recvPhotoPreviews}
          onRecvPhotosChange={onRecvPhotosChange}
          unallocatedReturnCartons={unallocatedReturnCartons}
          filteredLinkUnits={filteredLinkUnits}
          selectedLinkUnit={selectedLinkUnit}
          linkUnitQuery={linkUnitQuery}
          setLinkUnitQuery={setLinkUnitQuery}
          linkCartonId={linkCartonId}
          pickLinkUnit={pickLinkUnit}
          linkClientId={linkClientId}
          linkClientLabel={linkClientLabel}
          setLinkClientId={setLinkClientId}
          setLinkClientLabel={setLinkClientLabel}
          linkType={linkType}
          setLinkType={setLinkType}
          linkName={linkName}
          setLinkName={setLinkName}
          linkSku={linkSku}
          setLinkSku={setLinkSku}
          linkQty={linkQty}
          setLinkQty={setLinkQty}
        />
      ) : (
      <>
      <Card className="overflow-hidden border-orange-200/70 bg-gradient-to-br from-orange-50/90 via-background to-slate-50/80 shadow-sm">
        <CardContent className="p-4 sm:p-5 space-y-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2 min-w-0">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-orange-600 text-white shadow-sm">
                  <ClipboardList className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold tracking-tight">Return floor queue</p>
                  <p className="text-xs text-muted-foreground">
                    {activeWork} active · {counts.closed} closed · warehouse {warehouse.code}
                  </p>
                </div>
              </div>
              <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
                {[
                  "Scan tracking",
                  "Approve",
                  "Receive + lot/label",
                  "Putaway",
                  "Ship (optional)",
                  "Close + invoice",
                ].map((step, i) => (
                  <li key={step} className="inline-flex items-center gap-1.5">
                    {i > 0 && <span className="text-orange-300">→</span>}
                    <span className="rounded-md bg-background/80 border border-border/60 px-2 py-0.5 text-foreground/80">
                      {step}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <Button
                size="sm"
                className="bg-orange-600 hover:bg-orange-700"
                onClick={openWalkIn}
              >
                <UserPlus className="h-4 w-4 mr-1.5" />
                Walk-in return
              </Button>
              {unallocatedReturnCartons.length > 0 && (
                <Button size="sm" variant="secondary" onClick={openLinkUnallocated}>
                  <Package className="h-4 w-4 mr-1.5" />
                  Link unallocated
                  <Badge className="ml-1.5 bg-orange-600 hover:bg-orange-600 text-[10px] px-1.5">
                    {unallocatedReturnCartons.length}
                  </Badge>
                </Button>
              )}
              <Button size="sm" variant="outline" asChild>
                <Link href="/warehouse-ops/putaway">
                  <MapPin className="h-4 w-4 mr-1.5" />
                  Putaway
                </Link>
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-orange-200/80 bg-background/80 p-3 space-y-2">
            <Label className="text-xs flex items-center gap-1.5">
              <ScanLine className="h-3.5 w-3.5" />
              Scan return tracking (like inbound docking)
            </Label>
            <div className="flex gap-2">
              <Input
                value={trackingScan}
                onChange={(e) => setTrackingScan(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyTrackingScan(trackingScan);
                }}
                placeholder="Camera or type tracking #"
                className="flex-1 h-9"
                autoComplete="off"
              />
              <ScanCameraButton
                onScan={(text) => applyTrackingScan(text)}
                scannerTitle="Scan return tracking"
                scannerDescription="Match product return requests that share this tracking."
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => applyTrackingScan(trackingScan)}
              >
                Find
              </Button>
            </div>
            {trackingScan.trim() && trackingMatches.length > 0 ? (
              <p className="text-[11px] text-muted-foreground">
                {trackingMatches.length} match
                {trackingMatches.length === 1 ? "" : "es"} —{" "}
                {trackingMatches
                  .slice(0, 3)
                  .map((r) => resolveReturnProductName(r))
                  .join(", ")}
                {trackingMatches.length > 3 ? "…" : ""}
              </p>
            ) : trackingScan.trim() ? (
              <p className="text-[11px] text-muted-foreground">
                No open return with this tracking. Walk-in if it arrived without a request.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {(
          [
            {
              id: "pending" as StatusTab,
              label: "Pending",
              count: counts.pending,
              icon: Inbox,
              accent: "border-amber-200 bg-amber-50/60",
              iconClass: "text-amber-700",
            },
            {
              id: "open" as StatusTab,
              label: "Open",
              count: counts.open,
              icon: PackagePlus,
              accent: "border-sky-200 bg-sky-50/60",
              iconClass: "text-sky-700",
            },
            {
              id: "in_progress" as StatusTab,
              label: "In progress",
              count: counts.in_progress,
              icon: Package,
              accent: "border-orange-200 bg-orange-50/70",
              iconClass: "text-orange-700",
            },
            {
              id: "closed" as StatusTab,
              label: "Closed",
              count: counts.closed,
              icon: Archive,
              accent: "border-slate-200 bg-slate-50/80",
              iconClass: "text-slate-600",
            },
          ] as const
        ).map((stat) => {
          const Icon = stat.icon;
          const active = tab === stat.id;
          return (
            <button
              key={stat.id}
              type="button"
              onClick={() => setTab(stat.id)}
              className={cn(
                "rounded-xl border px-3 py-3 text-left transition-all hover:shadow-sm",
                stat.accent,
                active && "ring-2 ring-orange-500/40 shadow-sm"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <Icon className={cn("h-4 w-4", stat.iconClass)} />
                <span className="text-xl font-bold tabular-nums tracking-tight">{stat.count}</span>
              </div>
              <p className="mt-1 text-xs font-medium text-foreground/80">{stat.label}</p>
            </button>
          );
        })}
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-3 space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Queue</CardTitle>
              <CardDescription className="text-xs">
                Search and work returns by status — partial receives stay open until complete.
              </CardDescription>
            </div>
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8 h-9 text-sm"
                placeholder="Search client, product, SKU, tracking…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <Tabs value={tab} onValueChange={(v) => setTab(v as StatusTab)}>
            <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-muted/50 p-1">
              {TAB_META.map((t) => {
                const count =
                  t.id === "pending"
                    ? counts.pending
                    : t.id === "open"
                      ? counts.open
                      : t.id === "in_progress"
                        ? counts.in_progress
                        : t.id === "closed"
                          ? counts.closed
                          : counts.all;
                return (
                  <TabsTrigger
                    key={t.id}
                    value={t.id}
                    className={cn(
                      "flex-1 min-w-[5.5rem] gap-1.5 rounded-md px-2.5 py-2 data-[state=active]:shadow-sm",
                      t.tone
                    )}
                  >
                    <span className="text-xs font-semibold">{t.label}</span>
                    <span className="rounded-full bg-black/10 px-1.5 py-0 text-[10px] font-bold tabular-nums">
                      {count}
                    </span>
                  </TabsTrigger>
                );
              })}
            </TabsList>

            <TabsContent value={tab} className="mt-4 space-y-3 focus-visible:outline-none">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading returns…
                </div>
              ) : filtered.length === 0 ? (
                <div className="rounded-xl border border-dashed bg-muted/20 px-6 py-14 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                    <Inbox className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium">No returns in this queue</p>
                  <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
                    {tab === "pending"
                      ? "Nothing waiting for approval. Check Open or start a walk-in."
                      : tab === "open" || tab === "in_progress"
                        ? "No receive work here — try another tab or Walk-in return."
                        : "Try another status tab or clear search."}
                  </p>
                  {(tab === "pending" || tab === "open") && (
                    <Button
                      size="sm"
                      className="mt-4 bg-orange-600 hover:bg-orange-700"
                      onClick={openWalkIn}
                    >
                      <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                      Walk-in return
                    </Button>
                  )}
                </div>
              ) : (
                filtered.map((row) => {
                  const owner = getReturnOwnerId(row);
                  const client = clientById.get(owner);
                  const rem = Math.max(
                    0,
                    (row.requestedQuantity || 0) - (row.receivedQuantity || 0)
                  );
                  const shipAvail = Math.max(
                    0,
                    (row.receivedQuantity || 0) - (row.shippedQuantity || 0)
                  );
                  const canManage =
                    row.status === "approved" || row.status === "in_progress";
                  const credited = row.inventoryCreditedQuantity || 0;
                  return (
                    <div
                      key={`${owner}-${row.id}`}
                      className={cn(
                        "rounded-xl border bg-card p-3.5 sm:p-4 shadow-sm transition-colors",
                        "hover:border-orange-300/70 hover:bg-orange-50/20",
                        row.status === "pending" && "border-l-4 border-l-amber-400",
                        row.status === "approved" && "border-l-4 border-l-sky-400",
                        row.status === "in_progress" && "border-l-4 border-l-orange-500"
                      )}
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 space-y-2 flex-1">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-semibold text-sm tracking-tight truncate">
                                {displayName(client, owner)}
                              </p>
                              <p className="text-sm text-foreground/90 mt-0.5">
                                {resolveReturnProductName(row)}
                              </p>
                              {resolveReturnSku(row) ? (
                                <p className="text-xs font-mono text-muted-foreground mt-0.5">
                                  {resolveReturnSku(row)}
                                </p>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap gap-1 justify-end">
                              <StatusBadge status={row.status} />
                              <Badge variant="outline" className="text-[10px] font-normal">
                                {row.type === "existing" ? "Existing" : "New"}
                              </Badge>
                              {row.returnType ? (
                                <Badge
                                  variant="secondary"
                                  className="text-[10px] font-normal capitalize"
                                >
                                  {row.returnType}
                                </Badge>
                              ) : null}
                              {row.source === "warehouse_ops_walk_in" ? (
                                <Badge variant="outline" className="text-[10px] font-normal">
                                  Walk-in
                                </Badge>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-end gap-4 sm:gap-6">
                            <ReceiveProgress
                              received={row.receivedQuantity || 0}
                              requested={row.requestedQuantity || 0}
                            />
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                              {rem > 0 ? (
                                <span>
                                  <span className="font-semibold text-orange-700">{rem}</span> left
                                  to receive
                                </span>
                              ) : (
                                <span className="text-emerald-700 font-medium">Fully received</span>
                              )}
                              {shipAvail > 0 ? (
                                <span>
                                  <span className="font-semibold text-foreground">{shipAvail}</span>{" "}
                                  shippable
                                </span>
                              ) : null}
                              {credited > 0 ? (
                                <span>
                                  <span className="font-semibold text-foreground">{credited}</span>{" "}
                                  in inventory
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2 lg:justify-end lg:max-w-[16rem] shrink-0">
                          {row.status === "pending" && (
                            <>
                              <Button
                                size="sm"
                                className="bg-emerald-600 hover:bg-emerald-700"
                                disabled={busy}
                                onClick={() => void handleApprove(row)}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => {
                                  setSelected(row);
                                  setRejectOpen(true);
                                }}
                              >
                                <XCircle className="h-3.5 w-3.5 mr-1" />
                                Reject
                              </Button>
                            </>
                          )}
                          {canManage && (
                            <>
                              <Button
                                size="sm"
                                className="bg-orange-600 hover:bg-orange-700"
                                disabled={busy || rem < 1}
                                onClick={() => openReceive(row)}
                              >
                                <PackagePlus className="h-3.5 w-3.5 mr-1" />
                                Receive{rem > 0 ? ` (${rem})` : ""}
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={busy || shipAvail < 1}
                                onClick={() => openShip(row)}
                              >
                                <Ship className="h-3.5 w-3.5 mr-1" />
                                Ship
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy || (row.receivedQuantity || 0) < 1}
                                onClick={() => openClose(row)}
                              >
                                <FileText className="h-3.5 w-3.5 mr-1" />
                                Close + invoice
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
      </>
      )}

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject return</DialogTitle>
            <DialogDescription>Reason is required.</DialogDescription>
          </DialogHeader>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Reason…"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy || !rejectReason.trim()}
              onClick={() => void handleReject()}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ship */}
      <Dialog open={shipOpen} onOpenChange={setShipOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ship return qty</DialogTitle>
            <DialogDescription>
              Updates shipped orders (no outbound request required). Optional ship
              invoice.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Quantity</Label>
              <Input
                type="number"
                min={1}
                value={shipQty}
                onChange={(e) => setShipQty(e.target.value)}
              />
            </div>
            <div>
              <Label>Ship to</Label>
              <Input value={shipTo} onChange={(e) => setShipTo(e.target.value)} />
            </div>
            <div>
              <Label>Unit shipping price (optional)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={shipUnitPrice}
                onChange={(e) => setShipUnitPrice(e.target.value)}
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={shipNotes} onChange={(e) => setShipNotes(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={shipInvoice}
                onCheckedChange={(v) => setShipInvoice(v === true)}
              />
              Generate shipping invoice PDF
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShipOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void handleShip()}>
              Ship
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close + invoice */}
      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Close return & invoice</DialogTitle>
            <DialogDescription>
              Same pricing as admin Product Returns. Inventory not yet credited via
              Return QC is credited here (minus shipped).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Return handling fee (per unit) *</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={returnFee}
                onChange={(e) => setReturnFee(e.target.value)}
              />
              {selected && (
                <p className="text-xs text-muted-foreground mt-1">
                  Total handling: $
                  {(
                    (parseFloat(returnFee) || 0) * (selected.receivedQuantity || 0)
                  ).toFixed(2)}{" "}
                  ({selected.receivedQuantity} units)
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Packing fee</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={packingFee}
                  onChange={(e) => setPackingFee(e.target.value)}
                />
              </div>
              <div>
                <Label>Box qty</Label>
                <Input
                  type="number"
                  min={1}
                  value={boxQuantity}
                  onChange={(e) => setBoxQuantity(e.target.value)}
                />
              </div>
              <div>
                <Label>Pallet fee</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={palletFee}
                  onChange={(e) => setPalletFee(e.target.value)}
                />
              </div>
              <div>
                <Label>Pallet qty</Label>
                <Input
                  type="number"
                  min={1}
                  value={palletQuantity}
                  onChange={(e) => setPalletQuantity(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label>Shipping unit price (if shipping remaining)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={closeShipUnit}
                onChange={(e) => setCloseShipUnit(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={shipRemainingOnClose}
                onCheckedChange={(v) => setShipRemainingOnClose(v === true)}
              />
              Ship remaining received qty on close
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={generateInvoice}
                onCheckedChange={(v) => setGenerateInvoice(v === true)}
              />
              Generate invoice PDF
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={busy || returnFee === "" || isNaN(parseFloat(returnFee))}
              onClick={() => void handleClose()}
            >
              {generateInvoice ? "Close & invoice" : "Close"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      
    </div>
  );
}
