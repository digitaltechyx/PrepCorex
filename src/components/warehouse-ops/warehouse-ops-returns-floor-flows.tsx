"use client";

import type { Dispatch, ReactNode, SetStateAction } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { CrossdockClientCombobox } from "@/components/warehouse-ops/crossdock-client-combobox";
import type { AdminProductReturn } from "@/hooks/use-all-product-returns";
import {
  resolveReturnProductName,
  resolveReturnSku,
} from "@/lib/product-return-ops";
import type { ReturnReceiveUnitType, ReturnStockLocation } from "@/lib/warehouse-returns";
import { describeReceiveLotHint } from "@/lib/warehouse-receive-lot";
import { generateCrossdockReceiveLot } from "@/lib/warehouse-crossdock";
import type { UserProfile, WarehouseCartonDoc } from "@/types";
import {
  ArrowLeft,
  Boxes,
  Check,
  CheckCircle2,
  Inbox,
  Loader2,
  Package,
  PackageOpen,
  PackagePlus,
  Search,
  UserPlus,
  UserRoundSearch,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type FloorFlow = "queue" | "walk-in" | "receive" | "link";
export type WalkPhase = "pick-mode" | "pick-unit" | "form";
export type RecvPhase = "pick-unit" | "form";

function TypePickerCard({
  color,
  icon,
  title,
  description,
  onClick,
}: {
  color: "orange" | "indigo" | "emerald" | "sky";
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  const colorMap = {
    orange: "border-orange-200 hover:border-orange-400 hover:bg-orange-50/40 text-orange-600",
    indigo: "border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50/40 text-indigo-600",
    emerald:
      "border-emerald-200 hover:border-emerald-400 hover:bg-emerald-50/40 text-emerald-600",
    sky: "border-sky-200 hover:border-sky-400 hover:bg-sky-50/40 text-sky-600",
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

function walkInUnitKind(c: WarehouseCartonDoc): "PLT" | "PKG" | "CTN" {
  if (c.palletId) return "PLT";
  if (c.isPackage) return "PKG";
  return "CTN";
}

function formatWalkInUnitLabel(c: WarehouseCartonDoc): string {
  const kind = walkInUnitKind(c);
  const name = c.receivedForClient?.trim() || "";
  const lot = c.receiveLot?.trim() || c.lot?.trim() || "";
  return [`${kind} ${c.cartonCode}`, name || null, lot || null, `qty ${c.quantity}`]
    .filter(Boolean)
    .join(" · ");
}

export type ReturnsFloorFlowsProps = {
  floorFlow: FloorFlow;
  busy: boolean;
  clients: UserProfile[];
  onBack: () => void;
  onWalkIn: () => void;
  onReceive: () => void;
  onLink: () => void;
  walkPhase: WalkPhase;
  setWalkPhase: Dispatch<SetStateAction<WalkPhase>>;
  walkInMode: "with_user" | "no_user";
  setWalkInMode: Dispatch<SetStateAction<"with_user" | "no_user">>;
  walkClientId: string;
  walkClientLabel: string;
  setWalkClientId: (id: string) => void;
  setWalkClientLabel: (label: string) => void;
  walkType: "existing" | "new";
  setWalkType: Dispatch<SetStateAction<"existing" | "new">>;
  walkReturnType: "combine" | "partial";
  setWalkReturnType: Dispatch<SetStateAction<"combine" | "partial">>;
  walkName: string;
  setWalkName: (v: string) => void;
  walkSku: string;
  setWalkSku: (v: string) => void;
  walkQty: string;
  setWalkQty: (v: string) => void;
  walkNotes: string;
  setWalkNotes: (v: string) => void;
  walkUnknownName: string;
  setWalkUnknownName: (v: string) => void;
  walkUnitType: "carton" | "pallet" | "package";
  setWalkUnitType: Dispatch<SetStateAction<"carton" | "pallet" | "package">>;
  walkLot: string;
  setWalkLot: (v: string) => void;
  selected: AdminProductReturn | null;
  priorLocations: ReturnStockLocation[];
  recvPhase: RecvPhase;
  setRecvPhase: Dispatch<SetStateAction<RecvPhase>>;
  recvUnitType: ReturnReceiveUnitType;
  setRecvUnitType: Dispatch<SetStateAction<ReturnReceiveUnitType>>;
  recvSku: string;
  setRecvSku: (v: string) => void;
  recvTitle: string;
  setRecvTitle: (v: string) => void;
  recvQty: string;
  setRecvQty: (v: string) => void;
  recvLot: string;
  setRecvLot: (v: string) => void;
  recvExpiry: string;
  setRecvExpiry: (v: string) => void;
  recvCondition: "good" | "damaged";
  setRecvCondition: Dispatch<SetStateAction<"good" | "damaged">>;
  recvNotes: string;
  setRecvNotes: (v: string) => void;
  recvCloseReady: boolean;
  setRecvCloseReady: (v: boolean) => void;
  unallocatedReturnCartons: WarehouseCartonDoc[];
  filteredLinkUnits: WarehouseCartonDoc[];
  selectedLinkUnit: WarehouseCartonDoc | null;
  linkUnitQuery: string;
  setLinkUnitQuery: (v: string) => void;
  linkCartonId: string;
  pickLinkUnit: (c: WarehouseCartonDoc) => void;
  linkClientId: string;
  linkClientLabel: string;
  setLinkClientId: (id: string) => void;
  setLinkClientLabel: (label: string) => void;
  linkType: "existing" | "new";
  setLinkType: Dispatch<SetStateAction<"existing" | "new">>;
  linkName: string;
  setLinkName: (v: string) => void;
  linkSku: string;
  setLinkSku: (v: string) => void;
  linkQty: string;
  setLinkQty: (v: string) => void;
};

export function ReturnsFloorFlows(props: ReturnsFloorFlowsProps) {
  const { floorFlow, busy, clients, onBack, onWalkIn, onReceive, onLink } = props;

  if (floorFlow === "walk-in") {
    return <WalkInFlow props={props} busy={busy} clients={clients} onBack={onBack} onWalkIn={onWalkIn} />;
  }
  if (floorFlow === "receive" && props.selected) {
    return <ReceiveFlow props={props} busy={busy} onBack={onBack} onReceive={onReceive} />;
  }
  if (floorFlow === "link") {
    return <LinkFlow props={props} busy={busy} clients={clients} onBack={onBack} onLink={onLink} />;
  }
  return null;
}

function WalkInFlow({
  props,
  busy,
  clients,
  onBack,
  onWalkIn,
}: {
  props: ReturnsFloorFlowsProps;
  busy: boolean;
  clients: UserProfile[];
  onBack: () => void;
  onWalkIn: () => void;
}) {
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to queue
      </Button>
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Walk-in return</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Same steps as inbound: pick how you know the owner, choose unit type for closed
          receive, then lot + label.
        </p>
      </div>

      {props.walkPhase === "pick-mode" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <TypePickerCard
            color="emerald"
            icon={<UserPlus className="h-8 w-8" />}
            title="Client known"
            description="Assign the system client now, create an open RMA, then receive SKUs into putaway."
            onClick={() => {
              props.setWalkInMode("with_user");
              props.setWalkPhase("form");
            }}
          />
          <TypePickerCard
            color="orange"
            icon={<Package className="h-8 w-8" />}
            title="Client unknown"
            description="Closed receive like inbound walk-in — name on label, auto lot, no SKUs yet. Link later."
            onClick={() => {
              props.setWalkInMode("no_user");
              props.setWalkPhase("pick-unit");
              props.setWalkLot(generateCrossdockReceiveLot());
            }}
          />
        </div>
      ) : null}

      {props.walkPhase === "pick-unit" && props.walkInMode === "no_user" ? (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2"
            onClick={() => props.setWalkPhase("pick-mode")}
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
          <p className="text-sm text-muted-foreground">Closed walk-in — what are you receiving?</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <TypePickerCard
              color="orange"
              icon={<Package className="h-8 w-8" />}
              title="Carton"
              description="One closed carton — CTN label, auto lot. SKUs when client is linked."
              onClick={() => {
                props.setWalkUnitType("carton");
                props.setWalkPhase("form");
              }}
            />
            <TypePickerCard
              color="indigo"
              icon={<Boxes className="h-8 w-8" />}
              title="Pallet"
              description="One closed pallet — PLT + CTN labels, auto lot."
              onClick={() => {
                props.setWalkUnitType("pallet");
                props.setWalkPhase("form");
              }}
            />
            <TypePickerCard
              color="emerald"
              icon={<PackageOpen className="h-8 w-8" />}
              title="Package / polybag"
              description="Closed bag — PKG label, auto lot."
              onClick={() => {
                props.setWalkUnitType("package");
                props.setWalkPhase("form");
              }}
            />
          </div>
        </>
      ) : null}

      {props.walkPhase === "form" ? (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">
                  {props.walkInMode === "no_user"
                    ? `Closed ${props.walkUnitType} receive`
                    : "Create return for known client"}
                </CardTitle>
                <CardDescription className="text-xs mt-1">
                  {props.walkInMode === "no_user"
                    ? "Name + lot + qty · print label · link client later"
                    : "Opens an approved RMA — receive from the queue next"}
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  props.setWalkPhase(props.walkInMode === "no_user" ? "pick-unit" : "pick-mode")
                }
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {props.walkInMode === "with_user" ? (
              <>
                <div>
                  <Label>Client *</Label>
                  <CrossdockClientCombobox
                    clients={clients}
                    clientId={props.walkClientId}
                    clientLabel={props.walkClientLabel}
                    onChange={({ clientId, clientLabel }) => {
                      props.setWalkClientId(clientId);
                      props.setWalkClientLabel(clientLabel);
                    }}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <TypePickerCard
                    color={props.walkType === "existing" ? "sky" : "indigo"}
                    icon={<Search className="h-6 w-6" />}
                    title="Existing product"
                    description="Return of a known SKU / title."
                    onClick={() => props.setWalkType("existing")}
                  />
                  <TypePickerCard
                    color={props.walkType === "new" ? "emerald" : "indigo"}
                    icon={<PackagePlus className="h-6 w-6" />}
                    title="New product"
                    description="Create product details with this return."
                    onClick={() => props.setWalkType("new")}
                  />
                </div>
                <div>
                  <Label>Return type</Label>
                  <Select
                    value={props.walkReturnType}
                    onValueChange={(v) => props.setWalkReturnType(v as "combine" | "partial")}
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
                  <Label>
                    {props.walkType === "new" ? "New product name *" : "Product name *"}
                  </Label>
                  <Input value={props.walkName} onChange={(e) => props.setWalkName(e.target.value)} />
                </div>
                <div>
                  <Label>SKU (optional)</Label>
                  <Input value={props.walkSku} onChange={(e) => props.setWalkSku(e.target.value)} />
                </div>
                <div>
                  <Label>Requested qty</Label>
                  <Input
                    type="number"
                    min={1}
                    value={props.walkQty}
                    onChange={(e) => props.setWalkQty(e.target.value)}
                  />
                </div>
              </>
            ) : (
              <>
                <Card className="border-amber-200/80 bg-amber-50/40 shadow-none">
                  <CardContent className="py-3 text-xs text-amber-950">
                    Unit: <strong className="uppercase">{props.walkUnitType}</strong> · No SKUs
                    yet. After Allocate finds the client, use <strong>Link unallocated</strong>.
                  </CardContent>
                </Card>
                <div>
                  <Label>Name on label *</Label>
                  <Input
                    value={props.walkUnknownName}
                    onChange={(e) => props.setWalkUnknownName(e.target.value)}
                    placeholder="Shipper / sender / temp name"
                  />
                </div>
                <div>
                  <Label>Receive lot (auto)</Label>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={props.walkLot}
                      className="font-mono text-sm bg-muted/50 flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => props.setWalkLot(generateCrossdockReceiveLot())}
                    >
                      New lot
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    LOT-XDOCK + date + random — prints on the label.
                  </p>
                </div>
                <div>
                  <Label>Quantity</Label>
                  <Input
                    type="number"
                    min={1}
                    value={props.walkQty}
                    onChange={(e) => props.setWalkQty(e.target.value)}
                  />
                </div>
              </>
            )}
            <div>
              <Label>Notes</Label>
              <Textarea
                value={props.walkNotes}
                onChange={(e) => props.setWalkNotes(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onBack}>
                Cancel
              </Button>
              <Button disabled={busy} onClick={() => void onWalkIn()}>
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : props.walkInMode === "no_user" ? (
                  "Receive closed · print label"
                ) : (
                  "Create return"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function ReceiveFlow({
  props,
  busy,
  onBack,
  onReceive,
}: {
  props: ReturnsFloorFlowsProps;
  busy: boolean;
  onBack: () => void;
  onReceive: () => void;
}) {
  const selected = props.selected!;
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to queue
      </Button>
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Receive return</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {resolveReturnProductName(selected)} · {resolveReturnSku(selected) || "no SKU"} · remaining{" "}
          {Math.max(0, (selected.requestedQuantity || 0) - (selected.receivedQuantity || 0))}
        </p>
      </div>

      {props.priorLocations.length > 0 ? (
        <Card className="border-blue-200/80 bg-blue-50/40 shadow-none">
          <CardContent className="py-3 text-xs space-y-1.5 text-blue-950">
            <p className="font-medium">Previous qty for this return</p>
            {props.priorLocations.map((loc) => (
              <div key={`${loc.cartonId}-${loc.binId || loc.stagingArea || loc.status}`}>
                {loc.cartonCode}: {loc.quantity} × {loc.sku}
                {loc.lot ? ` · ${loc.lot}` : ""}
                {" — "}
                {loc.binPath ||
                  (loc.binId
                    ? `Bin ${loc.binId.slice(0, 8)}…`
                    : loc.status === "received"
                      ? `Awaiting putaway (${loc.stagingArea || "RETURNS-STAGE"})`
                      : loc.status)}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {props.recvPhase === "pick-unit" ? (
        <>
          <p className="text-sm text-muted-foreground">Choose unit type — same as inbound receive.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <TypePickerCard
              color="orange"
              icon={<Package className="h-8 w-8" />}
              title="Carton"
              description="CTN label, auto lot, then putaway."
              onClick={() => {
                props.setRecvUnitType("carton");
                props.setRecvPhase("form");
              }}
            />
            <TypePickerCard
              color="indigo"
              icon={<Boxes className="h-8 w-8" />}
              title="Pallet"
              description="PLT + CTN labels, auto lot, then putaway."
              onClick={() => {
                props.setRecvUnitType("pallet");
                props.setRecvPhase("form");
              }}
            />
            <TypePickerCard
              color="emerald"
              icon={<PackageOpen className="h-8 w-8" />}
              title="Package / polybag"
              description="PKG label, auto lot, then putaway."
              onClick={() => {
                props.setRecvUnitType("package");
                props.setRecvPhase("form");
              }}
            />
            <TypePickerCard
              color="sky"
              icon={<Inbox className="h-8 w-8" />}
              title="Loose / unpackaged"
              description="Count units without a closed CTN/PLT/PKG shell."
              onClick={() => {
                props.setRecvUnitType("loose");
                props.setRecvPhase("form");
              }}
            />
          </div>
        </>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base capitalize">
                  Receive as {props.recvUnitType}
                </CardTitle>
                <CardDescription className="text-xs mt-1">
                  Lot + optional expiry · good stock → putaway · damaged → quarantine
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => props.setRecvPhase("pick-unit")}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                Change unit
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>SKU *</Label>
                <Input value={props.recvSku} onChange={(e) => props.setRecvSku(e.target.value)} />
              </div>
              <div>
                <Label>Quantity this receive *</Label>
                <Input
                  type="number"
                  min={1}
                  value={props.recvQty}
                  onChange={(e) => props.setRecvQty(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label>Product title</Label>
              <Input
                value={props.recvTitle}
                onChange={(e) => props.setRecvTitle(e.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Receive lot (optional)</Label>
                <Input
                  value={props.recvLot}
                  onChange={(e) => props.setRecvLot(e.target.value)}
                  placeholder="Auto-generate if blank"
                  className="font-mono text-sm"
                />
                <p className="text-[11px] text-muted-foreground mt-1">{describeReceiveLotHint()}</p>
              </div>
              <div>
                <Label>Expiry date (optional)</Label>
                <Input
                  type="date"
                  value={props.recvExpiry}
                  onChange={(e) => props.setRecvExpiry(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  Used in lot code and putaway FEFO when set.
                </p>
              </div>
            </div>
            <div>
              <Label>Condition</Label>
              <div className="grid gap-3 sm:grid-cols-2 mt-1.5">
                <TypePickerCard
                  color={props.recvCondition === "good" ? "emerald" : "indigo"}
                  icon={<CheckCircle2 className="h-6 w-6" />}
                  title="Good → putaway"
                  description="Stage for putaway like inbound."
                  onClick={() => props.setRecvCondition("good")}
                />
                <TypePickerCard
                  color={props.recvCondition === "damaged" ? "orange" : "indigo"}
                  icon={<XCircle className="h-6 w-6" />}
                  title="Damaged → quarantine"
                  description="Hold in quarantine instead of putaway."
                  onClick={() => props.setRecvCondition("damaged")}
                />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                value={props.recvNotes}
                onChange={(e) => props.setRecvNotes(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={props.recvCloseReady}
                onCheckedChange={(v) => props.setRecvCloseReady(v === true)}
              />
              User asked to close after this receive (ready to close + invoice)
            </label>
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onBack}>
                Cancel
              </Button>
              <Button disabled={busy} onClick={() => void onReceive()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Receive → Putaway"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function LinkFlow({
  props,
  busy,
  clients,
  onBack,
  onLink,
}: {
  props: ReturnsFloorFlowsProps;
  busy: boolean;
  clients: UserProfile[];
  onBack: () => void;
  onLink: () => void;
}) {
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to queue
      </Button>
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Link unallocated return</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Search closed CTN / PLT / PKG by code, lot, or label name — assign client — start RMA for
          putaway.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-orange-200/70">
          <CardHeader className="pb-3 space-y-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="h-4 w-4" />
              Find closed unit
            </CardTitle>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8 h-9 text-sm"
                value={props.linkUnitQuery}
                onChange={(e) => props.setLinkUnitQuery(e.target.value)}
                placeholder="Type CTN, LOT, or name…"
                autoFocus
              />
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="max-h-80 overflow-y-auto space-y-1.5">
              {props.unallocatedReturnCartons.length === 0 ? (
                <p className="text-xs text-muted-foreground py-6 text-center">
                  No unallocated return units.
                </p>
              ) : props.filteredLinkUnits.length === 0 ? (
                <p className="text-xs text-muted-foreground py-6 text-center">
                  No units match “{props.linkUnitQuery.trim()}”.
                </p>
              ) : (
                props.filteredLinkUnits.map((c) => {
                  const kind = walkInUnitKind(c);
                  const selectedUnit = c.id === props.linkCartonId;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className={cn(
                        "flex w-full items-start gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                        selectedUnit
                          ? "border-orange-400 bg-orange-50/70"
                          : "hover:bg-muted/50"
                      )}
                      onClick={() => props.pickLinkUnit(c)}
                    >
                      <Check
                        className={cn(
                          "mt-0.5 h-4 w-4 shrink-0",
                          selectedUnit ? "opacity-100 text-orange-700" : "opacity-0"
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="secondary" className="text-[10px] px-1.5">
                            {kind}
                          </Badge>
                          <span className="font-mono text-xs font-medium">{c.cartonCode}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {[
                            c.receivedForClient?.trim(),
                            c.receiveLot?.trim() || c.lot?.trim(),
                            `qty ${c.quantity}`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <UserRoundSearch className="h-4 w-4" />
              Assign client & product
            </CardTitle>
            <CardDescription className="text-xs">
              {props.selectedLinkUnit
                ? formatWalkInUnitLabel(props.selectedLinkUnit)
                : "Select a closed unit on the left first"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Client *</Label>
              <CrossdockClientCombobox
                clients={clients}
                clientId={props.linkClientId}
                clientLabel={props.linkClientLabel}
                onChange={({ clientId, clientLabel }) => {
                  props.setLinkClientId(clientId);
                  props.setLinkClientLabel(clientLabel);
                }}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <TypePickerCard
                color={props.linkType === "existing" ? "sky" : "indigo"}
                icon={<Search className="h-6 w-6" />}
                title="Existing"
                description="Known product return."
                onClick={() => props.setLinkType("existing")}
              />
              <TypePickerCard
                color={props.linkType === "new" ? "emerald" : "indigo"}
                icon={<PackagePlus className="h-6 w-6" />}
                title="New product"
                description="Create product with this link."
                onClick={() => props.setLinkType("new")}
              />
            </div>
            <div>
              <Label>Product name</Label>
              <Input value={props.linkName} onChange={(e) => props.setLinkName(e.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>SKU</Label>
                <Input value={props.linkSku} onChange={(e) => props.setLinkSku(e.target.value)} />
              </div>
              <div>
                <Label>Qty</Label>
                <Input
                  type="number"
                  min={1}
                  value={props.linkQty}
                  onChange={(e) => props.setLinkQty(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onBack}>
                Cancel
              </Button>
              <Button disabled={busy} onClick={() => void onLink()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start return"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
