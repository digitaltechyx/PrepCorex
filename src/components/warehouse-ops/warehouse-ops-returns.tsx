"use client";

import { useMemo, useState } from "react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { WarehouseOpsHeader } from "@/components/warehouse-ops/warehouse-ops-header";
import { useWarehouseOpsLive } from "@/components/warehouse-ops/warehouse-ops-live-provider";
import { useWarehouseOpsClients } from "@/hooks/use-warehouse-ops-clients";
import {
  CrossdockClientCombobox,
  formatClientOptionLabel,
} from "@/components/warehouse-ops/crossdock-client-combobox";
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
import { allocateLine } from "@/lib/warehouse-allocate";
import {
  buildWarehouseCartonLabelsPdf,
  downloadUint8ArrayAsFile,
} from "@/lib/warehouse-carton-label-pdf";
import { getWarehouseCarton } from "@/lib/warehouse-receive-corrections";
import type { UserProfile, WarehouseDoc } from "@/types";
import {
  CheckCircle2,
  Loader2,
  Package,
  RotateCcw,
  Search,
  Ship,
  UserPlus,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Props = { warehouse: WarehouseDoc };
type StatusTab = "pending" | "open" | "in_progress" | "closed" | "all";

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

function StatusBadge({ status }: { status?: string }) {
  const s = String(status || "");
  if (s === "pending")
    return <Badge className="bg-amber-500 hover:bg-amber-600">Pending</Badge>;
  if (s === "approved")
    return <Badge className="bg-blue-500 hover:bg-blue-600">Approved</Badge>;
  if (s === "in_progress")
    return <Badge className="bg-violet-500 hover:bg-violet-600">In progress</Badge>;
  if (s === "closed") return <Badge variant="secondary">Closed</Badge>;
  if (s === "cancelled") return <Badge variant="destructive">Cancelled</Badge>;
  return <Badge variant="outline">{s || "—"}</Badge>;
}

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

  const [receiveOpen, setReceiveOpen] = useState(false);
  const [recvQty, setRecvQty] = useState("1");
  const [recvSku, setRecvSku] = useState("");
  const [recvTitle, setRecvTitle] = useState("");
  const [recvNotes, setRecvNotes] = useState("");
  const [recvCloseReady, setRecvCloseReady] = useState(false);

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

  const [walkInOpen, setWalkInOpen] = useState(false);
  const [walkInMode, setWalkInMode] = useState<"with_user" | "no_user">("with_user");
  const [walkClientId, setWalkClientId] = useState("");
  const [walkClientLabel, setWalkClientLabel] = useState("");
  const [walkType, setWalkType] = useState<"existing" | "new">("existing");
  const [walkReturnType, setWalkReturnType] = useState<"combine" | "partial">("partial");
  const [walkName, setWalkName] = useState("");
  const [walkSku, setWalkSku] = useState("");
  const [walkQty, setWalkQty] = useState("1");
  const [walkNotes, setWalkNotes] = useState("");

  const [linkOpen, setLinkOpen] = useState(false);
  const [linkCartonId, setLinkCartonId] = useState("");
  const [linkClientId, setLinkClientId] = useState("");
  const [linkClientLabel, setLinkClientLabel] = useState("");
  const [linkType, setLinkType] = useState<"existing" | "new">("new");
  const [linkName, setLinkName] = useState("");
  const [linkSku, setLinkSku] = useState("");
  const [linkQty, setLinkQty] = useState("1");

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

  const unallocatedReturnCartons = useMemo(() => {
    return cartons.filter(
      (c) =>
        isReturnWalkInCarton(c) &&
        !c.clientId &&
        c.status !== "voided" &&
        c.status !== "closed"
    );
  }, [cartons]);

  function openReceive(row: AdminProductReturn) {
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
    setReceiveOpen(true);
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
      const result = await receiveReturnWithCarton({
        warehouseId: warehouse.id,
        ownerUserId: owner,
        productReturnId: selected.id,
        sku: recvSku.trim(),
        productTitle: recvTitle.trim() || resolveReturnProductName(selected),
        quantity: qty,
        notes: recvNotes.trim() || null,
        receivedBy: operatorName,
        operatorId,
        closeAfter: recvCloseReady,
      });
      toast({
        title: "Return received",
        description: `${result.cartonCode} → quarantine (Return QC)`,
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
      } catch {
        /* label optional */
      }
      setReceiveOpen(false);
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
        const result = await receiveReturnWalkInUnknownUser({
          warehouseId: warehouse.id,
          quantity: parseInt(walkQty, 10) || 1,
          notes: walkNotes.trim() || null,
          receivedBy: operatorName,
          operatorId,
        });
        toast({
          title: "Closed return received",
          description: `${result.cartonCode} · Assign client in Allocate, then link here`,
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
        } catch {
          /* optional */
        }
      } else {
        if (!walkClientId) throw new Error("Select a client.");
        const { returnId } = await createWalkInReturnWithUser({
          ownerUserId: walkClientId,
          type: walkType,
          returnType: walkReturnType,
          productName: walkType === "existing" ? walkName : null,
          sku: walkType === "existing" ? walkSku : null,
          newProductName: walkType === "new" ? walkName : null,
          newProductSku: walkType === "new" ? walkSku : null,
          requestedQuantity: parseInt(walkQty, 10) || 1,
          userRemarks: walkNotes.trim() || null,
          operatorId,
        });
        toast({
          title: "Walk-in return created",
          description: `Approved · receive from Open / In progress (${returnId.slice(0, 8)}…)`,
        });
      }
      setWalkInOpen(false);
      setWalkName("");
      setWalkSku("");
      setWalkNotes("");
      setWalkClientId("");
      setWalkClientLabel("");
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
      toast({ title: "Select carton and client", variant: "destructive" });
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
        description: `Linked · quarantine for Return QC (${returnId.slice(0, 8)}…)`,
      });
      setLinkOpen(false);
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

  return (
    <div className="space-y-4">
      <WarehouseOpsHeader title="Returns" />
      <p className="text-sm text-muted-foreground -mt-2">
        Pending → approve → receive (quarantine) →{" "}
        <Link href="/warehouse-ops/return-qc" className="underline text-foreground">
          Return QC
        </Link>{" "}
        → ship / close + invoice. Walk-in with or without client.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => setWalkInOpen(true)}>
          <UserPlus className="h-4 w-4 mr-1" />
          Walk-in return
        </Button>
        {unallocatedReturnCartons.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setLinkCartonId(unallocatedReturnCartons[0]?.id || "");
              setLinkOpen(true);
            }}
          >
            <Package className="h-4 w-4 mr-1" />
            Link unallocated ({unallocatedReturnCartons.length})
          </Button>
        )}
        <Button variant="outline" size="sm" asChild>
          <Link href="/warehouse-ops/return-qc">
            <RotateCcw className="h-4 w-4 mr-1" />
            Return QC
          </Link>
        </Button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search client, product, SKU…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as StatusTab)}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          {(
            [
              ["pending", "Pending", counts.pending],
              ["open", "Open", counts.open],
              ["in_progress", "In progress", counts.in_progress],
              ["closed", "Closed", counts.closed],
              ["all", "All", counts.all],
            ] as const
          ).map(([id, label, count]) => (
            <TabsTrigger key={id} value={id} className="gap-1.5">
              {label}
              <Badge variant="secondary" className="text-[10px] px-1.5">
                {count}
              </Badge>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={tab} className="mt-3 space-y-2">
          {loading ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading returns…
            </p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No returns in this queue.
            </p>
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
              return (
                <Card
                  key={`${owner}-${row.id}`}
                  className={cn(
                    "border",
                    row.status === "pending" && "border-amber-200",
                    row.status === "in_progress" && "border-violet-200"
                  )}
                >
                  <CardHeader className="py-3 pb-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-sm font-medium">
                          {displayName(client, owner)}
                        </CardTitle>
                        <CardDescription className="text-xs mt-0.5">
                          {resolveReturnProductName(row)}
                          {resolveReturnSku(row) ? ` · ${resolveReturnSku(row)}` : ""}
                        </CardDescription>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <StatusBadge status={row.status} />
                        {row.type === "existing" ? (
                          <Badge variant="outline">Existing</Badge>
                        ) : (
                          <Badge variant="outline">New</Badge>
                        )}
                        {row.returnType && (
                          <Badge variant="secondary" className="capitalize">
                            {row.returnType}
                          </Badge>
                        )}
                        {row.source === "warehouse_ops_walk_in" && (
                          <Badge variant="outline">Walk-in</Badge>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0 pb-3 space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Qty {row.receivedQuantity || 0}/{row.requestedQuantity || 0}
                      {rem > 0 ? ` · ${rem} left to receive` : ""}
                      {shipAvail > 0 ? ` · ${shipAvail} shippable` : ""}
                      {(row.inventoryCreditedQuantity || 0) > 0
                        ? ` · ${row.inventoryCreditedQuantity} in inventory`
                        : ""}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {row.status === "pending" && (
                        <>
                          <Button
                            size="sm"
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
                            disabled={busy || rem < 1}
                            onClick={() => openReceive(row)}
                          >
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
                            Close + invoice
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>
      </Tabs>

      {/* Reject */}
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

      {/* Receive */}
      <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Receive return</DialogTitle>
            <DialogDescription>
              Creates a quarantine carton → continue on Return QC. Keep open for
              partials, or mark ready to close.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>SKU</Label>
              <Input value={recvSku} onChange={(e) => setRecvSku(e.target.value)} />
            </div>
            <div>
              <Label>Product title</Label>
              <Input value={recvTitle} onChange={(e) => setRecvTitle(e.target.value)} />
            </div>
            <div>
              <Label>Quantity this receive</Label>
              <Input
                type="number"
                min={1}
                value={recvQty}
                onChange={(e) => setRecvQty(e.target.value)}
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={recvNotes} onChange={(e) => setRecvNotes(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={recvCloseReady}
                onCheckedChange={(v) => setRecvCloseReady(v === true)}
              />
              User asked to close after this receive (ready to close + invoice)
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiveOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void handleReceive()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Receive to quarantine"}
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

      {/* Walk-in */}
      <Dialog open={walkInOpen} onOpenChange={setWalkInOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Walk-in return</DialogTitle>
            <DialogDescription>
              With client: creates an approved RMA (existing or new). Without client:
              closed carton → Allocate, then link.
            </DialogDescription>
          </DialogHeader>
          <RadioGroup
            value={walkInMode}
            onValueChange={(v) => setWalkInMode(v as "with_user" | "no_user")}
            className="flex gap-4"
          >
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="with_user" />
              Client known
            </label>
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="no_user" />
              Client unknown
            </label>
          </RadioGroup>

          {walkInMode === "with_user" ? (
            <div className="space-y-3">
              <div>
                <Label>Client</Label>
                <CrossdockClientCombobox
                  clients={clients}
                  clientId={walkClientId}
                  clientLabel={walkClientLabel}
                  onChange={({ clientId, clientLabel }) => {
                    setWalkClientId(clientId);
                    setWalkClientLabel(clientLabel);
                  }}
                />
              </div>
              <RadioGroup
                value={walkType}
                onValueChange={(v) => setWalkType(v as "existing" | "new")}
                className="flex gap-4"
              >
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="existing" />
                  Existing product
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="new" />
                  New product
                </label>
              </RadioGroup>
              <div>
                <Label>Return type</Label>
                <Select
                  value={walkReturnType}
                  onValueChange={(v) => setWalkReturnType(v as "combine" | "partial")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="partial">Partial — separate batches</SelectItem>
                    <SelectItem value="combine">Combine — all together</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{walkType === "new" ? "New product name" : "Product name"}</Label>
                <Input value={walkName} onChange={(e) => setWalkName(e.target.value)} />
              </div>
              <div>
                <Label>SKU (optional)</Label>
                <Input value={walkSku} onChange={(e) => setWalkSku(e.target.value)} />
              </div>
              <div>
                <Label>Requested qty</Label>
                <Input
                  type="number"
                  min={1}
                  value={walkQty}
                  onChange={(e) => setWalkQty(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label>Closed unit qty (1 carton)</Label>
                <Input
                  type="number"
                  min={1}
                  value={walkQty}
                  onChange={(e) => setWalkQty(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Goes to Allocate like inbound walk-in. After client is assigned, use{" "}
                <strong>Link unallocated</strong> to start return receiving.
              </p>
            </div>
          )}
          <div>
            <Label>Notes</Label>
            <Textarea value={walkNotes} onChange={(e) => setWalkNotes(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWalkInOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void handleWalkIn()}>
              {walkInMode === "no_user" ? "Receive closed" : "Create return"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link unallocated */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link unallocated return</DialogTitle>
            <DialogDescription>
              Assign client and create RMA → carton moves to quarantine for Return QC.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Carton</Label>
              <Select value={linkCartonId} onValueChange={setLinkCartonId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select carton" />
                </SelectTrigger>
                <SelectContent>
                  {unallocatedReturnCartons.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.cartonCode} · qty {c.quantity}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Client</Label>
              <CrossdockClientCombobox
                clients={clients}
                clientId={linkClientId}
                clientLabel={linkClientLabel}
                onChange={({ clientId, clientLabel }) => {
                  setLinkClientId(clientId);
                  setLinkClientLabel(clientLabel);
                }}
              />
            </div>
            <RadioGroup
              value={linkType}
              onValueChange={(v) => setLinkType(v as "existing" | "new")}
              className="flex gap-4"
            >
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="existing" />
                Existing
              </label>
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="new" />
                New product
              </label>
            </RadioGroup>
            <div>
              <Label>Product name</Label>
              <Input value={linkName} onChange={(e) => setLinkName(e.target.value)} />
            </div>
            <div>
              <Label>SKU</Label>
              <Input value={linkSku} onChange={(e) => setLinkSku(e.target.value)} />
            </div>
            <div>
              <Label>Qty</Label>
              <Input
                type="number"
                min={1}
                value={linkQty}
                onChange={(e) => setLinkQty(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void handleLinkWalkIn()}>
              Start return
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
