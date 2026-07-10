"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useWarehouseOpsClients } from "@/hooks/use-warehouse-ops-clients";
import { useAuth } from "@/hooks/use-auth";
import { WarehouseOpsHeader } from "@/components/warehouse-ops/warehouse-ops-header";
import { uploadReceivePhotos } from "@/lib/inbound-receive-photos";
import {
  ReceiveStorageAssignmentDialog,
  type ReceiveStorageAssignContext,
} from "@/components/warehouse-ops/receive-storage-assignment-dialog";
import type { WarehouseDoc, WarehouseCartonDoc } from "@/types";
import {
  createCrossdockPalletReceive,
  createReceiveBatch,
  createContainerReceive,
  listWarehouseCartons,
  listWarehousePallets,
} from "@/lib/warehouse-carton-firestore";
import { printContainerLabels } from "@/lib/warehouse-container-label-pdf";
import {
  buildWarehouseCartonLabelsPdf,
  downloadUint8ArrayAsFile,
} from "@/lib/warehouse-carton-label-pdf";
import { buildWarehousePalletLabelsPdf } from "@/lib/warehouse-pallet-label-pdf";
import { buildWarehousePackageLabelsPdf } from "@/lib/warehouse-package-label-pdf";
import {
  Loader2,
  Plus,
  Trash2,
  Package,
  Printer,
  Copy,
  AlertTriangle,
  Layers,
  ChevronRight,
  ArrowLeft,
  PackageOpen,
  Boxes,
  ScanLine,
  RotateCcw,
  ArrowRightLeft,
  Truck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { detectCarrier } from "@/lib/carrier-detect";
import {
  describeReceiveLotHint,
  describeReceiveLotPattern,
} from "@/lib/warehouse-receive-lot";
import { ScanLookupPopover } from "@/components/warehouse-ops/scan-lookup-popover";
import { ScanCameraButton } from "@/components/warehouse-ops/scan-camera-button";
import {
  QuickScanDialog,
  type QuickScanLine,
} from "@/components/warehouse-ops/quick-scan-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WarehouseOpsReceiveCorrection } from "@/components/warehouse-ops/warehouse-ops-receive-correction";
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
import { isOpsSupervisor } from "@/lib/warehouse-ops-permissions";
import { useCollection } from "@/hooks/use-collection";
import type { UserProfile } from "@/types";
import { generateCrossdockReceiveLot } from "@/lib/warehouse-crossdock";
import { CrossdockClientCombobox } from "@/components/warehouse-ops/crossdock-client-combobox";
import { WarehouseOpsDockIntake } from "@/components/warehouse-ops/warehouse-ops-dock-intake";
import { WarehouseOpsReturnReceive } from "@/components/warehouse-ops/warehouse-ops-return-receive";
import {
  inboundRequestPrefill,
  recordInboundReceiveBatch,
  reloadInboundRequestRow,
  validateInboundReceiveQty,
  completeContainerInboundRequest,
} from "@/lib/warehouse-inbound-receive";
import {
  loadInboundRequestQueue,
  type InboundRequestRow,
} from "@/lib/warehouse-inbound-requests";
import {
  InboundRequestLinePicker,
  inboundLineLinkFromRow,
  inboundRequestOptionValue,
  parseInboundRequestOptionValue,
} from "@/components/warehouse-ops/inbound-request-line-picker";
import type { ReturnRequestRow } from "@/lib/warehouse-returns";
import {
  batchHasPutaway,
  clearStoredLastBatch,
  readStoredLastBatch,
  voidWarehouseCartons,
  writeStoredLastBatch,
  type StoredReceiveFormSnapshot,
} from "@/lib/warehouse-receive-corrections";

type ReceiveType = "carton" | "pallet" | "loose" | "container";
/** crossdock = closed labels only; loose module = open receiving at dock */
type ReceiveModule = "crossdock" | "loose";
type ReceivePhase = "dock-intake" | "return-receive" | "hub" | "pick-package" | "form";

function isContainerInbound(row: { inventoryType?: string }): boolean {
  return row.inventoryType === "container";
}

type LineDraft = {
  id: string;
  sku: string;
  productTitle: string;
  goodQty: string;
  damagedQty: string;
  lot: string;
  expiry: string;
  inventoryRequestId?: string;
  clientId?: string;
  clientLabel?: string;
};

type CartonDraft = {
  id: string;
  copies: string;
  lines: LineDraft[];
  /** Cross-dock minimal receive */
  clientId?: string;
  /** Display name — from system client or typed manually */
  clientLabel?: string;
  crossdockLot?: string;
  /** Client inventory request linked at dock intake */
  inventoryRequestId?: string;
};

type Props = {
  warehouse: WarehouseDoc;
};

const CARRIERS = ["UPS", "FedEx", "USPS", "DHL", "Amazon Logistics", "Other"];

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function newLine(): LineDraft {
  return {
    id: uid("ln"),
    sku: "",
    productTitle: "",
    goodQty: "1",
    damagedQty: "0",
    lot: "",
    expiry: "",
  };
}

function newCarton(): CartonDraft {
  return { id: uid("ctn"), copies: "1", lines: [newLine()] };
}

function newCrossdockCarton(): CartonDraft {
  return {
    id: uid("ctn"),
    copies: "1",
    lines: [],
    clientId: "",
    clientLabel: "",
    crossdockLot: generateCrossdockReceiveLot(),
  };
}

function cartonsFromInboundRequests(rows: InboundRequestRow[], crossdock: boolean): CartonDraft[] {
  if (rows.length === 0) {
    return [crossdock ? newCrossdockCarton() : newCarton()];
  }
  // Container inbound: empty open-receive carton prefilled with client (enter SKUs inside).
  if (rows.every(isContainerInbound)) {
    const row = rows[0];
    return [
      {
        ...newCarton(),
        clientId: row.clientUserId,
        clientLabel: row.clientDisplayName,
        inventoryRequestId: row.id,
        lines: [
          {
            id: crypto.randomUUID(),
            sku: "",
            productTitle: "",
            goodQty: "1",
            damagedQty: "0",
            lot: "",
            expiry: "",
            clientId: row.clientUserId,
            clientLabel: row.clientDisplayName,
            inventoryRequestId: row.id,
          },
        ],
      },
    ];
  }
  if (crossdock) {
    return rows.map((row) => {
      const pre = inboundRequestPrefill(row);
      return {
        ...newCrossdockCarton(),
        clientId: pre.clientUserId,
        clientLabel: pre.clientDisplayName,
        inventoryRequestId: pre.inventoryRequestId,
      };
    });
  }
  return [
    {
      ...newCarton(),
      lines: rows.map((row) => {
        const pre = inboundRequestPrefill(row);
        return {
          ...newLine(),
          sku: pre.sku,
          productTitle: pre.productName,
          goodQty: String(Math.max(1, pre.remainingQty || 1)),
          expiry: pre.expiry,
          inventoryRequestId: pre.inventoryRequestId,
          clientId: pre.clientUserId,
          clientLabel: pre.clientDisplayName,
        };
      }),
    },
  ];
}

function moduleFromSnapshot(snap: StoredReceiveFormSnapshot): ReceiveModule {
  if (snap.type === "loose" && !snap.cartons.some((c) => c.crossdockLot)) return "loose";
  if (snap.type === "loose" && snap.cartons.some((c) => c.crossdockLot)) return "crossdock";
  if (snap.palletCrossdockLot) return "crossdock";
  if (snap.cartons.some((c) => c.crossdockLot)) return "crossdock";
  return "loose";
}

export function WarehouseOpsReceiving({ warehouse }: Props) {
  const { toast } = useToast();
  const { clients, loading: clientsLoading } = useWarehouseOpsClients({
    includeUnapproved: true,
  });

  const [tab, setTab] = useState<"receive" | "correct">("receive");
  const [phase, setPhase] = useState<ReceivePhase>("dock-intake");
  const [module, setModule] = useState<ReceiveModule | null>(null);
  const [type, setType] = useState<ReceiveType | null>(null);
  const [formRestore, setFormRestore] = useState<StoredReceiveFormSnapshot | null>(null);
  const [restoreKey, setRestoreKey] = useState(0);
  const [selectedReturn, setSelectedReturn] = useState<ReturnRequestRow | null>(null);
  const [selectedInbounds, setSelectedInbounds] = useState<InboundRequestRow[]>([]);
  const [dockTracking, setDockTracking] = useState("");

  function startModule(m: ReceiveModule) {
    setModule(m);
    setPhase("pick-package");
    setType(null);
  }

  function pickPackage(t: ReceiveType) {
    setType(t);
    setPhase("form");
  }

  function backFromPickPackage() {
    setPhase("hub");
    setModule(null);
    setType(null);
  }

  function handleDockInbound(rows: InboundRequestRow[], tracking: string) {
    setSelectedInbounds(rows);
    setDockTracking(tracking);
    setSelectedReturn(null);
    setPhase("hub");
  }

  function handleDockReturn(row: ReturnRequestRow, tracking: string) {
    setSelectedReturn(row);
    setDockTracking(tracking);
    setPhase("return-receive");
  }

  function handleDockWalkIn(tracking: string) {
    setDockTracking(tracking);
    setSelectedReturn(null);
    setSelectedInbounds([]);
    setPhase("hub");
  }

  function backToDockIntake() {
    setSelectedReturn(null);
    setSelectedInbounds([]);
    setPhase("dock-intake");
  }

  function backFromForm() {
    if (type === "loose" && module === "loose") {
      setPhase("hub");
      setModule(null);
      setType(null);
    } else {
      setPhase("pick-package");
      setType(null);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <WarehouseOpsHeader title="Receiving" />
      <Tabs value={tab} onValueChange={(v) => setTab(v as "receive" | "correct")}>
        <TabsList>
          <TabsTrigger value="receive">Receive</TabsTrigger>
          <TabsTrigger value="correct">Correct receive</TabsTrigger>
        </TabsList>
        <TabsContent value="receive" className="mt-4 space-y-4">
          {phase === "dock-intake" ? (
            <WarehouseOpsDockIntake
              warehouse={warehouse}
              clients={clients}
              clientsLoading={clientsLoading}
              onInbound={handleDockInbound}
              onReturn={handleDockReturn}
              onWalkIn={handleDockWalkIn}
            />
          ) : phase === "return-receive" && selectedReturn ? (
            <WarehouseOpsReturnReceive
              warehouse={warehouse}
              returnRow={selectedReturn}
              tracking={dockTracking}
              onBack={backToDockIntake}
              onDone={backToDockIntake}
            />
          ) : phase === "hub" ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  Choose how this inbound is handled at the dock. Cross-dock stays closed until
                  putaway; open receiving is counted and entered here.
                </p>
                <Button variant="ghost" size="sm" onClick={backToDockIntake}>
                  <ScanLine className="h-4 w-4 mr-1" />
                  Dock scan
                </Button>
              </div>
              {dockTracking ? (
                <p className="text-xs font-mono text-muted-foreground">
                  Tracking: {dockTracking}
                </p>
              ) : null}
              {selectedInbounds.length > 0 ? (
                <Card className="border-blue-200/80 bg-blue-50/40">
                  <CardContent className="py-3 text-sm space-y-2">
                    <p className="font-medium text-blue-900">
                      Dock matched {selectedInbounds.length} request
                      {selectedInbounds.length === 1 ? "" : "s"}
                    </p>
                    <ul className="space-y-1 text-xs">
                      {selectedInbounds.map((row) => (
                        <li key={`${row.clientUserId}:${row.id}`}>
                          {row.clientDisplayName} — {row.productName}
                          {row.sku ? ` (${row.sku})` : ""} · {row.remainingQty} left
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-blue-900/80">
                      {selectedInbounds.every(isContainerInbound) ? (
                        <>
                          <strong>Container</strong> inbound — use <strong>Open receiving</strong>{" "}
                          to count products inside (inventory + close request), or receive the
                          container shell first (counts + CTR label).
                        </>
                      ) : (
                        <>
                          Receiver chooses: <strong>Cross-dock</strong> (closed — ship or putaway)
                          or <strong>Open receiving</strong> (count SKUs → client inventory).
                        </>
                      )}
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setSelectedInbounds([])}
                    >
                      Clear dock match (walk-in)
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <Card className="border-amber-200/80 bg-amber-50/40">
                  <CardContent className="py-3 text-sm space-y-1">
                    <p className="font-medium text-amber-950">No request selected (walk-in)</p>
                    <p className="text-xs text-amber-950/80">
                      Receive with <strong>lot + photos + one label</strong> only. When you know the
                      client, use <strong>Open receiving</strong>, assign that user, count SKUs —
                      then putaway so inventory shows in their table.
                    </p>
                  </CardContent>
                </Card>
              )}
              <TypePickerCard
                color="indigo"
                icon={<ArrowRightLeft className="h-8 w-8" />}
                title={
                  selectedInbounds.length === 0
                    ? "Walk-in / closed receive"
                    : "Cross-dock receiving"
                }
                description={
                  selectedInbounds.length === 0
                    ? "No request — generate lot, take photos, print one label (carton, pallet, package, or container). No SKUs yet."
                    : "Closed cartons, pallets, or polybags — labels only. Then ship or putaway. SKUs later if kept."
                }
                onClick={() => startModule("crossdock")}
              />
              <TypePickerCard
                color="emerald"
                icon={<PackageOpen className="h-8 w-8" />}
                title="Open receiving"
                description={
                  selectedInbounds.length === 0
                    ? "Client must be known — assign the user, count SKUs into their inventory, then putaway."
                    : "Open and count at the dock — products go to client inventory after putaway; inbound closes."
                }
                onClick={() => startModule("loose")}
              />
            </>
          ) : phase === "pick-package" && module === "crossdock" ? (
            <>
              <Button variant="ghost" size="sm" className="-ml-2" onClick={backFromPickPackage}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
              <p className="text-sm text-muted-foreground">
                {selectedInbounds.length === 0
                  ? "Walk-in — lot + photos + one label (no SKUs yet)"
                  : "Cross-dock — what are you receiving?"}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-emerald-300 text-emerald-900 hover:bg-emerald-50 w-fit"
                onClick={() => {
                  setModule("loose");
                  setFormRestore(null);
                  setType(null);
                }}
              >
                <PackageOpen className="h-4 w-4 mr-1" />
                Switch to open receiving instead
              </Button>
              <div className="grid gap-3 sm:grid-cols-2">
                <TypePickerCard
                  color="orange"
                  icon={<Package className="h-8 w-8" />}
                  title="Carton"
                  description="One closed carton — CTN label, auto lot, photos. SKUs when client is known."
                  onClick={() => pickPackage("carton")}
                />
                <TypePickerCard
                  color="indigo"
                  icon={<Boxes className="h-8 w-8" />}
                  title="Pallet"
                  description="One closed pallet — PLT label, auto lot, photos."
                  onClick={() => pickPackage("pallet")}
                />
                <TypePickerCard
                  color="emerald"
                  icon={<PackageOpen className="h-8 w-8" />}
                  title="Package / polybag"
                  description="Closed bag — PKG label, auto lot, photos."
                  onClick={() => pickPackage("loose")}
                />
                <TypePickerCard
                  color="orange"
                  icon={<Truck className="h-8 w-8" />}
                  title="Container"
                  description="Count cartons/pallets/packages inside — one CTR label, lot, photos."
                  onClick={() => pickPackage("container")}
                />
              </div>
            </>
          ) : phase === "pick-package" && module === "loose" ? (
            <>
              <Button variant="ghost" size="sm" className="-ml-2" onClick={backFromPickPackage}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
              <p className="text-sm text-muted-foreground">
                {selectedInbounds.length === 0
                  ? "Client known — count SKUs into their inventory (required). Unknown owner? Use Walk-in / closed receive first."
                  : "Open receiving — open, inspect, and enter SKUs at the dock."}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <TypePickerCard
                  color="orange"
                  icon={<Package className="h-8 w-8" />}
                  title="Carton"
                  description="Open each carton — which products inside and how many units per SKU."
                  onClick={() => pickPackage("carton")}
                />
                <TypePickerCard
                  color="indigo"
                  icon={<Boxes className="h-8 w-8" />}
                  title="Pallet"
                  description="Count cartons on the pallet; for each carton enter products and SKU quantities."
                  onClick={() => pickPackage("pallet")}
                />
                <TypePickerCard
                  color="emerald"
                  icon={<PackageOpen className="h-8 w-8" />}
                  title="Packages / polybags"
                  description="Small bags or totes — one PKG label with full SKU manifest. Scan PKG at putaway."
                  onClick={() => pickPackage("loose")}
                />
                {selectedInbounds.some(isContainerInbound) ? (
                  <TypePickerCard
                    color="orange"
                    icon={<Truck className="h-8 w-8" />}
                    title="Container shell"
                    description="Optional CTR label for the container first — then open-receive SKUs with the client."
                    onClick={() => pickPackage("container")}
                  />
                ) : null}
              </div>
            </>
          ) : type && module ? (
            <ReceiveForm
              key={`receive-${module}-${type}-${restoreKey}-${selectedInbounds.map((r) => r.id).join(",") || "none"}`}
              warehouse={warehouse}
              type={type}
              receiveModule={module}
              receiveMode={module === "loose" ? "unpackaged" : "crossdock"}
              inboundRequests={selectedInbounds}
              dockTracking={dockTracking}
              clients={clients}
              onInboundRequestsChange={setSelectedInbounds}
              onBack={backFromForm}
              onSwitchToOpenReceive={
                module === "crossdock"
                  ? () => {
                      setModule("loose");
                      setFormRestore(null);
                      setPhase("pick-package");
                      setType(null);
                    }
                  : undefined
              }
              initialSnapshot={formRestore}
              onSnapshotConsumed={() => setFormRestore(null)}
              onRestoreForm={(snap) => {
                setFormRestore(snap);
                setModule(moduleFromSnapshot(snap));
                setType(snap.type);
                setPhase("form");
                setRestoreKey((k) => k + 1);
              }}
            />
          ) : null}
        </TabsContent>
        <TabsContent value="correct" className="mt-4">
          <WarehouseOpsReceiveCorrection warehouse={warehouse} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TypePickerCard({
  color,
  icon,
  title,
  description,
  onClick,
}: {
  color: "orange" | "indigo" | "emerald";
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  const colorMap = {
    orange: "border-orange-200 hover:border-orange-400 hover:bg-orange-50/40 text-orange-600",
    indigo: "border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50/40 text-indigo-600",
    emerald: "border-emerald-200 hover:border-emerald-400 hover:bg-emerald-50/40 text-emerald-600",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl border-2 p-5 text-left transition-colors flex flex-col items-start gap-3 h-full",
        colorMap[color]
      )}
    >
      <div className={cn(colorMap[color].split(" ").pop())}>{icon}</div>
      <div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </div>
    </button>
  );
}

function ReceiveForm({
  warehouse,
  type,
  receiveModule,
  receiveMode,
  inboundRequests = [],
  dockTracking,
  clients: clientsForReload,
  onInboundRequestsChange,
  onBack,
  onSwitchToOpenReceive,
  initialSnapshot,
  onSnapshotConsumed,
  onRestoreForm,
}: {
  warehouse: WarehouseDoc;
  type: ReceiveType;
  receiveModule: ReceiveModule;
  receiveMode: "crossdock" | "unpackaged";
  inboundRequests?: InboundRequestRow[];
  dockTracking?: string;
  clients: UserProfile[];
  onInboundRequestsChange?: (rows: InboundRequestRow[]) => void;
  onBack: () => void;
  /** Cross-dock → open receiving (count SKUs into inventory). Keeps dock-matched requests. */
  onSwitchToOpenReceive?: () => void;
  initialSnapshot?: StoredReceiveFormSnapshot | null;
  onSnapshotConsumed?: () => void;
  onRestoreForm?: (snap: StoredReceiveFormSnapshot) => void;
}) {
  const { toast } = useToast();
  const { user, userProfile } = useAuth();
  const supervisor = isOpsSupervisor(userProfile);
  const operatorName = userProfile?.name || userProfile?.email || user?.uid || null;
  const operatorId = user?.uid ?? null;
  const isCrossdockCarton = receiveModule === "crossdock" && type === "carton";
  const isCrossdockPackage = receiveModule === "crossdock" && type === "loose";
  const isCrossdockClosedUnit = isCrossdockCarton || isCrossdockPackage;
  const isCrossdockPalletOnly = receiveModule === "crossdock" && type === "pallet";

  const { data: allUsers } = useCollection<UserProfile>("users");
  const clients = useMemo(
    () =>
      allUsers
        .filter((u) => u.role === "user" || (u.roles ?? []).includes("user"))
        .sort((a, b) =>
          (a.name || a.email || a.uid).localeCompare(b.name || b.email || b.uid)
        ),
    [allUsers]
  );
  const clientById = useMemo(() => new Map(clients.map((c) => [c.uid, c])), [clients]);

  const [trackingNumber, setTrackingNumber] = useState(
    initialSnapshot?.trackingNumber ?? dockTracking ?? ""
  );
  const [carrier, setCarrier] = useState<string>(initialSnapshot?.carrier ?? "");
  const [carrierAutoDetected, setCarrierAutoDetected] = useState(
    initialSnapshot?.carrierAutoDetected ?? false
  );
  const [notes, setNotes] = useState(initialSnapshot?.notes ?? "");
  const [receivePhotoFiles, setReceivePhotoFiles] = useState<File[]>([]);
  const [receivePhotoPreviews, setReceivePhotoPreviews] = useState<string[]>([]);
  const [shipmentClientId, setShipmentClientId] = useState(
    initialSnapshot?.shipmentClientId ?? ""
  );
  const [shipmentClientLabel, setShipmentClientLabel] = useState(
    initialSnapshot?.shipmentClientLabel ?? ""
  );
  const [palletDraft, setPalletDraft] = useState({
    clientId: initialSnapshot?.palletClientId ?? "",
    clientLabel: initialSnapshot?.palletClientLabel ?? "",
    crossdockLot:
      initialSnapshot?.palletCrossdockLot ?? generateCrossdockReceiveLot(),
  });
  const [cartons, setCartons] = useState<CartonDraft[]>(() => {
    if (isCrossdockPalletOnly) return [];
    if (initialSnapshot?.cartons?.length) {
      return initialSnapshot.cartons.map((c) =>
        isCrossdockClosedUnit
          ? {
              ...c,
              clientId: c.clientId ?? "",
              clientLabel: c.clientLabel ?? "",
              crossdockLot: c.crossdockLot ?? generateCrossdockReceiveLot(),
            }
          : c
      );
    }
    return isCrossdockClosedUnit ? [newCrossdockCarton()] : [newCarton()];
  });
  const [saving, setSaving] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [storageDialogOpen, setStorageDialogOpen] = useState(false);
  const [storageAssignContext, setStorageAssignContext] =
    useState<ReceiveStorageAssignContext | null>(null);
  const [quickScanCartonId, setQuickScanCartonId] = useState<string | null>(null);
  const [inboundQueue, setInboundQueue] = useState<InboundRequestRow[]>([]);
  const inboundPrefillKeyRef = useRef<string | null>(null);

  const reloadInboundQueue = useCallback(async () => {
    const rows = await loadInboundRequestQueue({
      warehouse,
      clients: clientsForReload,
      dockQueue: true,
    });
    setInboundQueue(rows);
    return rows;
  }, [warehouse, clientsForReload]);

  useEffect(() => {
    void reloadInboundQueue();
  }, [reloadInboundQueue]);

  useEffect(() => {
    if (initialSnapshot || inboundRequests.length === 0) return;
    const key = `${inboundRequests.map((r) => `${r.clientUserId}:${r.id}`).join("|")}:${type}:${receiveModule}`;
    if (inboundPrefillKeyRef.current === key) return;
    inboundPrefillKeyRef.current = key;

    const primary = inboundRequests[0];
    const pre = inboundRequestPrefill(primary);
    if (dockTracking?.trim()) {
      setTrackingNumber(dockTracking.trim());
    }
    setShipmentClientId(pre.clientUserId);
    setShipmentClientLabel(pre.clientDisplayName);

    if (isCrossdockPalletOnly) {
      setPalletDraft((p) => ({
        ...p,
        clientId: pre.clientUserId,
        clientLabel: pre.clientDisplayName,
      }));
      return;
    }

    if (isCrossdockClosedUnit || receiveModule === "loose") {
      setCartons(cartonsFromInboundRequests(inboundRequests, isCrossdockClosedUnit));
    }
  }, [
    inboundRequests,
    initialSnapshot,
    type,
    receiveModule,
    isCrossdockClosedUnit,
    isCrossdockPalletOnly,
    dockTracking,
  ]);

  useEffect(() => {
    if (initialSnapshot) onSnapshotConsumed?.();
  }, [initialSnapshot, onSnapshotConsumed]);

  function handleTrackingChange(value: string) {
    setTrackingNumber(value);
    const detected = detectCarrier(value);
    if (detected && (!carrier || carrierAutoDetected)) {
      setCarrier(detected);
      setCarrierAutoDetected(true);
    } else if (!detected && carrierAutoDetected) {
      setCarrier("");
      setCarrierAutoDetected(false);
    }
  }
  const [lastBatch, setLastBatch] = useState<{
    palletCode: string | null;
    palletId?: string | null;
    cartonIds: string[];
    cartons: WarehouseCartonDoc[];
    palletOnly?: boolean;
  } | null>(null);

  useEffect(() => {
    const stored = readStoredLastBatch(warehouse.id);
    if (!stored) return;
    const palletOnly = !stored.cartonIds?.length && !!stored.palletId;
    if (!stored.cartonIds?.length && !stored.palletId) return;
    void (async () => {
      if (palletOnly && stored.palletId) {
        const pallets = await listWarehousePallets(warehouse.id);
        const p = pallets.find((x) => x.id === stored.palletId);
        if (!p) {
          clearStoredLastBatch(warehouse.id);
          return;
        }
        setLastBatch({
          palletCode: p.palletCode,
          palletId: p.id,
          cartonIds: [],
          cartons: [],
          palletOnly: true,
        });
        return;
      }
      const all = await listWarehouseCartons(warehouse.id);
      const cartons = stored.cartonIds
        .map((id) => all.find((c) => c.id === id))
        .filter((c): c is WarehouseCartonDoc => !!c && c.status !== "voided");
      if (cartons.length === 0) {
        clearStoredLastBatch(warehouse.id);
        return;
      }
      setLastBatch({
        palletCode: stored.palletCode,
        palletId: stored.palletId,
        cartonIds: stored.cartonIds,
        cartons,
      });
    })();
  }, [warehouse.id]);

  // Loose / polybag: one virtual carton for all lines. Pallet loose: many cartons on one PLT.
  const showCopies =
    (type === "carton" && receiveModule === "loose") || isCrossdockPackage;
  const showMultipleCartons =
    type === "carton" ||
    (receiveModule === "loose" && type === "pallet") ||
    isCrossdockClosedUnit;
  const showShipmentDetails = true; // visible for all 3, but compact

  const totalLineCount = isCrossdockClosedUnit
    ? 0
    : cartons.reduce((s, c) => s + c.lines.length, 0);
  const totalCartonCount = cartons.reduce(
    (s, c) => s + Math.max(1, parseInt(c.copies, 10) || 1),
    0
  );
  const totalUnitCount = isCrossdockClosedUnit
    ? totalCartonCount
    : cartons.reduce((sum, c) => {
    const copies = Math.max(1, parseInt(c.copies, 10) || 1);
    const cartonUnits = c.lines.reduce((u, l) => {
      const good = Math.max(0, parseInt(l.goodQty, 10) || 0);
      const dmg = Math.max(0, parseInt(l.damagedQty, 10) || 0);
      return u + good + dmg;
    }, 0);
    return sum + copies * cartonUnits;
  }, 0);
  const hasAnyDamaged = cartons.some((c) =>
    c.lines.some((l) => (parseInt(l.damagedQty, 10) || 0) > 0)
  );

  function updateCarton(cartonId: string, patch: Partial<CartonDraft>) {
    setCartons((prev) => prev.map((c) => (c.id === cartonId ? { ...c, ...patch } : c)));
  }
  function updateLine(cartonId: string, lineId: string, patch: Partial<LineDraft>) {
    setCartons((prev) =>
      prev.map((c) =>
        c.id === cartonId
          ? { ...c, lines: c.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l)) }
          : c
      )
    );
  }
  function addLine(cartonId: string) {
    setCartons((prev) =>
      prev.map((c) => (c.id === cartonId ? { ...c, lines: [...c.lines, newLine()] } : c))
    );
  }
  function removeLine(cartonId: string, lineId: string) {
    setCartons((prev) =>
      prev.map((c) =>
        c.id === cartonId
          ? {
              ...c,
              lines: c.lines.length > 1 ? c.lines.filter((l) => l.id !== lineId) : c.lines,
            }
          : c
      )
    );
  }
  function addCarton() {
    setCartons((prev) => {
      const next = isCrossdockClosedUnit ? newCrossdockCarton() : newCarton();
      const primary = inboundRequests[0];
      if (primary) {
        const pre = inboundRequestPrefill(primary);
        next.clientId = pre.clientUserId;
        next.clientLabel = pre.clientDisplayName;
        next.inventoryRequestId = pre.inventoryRequestId;
      }
      return [...prev, next];
    });
  }
  function duplicateCarton(cartonId: string) {
    setCartons((prev) => {
      const idx = prev.findIndex((c) => c.id === cartonId);
      if (idx < 0) return prev;
      const src = prev[idx];
      const copy: CartonDraft = {
        ...src,
        id: uid("ctn"),
        lines: isCrossdockClosedUnit ? [] : src.lines.map((l) => ({ ...l, id: uid("ln") })),
        clientId: src.clientId,
        clientLabel: src.clientLabel,
        crossdockLot: isCrossdockClosedUnit ? generateCrossdockReceiveLot() : src.crossdockLot,
      };
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
    });
  }
  function removeCarton(cartonId: string) {
    setCartons((prev) => (prev.length > 1 ? prev.filter((c) => c.id !== cartonId) : prev));
  }

  function applyQuickScanLines(cartonId: string, scanned: QuickScanLine[]) {
    setCartons((prev) =>
      prev.map((c) => {
        if (c.id !== cartonId) return c;
        // Replace the carton's lines wholesale, ignoring the default empty line.
        const hasOnlyEmptyDefault =
          c.lines.length === 1 && !c.lines[0].sku.trim() && c.lines[0].goodQty === "1";
        const base = hasOnlyEmptyDefault ? [] : c.lines;
        const newLines: LineDraft[] = scanned.map((s) => ({
          id: uid("ln"),
          sku: s.sku,
          productTitle: s.productTitle,
          goodQty: s.goodQty,
          damagedQty: s.damagedQty,
          lot: s.lot,
          expiry: s.expiry,
        }));
        return { ...c, lines: [...base, ...newLines] };
      })
    );
  }

  function addLineFromRequest(cartonId: string, row: InboundRequestRow) {
    const link = inboundLineLinkFromRow(row);
    setCartons((prev) =>
      prev.map((c) =>
        c.id === cartonId
          ? {
              ...c,
              lines: [
                ...c.lines,
                {
                  ...newLine(),
                  sku: link.sku,
                  productTitle: link.productTitle,
                  goodQty: link.goodQty,
                  expiry: link.expiry,
                  inventoryRequestId: link.inventoryRequestId,
                  clientId: link.clientId,
                  clientLabel: link.clientLabel,
                },
              ],
            }
          : c
      )
    );
  }

  function lineInboundPickerValue(line: LineDraft): string {
    if (!line.inventoryRequestId || !line.clientId) return "";
    return `${line.clientId}:${line.inventoryRequestId}`;
  }

  function applyLineInboundLink(cartonId: string, lineId: string, link: ReturnType<typeof inboundLineLinkFromRow> | null) {
    updateLine(cartonId, lineId, link
      ? {
          inventoryRequestId: link.inventoryRequestId,
          clientId: link.clientId,
          clientLabel: link.clientLabel,
          sku: link.sku || undefined,
          productTitle: link.productTitle,
          goodQty: link.goodQty,
          expiry: link.expiry,
        }
      : {
          inventoryRequestId: "",
          clientId: "",
          clientLabel: "",
        });
  }

  function resolveClientAfterReceive(input?: {
    receiveEntries?: Array<{ clientUserId: string; sku: string; productName?: string | null; quantity: number }>;
    palletId?: string | null;
  }): { clientUserId: string; clientDisplayName: string } | null {
    if (inboundRequests[0]?.clientUserId) {
      const primary = inboundRequests[0];
      return {
        clientUserId: primary.clientUserId,
        clientDisplayName:
          primary.clientDisplayName ||
          clientDisplayName(primary.clientUserId),
      };
    }
    if (palletDraft.clientId?.trim()) {
      return {
        clientUserId: palletDraft.clientId.trim(),
        clientDisplayName:
          palletDraft.clientLabel?.trim() || clientDisplayName(palletDraft.clientId.trim()),
      };
    }
    if (shipmentClientId.trim()) {
      return {
        clientUserId: shipmentClientId.trim(),
        clientDisplayName:
          shipmentClientLabel.trim() || clientDisplayName(shipmentClientId.trim()),
      };
    }
    const entry = input?.receiveEntries?.[0];
    if (entry?.clientUserId) {
      return {
        clientUserId: entry.clientUserId,
        clientDisplayName: clientDisplayName(entry.clientUserId),
      };
    }
    for (const c of cartons) {
      const id = c.clientId?.trim();
      if (id) {
        return {
          clientUserId: id,
          clientDisplayName: c.clientLabel?.trim() || clientDisplayName(id),
        };
      }
    }
    return null;
  }

  function promptStorageAssignmentAfterReceive(input: {
    receiveEntries?: Array<{ clientUserId: string; sku: string; productName?: string | null; quantity: number }>;
    palletId?: string | null;
    cartonIds?: string[];
  }) {
    const client = resolveClientAfterReceive(input);
    if (!client) {
      resetForm();
      return;
    }
    const batchRef =
      input.palletId ||
      (input.cartonIds?.length === 1 ? input.cartonIds[0] : undefined) ||
      undefined;
    setStorageAssignContext({
      clientUserId: client.clientUserId,
      clientDisplayName: client.clientDisplayName,
      warehouseId: warehouse.id,
      receiveBatchId: batchRef,
      receiveReference: batchRef,
      assignedBy: operatorId ?? null,
      contents: input.receiveEntries?.map((e) => ({
        sku: e.sku,
        productName: e.productName ?? undefined,
        quantity: e.quantity,
      })),
    });
    setStorageDialogOpen(true);
  }

  function resetForm() {
    receivePhotoPreviews.forEach((u) => URL.revokeObjectURL(u));
    setReceivePhotoFiles([]);
    setReceivePhotoPreviews([]);
    setTrackingNumber(dockTracking?.trim() || "");
    setCarrier("");
    setNotes("");
    if (inboundRequests.length > 0) {
      const primary = inboundRequests[0];
      const pre = inboundRequestPrefill(primary);
      setShipmentClientId(pre.clientUserId);
      setShipmentClientLabel(pre.clientDisplayName);
      if (isCrossdockPalletOnly) {
        setPalletDraft({
          clientId: pre.clientUserId,
          clientLabel: pre.clientDisplayName,
          crossdockLot: generateCrossdockReceiveLot(),
        });
      } else {
        setCartons(cartonsFromInboundRequests(inboundRequests, isCrossdockClosedUnit));
      }
      return;
    }
    setShipmentClientId("");
    setShipmentClientLabel("");
    if (isCrossdockPalletOnly) {
      setPalletDraft({
        clientId: "",
        clientLabel: "",
        crossdockLot: generateCrossdockReceiveLot(),
      });
    } else {
      setCartons([isCrossdockClosedUnit ? newCrossdockCarton() : newCarton()]);
    }
  }

  async function refreshInboundRequestsAfterReceive(): Promise<void> {
    if (inboundRequests.length === 0) return;
    const updated = await Promise.all(
      inboundRequests.map((row) =>
        reloadInboundRequestRow({
          warehouse,
          clients: clientsForReload,
          clientUserId: row.clientUserId,
          requestId: row.id,
        })
      )
    );
    onInboundRequestsChange?.(updated.filter((r): r is InboundRequestRow => r != null));
    inboundPrefillKeyRef.current = null;
  }

  function clientDisplayName(clientId: string): string {
    const c = clientById.get(clientId);
    if (!c) return "";
    const name = c.name || c.email || c.uid;
    return c.clientId ? `${name} (${c.clientId})` : name;
  }

  function resolveCartonClient(c: CartonDraft): {
    clientId: string | null;
    clientDisplayName: string | null;
  } {
    const id = c.clientId?.trim() || shipmentClientId.trim() || null;
    const label =
      c.clientLabel?.trim() ||
      shipmentClientLabel.trim() ||
      (id ? clientDisplayName(id) : null) ||
      null;
    return { clientId: id, clientDisplayName: label };
  }

  async function handleReceive() {
    if (isCrossdockPalletOnly) {
      setSaving(true);
      try {
        const receivePhotoUrls =
          receivePhotoFiles.length > 0
            ? await uploadReceivePhotos({
                warehouseId: warehouse.id,
                files: receivePhotoFiles,
                uploadedBy: operatorId,
              })
            : [];
        const { palletId } = await createCrossdockPalletReceive({
          warehouseId: warehouse.id,
          receivedBy: operatorName,
          stagingArea: "RCV-STAGE",
          trackingNumber: trackingNumber.trim() || null,
          carrier: carrier || null,
          notes: notes.trim() || null,
          clientId: palletDraft.clientId?.trim() || null,
          clientDisplayName:
            palletDraft.clientLabel?.trim() ||
            (palletDraft.clientId ? clientDisplayName(palletDraft.clientId) : null),
          receiveLot: palletDraft.crossdockLot,
          photoUrl: receivePhotoUrls[0] ?? null,
        });
        const allPallets = await listWarehousePallets(warehouse.id);
        const createdPallet = allPallets.find((p) => p.id === palletId) ?? null;
        if (createdPallet) {
          const palletPdf = await buildWarehousePalletLabelsPdf({
            title: `${warehouse.code} — ${createdPallet.palletCode}`,
            pallets: [createdPallet],
          });
          downloadUint8ArrayAsFile(palletPdf, `${createdPallet.palletCode}.pdf`);
        }
        const formSnapshot: StoredReceiveFormSnapshot = {
          type,
          trackingNumber,
          carrier,
          carrierAutoDetected,
          notes,
          cartons: [],
          palletClientId: palletDraft.clientId,
          palletClientLabel: palletDraft.clientLabel,
          palletCrossdockLot: palletDraft.crossdockLot,
        };
        writeStoredLastBatch(warehouse.id, {
          cartonIds: [],
          palletId,
          palletCode: createdPallet?.palletCode ?? null,
          formSnapshot,
          savedAt: Date.now(),
        });
        setLastBatch({
          palletCode: createdPallet?.palletCode ?? null,
          palletId,
          cartonIds: [],
          cartons: [],
          palletOnly: true,
        });
        toast({
          title: "Pallet received",
          description: "PLT label printed. Contents stay closed until putaway.",
        });
        promptStorageAssignmentAfterReceive({ palletId });
      } catch (e) {
        toast({
          title: "Receive failed",
          description: e instanceof Error ? e.message : "Unknown error",
          variant: "destructive",
        });
      } finally {
        setSaving(false);
      }
      return;
    }

    if (!isCrossdockClosedUnit) {
      if (inboundRequests.length === 0) {
        const hasClient =
          Boolean(shipmentClientId.trim()) ||
          cartons.some(
            (c) =>
              Boolean(c.clientId?.trim()) ||
              c.lines.some((l) => Boolean(l.clientId?.trim()))
          );
        if (!hasClient) {
          toast({
            title: "Client required",
            description:
              "Open receiving without a dock request needs a client so inventory shows in their table after putaway. For unknown owner, use Walk-in / closed receive (lot + photos + one label) first.",
            variant: "destructive",
          });
          return;
        }
      }
      for (const c of cartons) {
        for (const l of c.lines) {
          if (!l.sku.trim()) {
            toast({
              title: "Missing SKU",
              description: "Every line needs a SKU.",
              variant: "destructive",
            });
            return;
          }
          const good = Math.max(0, parseInt(l.goodQty, 10) || 0);
          const dmg = Math.max(0, parseInt(l.damagedQty, 10) || 0);
          if (good + dmg < 1) {
            toast({
              title: "Quantity required",
              description: `SKU ${l.sku} needs at least 1 unit.`,
              variant: "destructive",
            });
            return;
          }
        }
      }
      if (inboundRequests.length === 1) {
        const only = inboundRequests[0];
        const receiveUnits = cartons.reduce((sum, c) => {
          const copies = showCopies ? Math.max(1, parseInt(c.copies, 10) || 1) : 1;
          const units = c.lines.reduce(
            (u, l) => u + Math.max(0, parseInt(l.goodQty, 10) || 0),
            0
          );
          return sum + copies * units;
        }, 0);
        if (receiveUnits > only.remainingQty) {
          toast({
            title: "Over receive",
            description: `This request has ${only.remainingQty} remaining — you entered ${receiveUnits} units on linked lines.`,
            variant: "destructive",
          });
          return;
        }
      }

      const qtyError = validateInboundReceiveQty({
        cartons: cartons.map((c) => ({
          copies: showCopies ? Math.max(1, parseInt(c.copies, 10) || 1) : 1,
          lines: c.lines.map((l) => ({
            inventoryRequestId: l.inventoryRequestId,
            clientId: l.clientId,
            goodQty: Math.max(0, parseInt(l.goodQty, 10) || 0),
          })),
        })),
        queue: inboundQueue,
      });
      if (qtyError) {
        toast({ title: "Over receive", description: qtyError, variant: "destructive" });
        return;
      }
    }

    setSaving(true);
    try {
      const receivePhotoUrls =
        receivePhotoFiles.length > 0
          ? await uploadReceivePhotos({
              warehouseId: warehouse.id,
              files: receivePhotoFiles,
              uploadedBy: operatorId,
            })
          : [];

      const payloadCartons = cartons.map((c) => {
        const copies = showCopies ? Math.max(1, parseInt(c.copies, 10) || 1) : 1;
        const flatLines: Array<{
          sku: string;
          productTitle?: string | null;
          quantity: number;
          lot?: string | null;
          expiry?: string | null;
          damaged?: boolean;
        }> = [];
        for (const l of c.lines) {
          const good = Math.max(0, parseInt(l.goodQty, 10) || 0);
          const dmg = Math.max(0, parseInt(l.damagedQty, 10) || 0);
          if (good > 0) {
            flatLines.push({
              sku: l.sku.trim(),
              productTitle: l.productTitle.trim() || null,
              quantity: good,
              lot: l.lot.trim() || null,
              expiry: l.expiry.trim() || null,
              damaged: false,
              inventoryRequestId: l.inventoryRequestId?.trim() || null,
              clientId: l.clientId?.trim() || null,
            });
          }
          if (dmg > 0) {
            flatLines.push({
              sku: l.sku.trim(),
              productTitle: l.productTitle.trim() || null,
              quantity: dmg,
              lot: l.lot.trim() || null,
              expiry: l.expiry.trim() || null,
              damaged: true,
              inventoryRequestId: l.inventoryRequestId?.trim() || null,
              clientId: l.clientId?.trim() || null,
            });
          }
        }
        const client =
          isCrossdockClosedUnit || receiveModule === "loose" ? resolveCartonClient(c) : null;
        const requestId =
          c.inventoryRequestId?.trim() || inboundRequests[0]?.id?.trim() || null;
        return {
          copies,
          lines: flatLines,
          inventoryRequestId: requestId,
          ...(client && (client.clientId || client.clientDisplayName)
            ? {
                clientId: client.clientId,
                clientDisplayName: client.clientDisplayName,
              }
            : {}),
        };
      });

      const useShipmentOnPallet = type === "pallet";
      const { palletId, cartonIds } = await createReceiveBatch({
        warehouseId: warehouse.id,
        receivedBy: operatorName,
        stagingArea: "RCV-STAGE",
        receiveMode,
        isLoose: type === "loose" && receiveModule === "loose",
        isPackage: type === "loose",
        pallet: useShipmentOnPallet
          ? {
              trackingNumber: trackingNumber.trim() || null,
              carrier: carrier || null,
              notes: notes.trim() || null,
              photoUrl: null,
            }
          : undefined,
        cartons: payloadCartons.map((c) => ({
          ...c,
          trackingNumber: !useShipmentOnPallet ? trackingNumber.trim() || null : null,
          carrier: !useShipmentOnPallet ? carrier || null : null,
          notes: !useShipmentOnPallet ? notes.trim() || null : null,
          photoUrls: receivePhotoUrls.length > 0 ? receivePhotoUrls : undefined,
          photoUrl: receivePhotoUrls[0] ?? null,
        })),
      });

      const [allCartons, allPallets] = await Promise.all([
        listWarehouseCartons(warehouse.id),
        palletId ? listWarehousePallets(warehouse.id) : Promise.resolve([]),
      ]);
      const created = cartonIds
        .map((id) => allCartons.find((c) => c.id === id))
        .filter((c): c is WarehouseCartonDoc => !!c);
      const createdPallet = palletId ? allPallets.find((p) => p.id === palletId) : null;

      if (created.length > 0) {
        const packageLabels = created.filter((c) => c.isPackage);
        const cartonLabels = created.filter((c) => !c.isPackage);
        if (packageLabels.length > 0) {
          const packagePdf = await buildWarehousePackageLabelsPdf({
            title: `${warehouse.code} — ${packageLabels.length} PKG label${packageLabels.length > 1 ? "s" : ""}`,
            packages: packageLabels,
          });
          downloadUint8ArrayAsFile(
            packagePdf,
            `pkg-labels-${packageLabels[0].cartonCode}-${packageLabels.length}.pdf`
          );
        }
        if (cartonLabels.length > 0) {
          const cartonPdf = await buildWarehouseCartonLabelsPdf({
            title: `${warehouse.code} — ${cartonLabels.length} label${cartonLabels.length > 1 ? "s" : ""}`,
            cartons: cartonLabels,
          });
          downloadUint8ArrayAsFile(
            cartonPdf,
            `${type}-labels-${cartonLabels[0].cartonCode}-${cartonLabels.length}.pdf`
          );
        }
      }
      if (createdPallet) {
        const palletPdf = await buildWarehousePalletLabelsPdf({
          title: `${warehouse.code} — ${createdPallet.palletCode}`,
          pallets: [createdPallet],
        });
        downloadUint8ArrayAsFile(palletPdf, `${createdPallet.palletCode}.pdf`);
      }

      const formSnapshot: StoredReceiveFormSnapshot = {
        type,
        trackingNumber,
        carrier,
        carrierAutoDetected,
        notes,
        cartons,
        ...(receiveModule === "loose"
          ? {
              shipmentClientId,
              shipmentClientLabel,
            }
          : {}),
      };
      writeStoredLastBatch(warehouse.id, {
        cartonIds,
        palletId: palletId ?? null,
        palletCode: createdPallet?.palletCode ?? null,
        formSnapshot,
        savedAt: Date.now(),
      });
      setLastBatch({
        palletCode: createdPallet?.palletCode ?? null,
        cartonIds,
        cartons: created,
      });

      const receiveEntries: Array<{
        clientUserId: string;
        inventoryRequestId: string;
        productName?: string | null;
        cartonId: string;
        cartonCode: string;
        sku: string;
        quantity: number;
      }> = [];

      for (const c of created) {
        for (const line of c.lines ?? []) {
          const rid = line.inventoryRequestId?.trim();
          const cid = line.clientId?.trim();
          if (!rid || !cid) continue;
          receiveEntries.push({
            clientUserId: cid,
            inventoryRequestId: rid,
            productName: line.productTitle ?? null,
            cartonId: c.id,
            cartonCode: c.cartonCode,
            sku: line.sku,
            quantity: line.quantity,
          });
        }
      }

      if (receiveEntries.length > 0) {
        await recordInboundReceiveBatch({
          warehouseId: warehouse.id,
          entries: receiveEntries,
          trackingNumber: trackingNumber.trim() || null,
          operatorId,
        });
        await reloadInboundQueue();
        if (inboundRequests.length > 0) {
          await refreshInboundRequestsAfterReceive();
        }
      }

      // Container handling requests: close after contents are open-received for that client.
      const containerReqs = inboundRequests.filter(isContainerInbound);
      for (const row of containerReqs) {
        await completeContainerInboundRequest({
          clientUserId: row.clientUserId,
          requestId: row.id,
          completedBy: operatorId,
        });
      }
      if (containerReqs.length > 0) {
        await reloadInboundQueue();
        await refreshInboundRequestsAfterReceive();
      }

      const linkedAnyRequest = receiveEntries.length > 0 || containerReqs.length > 0;

      toast({
        title: isCrossdockPackage
          ? "Cross-dock packages received"
          : receiveModule === "loose"
          ? "Open receiving complete"
          : "Cross-dock received",
        description: linkedAnyRequest
          ? `Mixed carton linked to ${new Set(receiveEntries.map((e) => e.inventoryRequestId)).size} request(s). ${created.length} label${created.length > 1 ? "s" : ""} printed.`
          : isCrossdockPackage
            ? `${totalCartonCount} PKG label${totalCartonCount === 1 ? "" : "s"} printed. Allocate client, then Putaway.`
            : type === "loose"
              ? `${created.length} label${created.length > 1 ? "s" : ""} printed.`
              : `${created.length} CTN/PLT label${created.length > 1 ? "s" : ""} printed. Allocate client, then Putaway for placement.`,
      });
      promptStorageAssignmentAfterReceive({
        receiveEntries,
        palletId: palletId ?? null,
        cartonIds,
      });
    } catch (e) {
      toast({
        title: "Receive failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleUndoLastBatch() {
    if (!lastBatch) return;
    const stored = readStoredLastBatch(warehouse.id);
    if (batchHasPutaway(lastBatch.cartons) && !supervisor) {
      toast({
        title: "Cannot undo",
        description: "One or more cartons were already put away. Use Correct receive or ask a supervisor.",
        variant: "destructive",
      });
      return;
    }
    setUndoing(true);
    try {
      const res = await voidWarehouseCartons({
        warehouseId: warehouse.id,
        cartonIds: lastBatch.cartonIds,
        reason: "Undo last receive batch",
        operatorId,
        supervisorOverride: supervisor,
      });
      if (res.voidedIds.length === 0) {
        const msg = res.blocked.map((b) => b.reason).join(" ") || "Could not void batch.";
        throw new Error(msg);
      }
      clearStoredLastBatch(warehouse.id);
      setLastBatch(null);
      if (stored?.formSnapshot && onRestoreForm) {
        onRestoreForm(stored.formSnapshot);
        toast({
          title: "Batch undone",
          description: "Labels voided. Your form was restored — fix and receive again.",
        });
      } else {
        toast({
          title: "Batch undone",
          description: `${res.voidedIds.length} carton(s) voided.`,
        });
      }
    } catch (e) {
      toast({
        title: "Undo failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setUndoing(false);
    }
  }

  const canUndoLastBatch =
    lastBatch &&
    (lastBatch.palletOnly
      ? !!lastBatch.palletId
      : lastBatch.cartons.length > 0 &&
        lastBatch.cartons.every((c) => c.status !== "voided") &&
        (!batchHasPutaway(lastBatch.cartons) || supervisor));

  const titleByType: Record<ReceiveType, string> =
    receiveModule === "loose"
      ? {
          carton: "Open receiving — cartons",
          pallet: "Open receiving — pallet",
          loose: "Open receiving — packages",
          container: "Container receive — counts + CTR label",
        }
      : {
          carton: "Cross-dock — cartons",
          pallet: "Cross-dock — pallet",
          loose: "Cross-dock — packages",
          container: "Container",
        };
  const subtitleByType: Record<ReceiveType, string> =
    receiveModule === "loose"
      ? {
          carton:
            "Open each carton and enter every SKU and quantity. CTN labels print for putaway.",
          pallet:
            "One pallet label plus a CTN label per carton — enter SKUs inside each carton.",
          loose:
            "Polybags, totes, or open units — PKG label with SKU count. Scan PKG at putaway.",
          container:
            "Enter how many cartons, pallets, and packages are inside. One CTR label. Assign client later, then open-receive SKUs into inventory.",
        }
      : {
          carton:
            "Closed cartons — CTN labels only. SKU/lot/expiry when you open at putaway.",
          pallet: "One PLT label only — do not count cartons inside. Putaway later.",
          loose:
            "Closed polybags or small packs — PKG labels only. Open and count SKUs at putaway.",
          container: "Use open receiving for containers.",
        };
  const accentByType: Record<ReceiveType, string> = {
    carton: "border-orange-300 bg-orange-600 hover:bg-orange-700",
    pallet: "border-indigo-300 bg-indigo-600 hover:bg-indigo-700",
    loose: "border-emerald-300 bg-emerald-600 hover:bg-emerald-700",
    container: "border-sky-300 bg-sky-700 hover:bg-sky-800",
  };

  if (type === "container") {
    return (
      <ContainerReceiveForm
        warehouse={warehouse}
        inboundRequests={inboundRequests}
        dockTracking={dockTracking}
        clients={clientsForReload}
        onBack={onBack}
      />
    );
  }

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          {type === "loose" && receiveModule === "loose" ? "Back" : "Change package type"}
        </Button>
        <Badge variant="outline" className="capitalize">
          {receiveModule === "crossdock" ? "Cross-dock" : "Open receiving"} · {type}
        </Badge>
        {onSwitchToOpenReceive ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-emerald-300 text-emerald-900 hover:bg-emerald-50"
            onClick={onSwitchToOpenReceive}
          >
            <PackageOpen className="h-4 w-4 mr-1" />
            Switch to open receiving
          </Button>
        ) : null}
      </div>
      <WarehouseOpsHeader title={titleByType[type]} />
      <p className="text-sm text-muted-foreground -mt-2">{subtitleByType[type]}</p>
      {onSwitchToOpenReceive ? (
        <p className="text-xs text-muted-foreground -mt-1">
          Client or dock may expect cross-dock, but you can switch to open receiving to count
          products into inventory and close the inbound.
        </p>
      ) : null}

      {inboundRequests.length > 0 ? (
        <Card className="border-blue-200/80 bg-blue-50/30">
          <CardContent className="py-3 text-sm space-y-2">
            <p className="font-medium text-blue-900">
              Dock matched {inboundRequests.length} request
              {inboundRequests.length === 1 ? "" : "s"}
            </p>
            <ul className="space-y-1 text-xs">
              {inboundRequests.map((row) => (
                <li key={`${row.clientUserId}:${row.id}`}>
                  {row.clientDisplayName} — {row.productName} ({row.remainingQty} left)
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Lines are prefilled from the selected requests. You can still add or unlink lines
              with <strong>Inbound request</strong> on each SKU.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {showShipmentDetails ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              {type === "pallet" ? "Shipment details (optional)" : "Inbound details (optional)"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-2">
                  <ScanLine className="h-3 w-3" />
                  Tracking #
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={trackingNumber}
                    onChange={(e) => handleTrackingChange(e.target.value)}
                    placeholder="Camera or type tracking #"
                    autoComplete="off"
                    className="flex-1"
                  />
                  <ScanCameraButton
                    onScan={handleTrackingChange}
                    scannerTitle="Scan tracking barcode"
                    scannerDescription="Scan the carrier label on the box or pallet."
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-2">
                  Carrier
                  {carrierAutoDetected ? (
                    <Badge variant="outline" className="bg-emerald-50 border-emerald-300 text-emerald-800 text-[10px] px-1 py-0">
                      auto
                    </Badge>
                  ) : null}
                </Label>
                <Select
                  value={carrier || "__none__"}
                  onValueChange={(v) => {
                    setCarrier(v === "__none__" ? "" : v);
                    setCarrierAutoDetected(false);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {CARRIERS.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Notes</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder='e.g. "Outer box crushed, contents OK"'
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">
                Photos
                {isCrossdockClosedUnit || isCrossdockPalletOnly
                  ? " (recommended)"
                  : " (optional, multiple)"}
              </Label>
              <Input
                type="file"
                accept="image/*"
                multiple
                className="text-xs"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  setReceivePhotoFiles(files);
                  receivePhotoPreviews.forEach((u) => URL.revokeObjectURL(u));
                  setReceivePhotoPreviews(files.map((f) => URL.createObjectURL(f)));
                }}
              />
              {receivePhotoPreviews.length > 0 ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  {receivePhotoPreviews.map((src, i) => (
                    <img
                      key={src}
                      src={src}
                      alt={`Receive photo ${i + 1}`}
                      className="h-16 w-16 rounded border object-cover"
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {isCrossdockPalletOnly ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Layers className="h-4 w-4 text-indigo-600" />
            Pallet
          </h2>
          <Card className="border-indigo-200/80 shadow-sm">
            <CardContent className="pt-6 space-y-3">
              <div className="space-y-3 rounded-md border border-dashed border-indigo-200 bg-indigo-50/30 px-3 py-3">
                <p className="text-sm text-muted-foreground">
                  One closed pallet — print a single PLT label. Cartons inside are not counted
                  here. Lot prints on the label; client is optional.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-xs">Client name (optional)</Label>
                    <CrossdockClientCombobox
                      clients={clients}
                      clientId={palletDraft.clientId}
                      clientLabel={palletDraft.clientLabel}
                      onChange={({ clientId, clientLabel }) =>
                        setPalletDraft((p) => ({ ...p, clientId, clientLabel }))
                      }
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Search, pick from the list, or type a name not in the system.
                    </p>
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-xs">Receive lot (auto)</Label>
                    <div className="flex gap-2">
                      <Input
                        readOnly
                        value={palletDraft.crossdockLot}
                        className="font-mono text-sm bg-muted/50 flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() =>
                          setPalletDraft((p) => ({
                            ...p,
                            crossdockLot: generateCrossdockReceiveLot(),
                          }))
                        }
                      >
                        New lot
                      </Button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Format: LOT-XDOCK + receive date + random (e.g. LOT-XDOCK20260603042)
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {receiveModule === "loose" && !isCrossdockPalletOnly ? (
        <Card className="border-emerald-200/80">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Client
              {inboundRequests.length === 0 ? " (required)" : " (optional)"}
            </CardTitle>
            <CardDescription className="text-xs">
              {inboundRequests.length === 0
                ? "Assign the owner so counted SKUs land in their inventory after putaway. Unknown owner? Use Walk-in / closed receive first."
                : "Applies to every carton or package below unless you override per unit. Shown in Allocate when matching stock to clients."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CrossdockClientCombobox
              clients={clients}
              clientId={shipmentClientId}
              clientLabel={shipmentClientLabel}
              onChange={({ clientId, clientLabel }) => {
                setShipmentClientId(clientId);
                setShipmentClientLabel(clientLabel);
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      {!isCrossdockPalletOnly ? (
      <div className="space-y-3">
        {showMultipleCartons ? (
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              {type === "pallet"
                ? "Cartons on this pallet"
                : isCrossdockPackage
                ? "Packages"
                : "Cartons"}{" "}
              ({cartons.length})
            </h2>
            <Button type="button" variant="outline" size="sm" onClick={addCarton}>
              <Plus className="h-4 w-4 mr-1" />
              {isCrossdockPackage ? "Add another package" : "Add another carton"}
            </Button>
          </div>
        ) : null}

        {cartons.map((c, idx) => {
          const distinctSkus = new Set(c.lines.map((l) => l.sku.trim()).filter(Boolean));
          const isMixed = distinctSkus.size > 1;
          const totalCopies = showCopies ? Math.max(1, parseInt(c.copies, 10) || 1) : 1;
          const cartonUnits = c.lines.reduce((u, l) => {
            return u + Math.max(0, parseInt(l.goodQty, 10) || 0) + Math.max(0, parseInt(l.damagedQty, 10) || 0);
          }, 0);
          const hasDamaged = c.lines.some((l) => (parseInt(l.damagedQty, 10) || 0) > 0);
          const headerLabel =
            type === "loose" && receiveModule === "loose"
              ? "SKU lines"
              : isCrossdockPackage
              ? showMultipleCartons
                ? `Package #${idx + 1}`
                : "Closed package"
              : showMultipleCartons
              ? `Carton #${idx + 1}`
              : "Items";
          return (
            <Card key={c.id} className="border-slate-200">
              {showMultipleCartons ? (
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <CardTitle className="text-sm">{headerLabel}</CardTitle>
                      {isMixed ? (
                        <Badge variant="outline" className="bg-amber-100 border-amber-300 text-amber-800">
                          Mixed · {distinctSkus.size} SKUs
                        </Badge>
                      ) : null}
                      {hasDamaged ? (
                        <Badge variant="outline" className="bg-red-100 border-red-300 text-red-800">
                          <AlertTriangle className="h-3 w-3 mr-1" /> Has damaged
                        </Badge>
                      ) : null}
                      {showCopies && totalCopies > 1 ? (
                        <Badge variant="outline" className="bg-blue-50 border-blue-300 text-blue-800">
                          × {totalCopies} copies
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {type === "carton" || isCrossdockPackage ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => duplicateCarton(c.id)}
                          title="Duplicate this unit"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      ) : null}
                      {cartons.length > 1 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeCarton(c.id)}
                        >
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </CardHeader>
              ) : null}
              <CardContent className={cn("space-y-3", !showMultipleCartons && "pt-6")}>
                {isCrossdockClosedUnit ? (
                  <div className="space-y-3 rounded-md border border-dashed border-indigo-200 bg-indigo-50/30 px-3 py-3">
                    <p className="text-sm text-muted-foreground">
                      {isCrossdockPackage
                        ? "Closed polybag or small pack — no SKU at the dock. Lot prints on the label; client is optional."
                        : "Closed unit — no SKU at the dock. Lot always prints on the label; client is optional. Putaway chooses forward, hold, or bins."}
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1 sm:col-span-2">
                        <Label className="text-xs">Client name (optional)</Label>
                        <CrossdockClientCombobox
                          clients={clients}
                          clientId={c.clientId ?? ""}
                          clientLabel={c.clientLabel ?? ""}
                          onChange={({ clientId, clientLabel }) =>
                            updateCarton(c.id, { clientId, clientLabel })
                          }
                        />
                        <p className="text-[10px] text-muted-foreground">
                          Optional — search, pick, or type a name. Leave blank to assign in
                          Allocate later.
                        </p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Receive lot (auto)</Label>
                        <Input
                          readOnly
                          value={c.crossdockLot ?? ""}
                          className="font-mono text-xs bg-muted/50"
                        />
                        <p className="text-[10px] text-muted-foreground">
                          Format: LOT-XDOCK + date + random (new lot per carton copy)
                        </p>
                      </div>
                    </div>
                  </div>
                ) : receiveModule === "loose" && showMultipleCartons ? (
                  <div className="space-y-1 rounded-md border border-dashed border-emerald-200 bg-emerald-50/30 px-3 py-3">
                    <Label className="text-xs">Client for this carton (optional)</Label>
                    <CrossdockClientCombobox
                      clients={clients}
                      clientId={c.clientId ?? ""}
                      clientLabel={c.clientLabel ?? ""}
                      onChange={({ clientId, clientLabel }) =>
                        updateCarton(c.id, { clientId, clientLabel })
                      }
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Overrides the shipment client above for this carton only.
                    </p>
                  </div>
                ) : null}
                {!isCrossdockClosedUnit
                  ? c.lines.map((line, lineIdx) => {
                  const good = Math.max(0, parseInt(line.goodQty, 10) || 0);
                  const dmg = Math.max(0, parseInt(line.damagedQty, 10) || 0);
                  return (
                    <div
                      key={line.id}
                      className={cn(
                        "rounded-md border p-3 space-y-2",
                        dmg > 0 && "border-red-200 bg-red-50/40"
                      )}
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-xs font-medium text-muted-foreground">
                          Line {lineIdx + 1}
                          {line.clientLabel && line.inventoryRequestId ? (
                            <Badge variant="outline" className="ml-2 text-[10px] font-normal">
                              {line.clientLabel}
                            </Badge>
                          ) : null}
                        </span>
                        {c.lines.length > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeLine(c.id, line.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        ) : null}
                      </div>
                      {receiveModule === "loose" && !isCrossdockClosedUnit ? (
                        <InboundRequestLinePicker
                          requests={inboundQueue}
                          value={lineInboundPickerValue(line)}
                          compact
                          onChange={(link) => applyLineInboundLink(c.id, line.id, link)}
                        />
                      ) : null}
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label className="text-xs">SKU</Label>
                          <div className="flex gap-2">
                            <Input
                              value={line.sku}
                              onChange={(e) => updateLine(c.id, line.id, { sku: e.target.value })}
                              placeholder="Required"
                            />
                            <ScanLookupPopover
                              onPick={(m) =>
                                updateLine(c.id, line.id, {
                                  sku: m.sku,
                                  productTitle: m.productName,
                                })
                              }
                              onAcceptRaw={(raw) => updateLine(c.id, line.id, { sku: raw })}
                            />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Product name (optional)</Label>
                          <Input
                            value={line.productTitle}
                            onChange={(e) =>
                              updateLine(c.id, line.id, { productTitle: e.target.value })
                            }
                          />
                        </div>
                      </div>
                      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
                        <div className="space-y-1">
                          <Label className="text-xs">Good qty</Label>
                          <Input
                            type="number"
                            min={0}
                            value={line.goodQty}
                            onChange={(e) => updateLine(c.id, line.id, { goodQty: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-red-700">Damaged qty</Label>
                          <Input
                            type="number"
                            min={0}
                            value={line.damagedQty}
                            onChange={(e) =>
                              updateLine(c.id, line.id, { damagedQty: e.target.value })
                            }
                            className={dmg > 0 ? "border-red-300" : ""}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Lot (required)</Label>
                          <Input
                            value={line.lot}
                            onChange={(e) => updateLine(c.id, line.id, { lot: e.target.value })}
                            placeholder="Or leave blank to auto-generate"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Expiry (optional)</Label>
                          <Input
                            type="date"
                            value={line.expiry}
                            onChange={(e) => updateLine(c.id, line.id, { expiry: e.target.value })}
                          />
                        </div>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        Lot: enter your own, or leave blank —{" "}
                        <span className="font-mono">{describeReceiveLotPattern()}</span>.{" "}
                        {describeReceiveLotHint()}
                      </p>
                      {good + dmg > 0 ? (
                        <p className="text-[10px] text-muted-foreground tabular-nums">
                          Line total: {good + dmg} ({good} good
                          {dmg > 0 ? `, ${dmg} damaged → quarantine` : ""})
                        </p>
                      ) : null}
                    </div>
                  );
                })
                  : null}
                <div className="flex flex-wrap items-end justify-between gap-3 pt-1">
                  {!isCrossdockClosedUnit ? (
                  <div className="flex gap-2 flex-wrap">
                    <Button type="button" variant="outline" size="sm" onClick={() => addLine(c.id)}>
                      <Plus className="h-3 w-3 mr-1" />
                      Add SKU line
                    </Button>
                    {receiveModule === "loose" && inboundQueue.some((r) => r.remainingQty > 0) ? (
                      <Select
                        onValueChange={(v) => {
                          const row = parseInboundRequestOptionValue(v, inboundQueue);
                          if (row) addLineFromRequest(c.id, row);
                        }}
                      >
                        <SelectTrigger className="h-8 w-auto min-w-[180px] text-xs">
                          <SelectValue placeholder="Add line from request…" />
                        </SelectTrigger>
                        <SelectContent>
                          {inboundQueue
                            .filter((r) => r.remainingQty > 0)
                            .map((row) => (
                              <SelectItem
                                key={inboundRequestOptionValue(row)}
                                value={inboundRequestOptionValue(row)}
                              >
                                {row.clientDisplayName} · {row.productName}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setQuickScanCartonId(c.id)}
                    >
                      <ScanLine className="h-3 w-3 mr-1" />
                      Quick scan items
                    </Button>
                  </div>
                  ) : <div />}
                  {showCopies ? (
                    <div className="flex items-end gap-2 ml-auto">
                      <div className="space-y-1">
                        <Label className="text-xs">
                          {isCrossdockPackage ? "Copies of this package" : "Copies of this carton"}
                        </Label>
                        <Input
                          type="number"
                          min={1}
                          value={c.copies}
                          onChange={(e) => updateCarton(c.id, { copies: e.target.value })}
                          className="w-24"
                        />
                      </div>
                      {!isCrossdockClosedUnit ? (
                      <span className="text-xs text-muted-foreground pb-2">
                        = {totalCopies * cartonUnits} units
                      </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      ) : null}

      <Card className={cn("sticky bottom-4 bg-background shadow-lg", accentByType[type].split(" ")[0])}>
        <CardContent className="py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm flex flex-wrap items-center gap-2">
            {type === "pallet" ? (
              <Badge className="bg-indigo-600">1 pallet label</Badge>
            ) : null}
            {type === "carton" || isCrossdockPackage ? (
              <Badge variant="outline">
                {totalCartonCount} label{totalCartonCount === 1 ? "" : "s"}
              </Badge>
            ) : null}
            {!isCrossdockClosedUnit ? (
              <>
                <Badge variant="outline">{totalLineCount} line{totalLineCount === 1 ? "" : "s"}</Badge>
                <Badge variant="outline">{totalUnitCount} units</Badge>
              </>
            ) : null}
            {hasAnyDamaged ? (
              <Badge variant="outline" className="bg-red-100 border-red-300 text-red-800">
                Includes damaged → quarantine
              </Badge>
            ) : null}
          </div>
          <Button
            size="lg"
            className={accentByType[type].split(" ").slice(1).join(" ")}
            onClick={() => void handleReceive()}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Printer className="h-4 w-4 mr-2" />
                Receive &amp; print
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <QuickScanDialog
        open={!!quickScanCartonId}
        onOpenChange={(o) => !o && setQuickScanCartonId(null)}
        onApply={(scanned) => {
          if (quickScanCartonId) applyQuickScanLines(quickScanCartonId, scanned);
          setQuickScanCartonId(null);
        }}
        title={
          type === "loose" && receiveModule === "loose"
            ? "Quick scan items"
            : "Quick scan items in this carton"
        }
      />

      {lastBatch ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Last batch
              {lastBatch.palletOnly
                ? " (pallet)"
                : ` (${lastBatch.cartons.length} label${lastBatch.cartons.length === 1 ? "" : "s"})`}
            </CardTitle>
            <CardDescription className="text-xs">
              Labels downloaded — stick them now. Stock parked in Receiving Staging.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {lastBatch.palletCode ? (
              <div className="flex items-center justify-between rounded-md border bg-indigo-50/60 px-3 py-2 text-sm">
                <span className="font-mono">{lastBatch.palletCode}</span>
                <Badge className="bg-indigo-600">
                  <Layers className="h-3 w-3 mr-1" />
                  Pallet
                </Badge>
              </div>
            ) : null}
            <div className="space-y-1 max-h-[200px] overflow-y-auto">
              {lastBatch.palletOnly ? (
                <p className="text-xs text-muted-foreground px-1">
                  Pallet-only receive — no carton labels in this batch.
                </p>
              ) : null}
              {lastBatch.cartons.map((c) => (
                <div
                  key={c.id}
                  className="flex justify-between items-center text-sm font-mono border rounded px-3 py-2"
                >
                  <span>{c.cartonCode}</span>
                  <span className="text-xs text-muted-foreground">
                    {c.isPackage
                      ? "PKG · closed cross-dock"
                      : c.isLoose
                      ? `Open · ${c.lines?.length ?? 0} line${(c.lines?.length ?? 0) === 1 ? "" : "s"} · ${c.quantity}u`
                      : c.isMixed
                      ? `Mixed · ${c.lines?.length ?? 0} SKUs · ${c.quantity}u`
                      : `${c.sku} × ${c.quantity}`}
                  </span>
                </div>
              ))}
            </div>
            {batchHasPutaway(lastBatch.cartons) && !supervisor ? (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                Putaway started on this batch — undo is disabled. Use Correct receive or a supervisor.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2 pt-2">
              {canUndoLastBatch ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" disabled={undoing}>
                      {undoing ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      ) : (
                        <RotateCcw className="h-4 w-4 mr-1" />
                      )}
                      Undo last batch
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Undo this receive batch?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Voids {lastBatch.cartons.length} carton label
                        {lastBatch.cartons.length === 1 ? "" : "s"} and restores your last form so you can fix and receive again.
                        {supervisor && batchHasPutaway(lastBatch.cartons)
                          ? " Supervisor override: putaway assignments on these records will be cleared."
                          : ""}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void handleUndoLastBatch()}>
                        Undo batch
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
              <Button variant="outline" size="sm" asChild>
                <Link href="/warehouse-ops/putaway">
                  Continue to putaway
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <ReceiveStorageAssignmentDialog
        open={storageDialogOpen}
        context={storageAssignContext}
        onClose={() => {
          setStorageDialogOpen(false);
          setStorageAssignContext(null);
          resetForm();
        }}
        onComplete={() => {
          setStorageDialogOpen(false);
          setStorageAssignContext(null);
          resetForm();
        }}
      />
    </div>
  );
}

/** Walk-in / dock container: lot + photos + one CTR label (client optional until open receive). */
function ContainerReceiveForm({
  warehouse,
  inboundRequests,
  dockTracking,
  clients,
  onBack,
}: {
  warehouse: WarehouseDoc;
  inboundRequests: InboundRequestRow[];
  dockTracking?: string;
  clients: UserProfile[];
  onBack: () => void;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const operatorId = user?.uid ?? null;
  const containerReq = inboundRequests.find(isContainerInbound) ?? inboundRequests[0] ?? null;

  const [cartonCount, setCartonCount] = useState("0");
  const [palletCount, setPalletCount] = useState("0");
  const [packageCount, setPackageCount] = useState("0");
  const [trackingNumber, setTrackingNumber] = useState(dockTracking?.trim() || "");
  const [carrier, setCarrier] = useState("");
  const [notes, setNotes] = useState("");
  const [receiveLot, setReceiveLot] = useState(() => generateCrossdockReceiveLot());
  const [clientId, setClientId] = useState(containerReq?.clientUserId ?? "");
  const [clientLabel, setClientLabel] = useState(containerReq?.clientDisplayName ?? "");
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    setSaving(true);
    try {
      const photoUrls =
        photoFiles.length > 0
          ? await uploadReceivePhotos({
              warehouseId: warehouse.id,
              files: photoFiles,
              uploadedBy: operatorId,
            })
          : [];
      const { container } = await createContainerReceive({
        warehouseId: warehouse.id,
        cartonCount: parseInt(cartonCount, 10) || 0,
        palletCount: parseInt(palletCount, 10) || 0,
        packageCount: parseInt(packageCount, 10) || 0,
        receivedBy: operatorId,
        trackingNumber: trackingNumber.trim() || null,
        carrier: carrier.trim() || null,
        notes: notes.trim() || null,
        clientId: clientId.trim() || null,
        clientDisplayName: clientLabel.trim() || null,
        inventoryRequestId: containerReq?.id ?? null,
        receiveLot,
        photoUrl: photoUrls[0] ?? null,
        photoUrls,
      });

      await printContainerLabels([container]);
      toast({
        title: "Container received",
        description: clientId
          ? `${container.cartonCode} · ${receiveLot}. Next: Open receiving → enter SKUs for this client, then putaway.`
          : `${container.cartonCode} · ${receiveLot}. When you find the user, open-receive with that client so inventory shows in their table.`,
      });
      photoPreviews.forEach((u) => URL.revokeObjectURL(u));
      onBack();
    } catch (e) {
      toast({
        title: "Container receive failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <Badge variant="outline">Container · CTR label</Badge>
      </div>
      <WarehouseOpsHeader title="Container receive" />
      <p className="text-sm text-muted-foreground -mt-2">
        Walk-in / closed: count units inside (no SKUs), take photos, print one CTR label with lot.
        When the client is known, use open receiving to put products in their inventory.
      </p>

      {containerReq ? (
        <Card className="border-blue-200 bg-blue-50/40">
          <CardContent className="py-3 text-sm">
            Dock request: <strong>{containerReq.clientDisplayName}</strong> —{" "}
            {containerReq.productName}
            {containerReq.containerSize ? ` · ${containerReq.containerSize}` : ""}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Contents count</CardTitle>
          <CardDescription>At least one count must be greater than zero.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-xs">Cartons</Label>
            <Input
              type="number"
              min={0}
              value={cartonCount}
              onChange={(e) => setCartonCount(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Pallets</Label>
            <Input
              type="number"
              min={0}
              value={palletCount}
              onChange={(e) => setPalletCount(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Packages</Label>
            <Input
              type="number"
              min={0}
              value={packageCount}
              onChange={(e) => setPackageCount(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Receive lot (auto)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <div className="flex gap-2">
            <Input
              readOnly
              value={receiveLot}
              className="font-mono text-sm bg-muted/50 flex-1"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => setReceiveLot(generateCrossdockReceiveLot())}
            >
              New lot
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Prints on the CTR label. Same pattern as walk-in carton/pallet lots.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Client (optional)</CardTitle>
          <CardDescription>
            Leave empty for unknown owner — when found, open-receive with that user so inventory
            shows in their table.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CrossdockClientCombobox
            clients={clients}
            clientId={clientId}
            clientLabel={clientLabel}
            onChange={(next) => {
              setClientId(next.clientId);
              setClientLabel(next.clientLabel);
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Tracking #</Label>
            <Input
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Carrier</Label>
            <Input
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Photos (recommended)</Label>
            <Input
              type="file"
              accept="image/*"
              multiple
              className="text-xs"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                setPhotoFiles(files);
                photoPreviews.forEach((u) => URL.revokeObjectURL(u));
                setPhotoPreviews(files.map((f) => URL.createObjectURL(f)));
              }}
            />
            {photoPreviews.length > 0 ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {photoPreviews.map((src, i) => (
                  <img
                    key={src}
                    src={src}
                    alt={`Container photo ${i + 1}`}
                    className="h-16 w-16 rounded border object-cover"
                  />
                ))}
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Button className="w-full" disabled={saving} onClick={() => void handleSubmit()}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Printer className="h-4 w-4 mr-2" />}
        Receive container &amp; print CTR label
      </Button>
    </div>
  );
}
