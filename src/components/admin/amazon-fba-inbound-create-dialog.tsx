"use client";

import { useEffect, useMemo, useState } from "react";
import { useCollection } from "@/hooks/use-collection";
import { useToast } from "@/hooks/use-toast";
import type { WarehouseDoc } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Loader2, Package, Plus } from "lucide-react";

type FbaInventoryRow = {
  sellerSku: string;
  productName: string | null;
  fulfillableQuantity: number;
};

type LineDraft = { msku: string; quantity: number };
type BoxLineDraft = { msku: string; quantity: number };
type BoxDraft = {
  lengthIn: string;
  widthIn: string;
  heightIn: string;
  weightLb: string;
  boxCount: string;
  items: BoxLineDraft[];
};
type ShippingMode = "SPD" | "LTL";
type ShippingSolution = "AMAZON_PARTNERED" | "USE_YOUR_OWN";

type PackingOption = {
  packingOptionId: string;
  description: string;
  feesLabel: string | null;
  packingGroupIds: string[];
};

type PlacementOption = {
  placementOptionId: string;
  description: string;
  feesLabel: string | null;
  shipmentIds: string[];
};

type TransportationOption = {
  transportationOptionId: string;
  shipmentId: string;
  description: string;
  shippingMode: string;
  shippingSolution: string;
  carrierName: string | null;
  quoteLabel: string | null;
  needsDeliveryWindow: boolean;
};

type DeliveryWindowOption = {
  deliveryWindowOptionId: string;
  shipmentId: string;
  description: string;
};

type WizardStep =
  | "details"
  | "packing"
  | "placement"
  | "transportation"
  | "delivery"
  | "review"
  | "done";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientUserId: string;
  clientLabel?: string;
  fbaInventory: FbaInventoryRow[];
  getAuthToken: () => Promise<string>;
  onCompleted: () => void;
};

const STEP_LABELS: Record<WizardStep, string> = {
  details: "Plan & boxes",
  packing: "Packing option",
  placement: "FC placement",
  transportation: "Carrier & mode",
  delivery: "Delivery windows",
  review: "Review & confirm",
  done: "Complete",
};

function emptyBox(allItems: LineDraft[]): BoxDraft {
  return {
    lengthIn: "12",
    widthIn: "10",
    heightIn: "8",
    weightLb: "5",
    boxCount: "1",
    items: allItems.length
      ? allItems.map((l) => ({ msku: l.msku, quantity: l.quantity }))
      : [{ msku: "", quantity: 1 }],
  };
}

function shippingPayload(
  mode: ShippingMode,
  solution: ShippingSolution,
  contact: { name: string; email: string; phone: string },
  ltl: {
    freightValue: string;
    freightClass: string;
    palletQty: string;
    palletLength: string;
    palletWidth: string;
    palletHeight: string;
    palletWeight: string;
  }
) {
  return {
    mode,
    solution,
    contact: {
      name: contact.name,
      email: contact.email,
      phoneNumber: contact.phone,
    },
    ...(mode === "LTL"
      ? {
          freight: {
            declaredValueAmount: Number(ltl.freightValue) || 500,
            declaredValueCurrency: "USD",
            freightClass: ltl.freightClass.trim() || "FC_50",
          },
          pallets: [
            {
              quantity: Math.max(1, Number(ltl.palletQty) || 1),
              lengthIn: Number(ltl.palletLength) || 48,
              widthIn: Number(ltl.palletWidth) || 40,
              heightIn: Number(ltl.palletHeight) || 48,
              weightLb: Number(ltl.palletWeight) || 500,
              stackability: "STACKABLE",
            },
          ],
        }
      : {}),
  };
}

export function AmazonFbaInboundCreateDialog({
  open,
  onOpenChange,
  clientUserId,
  clientLabel,
  fbaInventory,
  getAuthToken,
  onCompleted,
}: Props) {
  const { toast } = useToast();
  const { data: warehouses } = useCollection<WarehouseDoc>("warehouses");
  const activeWarehouses = useMemo(
    () => warehouses.filter((w) => w.active !== false && w.street1 && w.city),
    [warehouses]
  );

  const [step, setStep] = useState<WizardStep>("details");
  const [loading, setLoading] = useState(false);
  const [planName, setPlanName] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [planLines, setPlanLines] = useState<LineDraft[]>([{ msku: "", quantity: 1 }]);
  const [boxes, setBoxes] = useState<BoxDraft[]>([emptyBox([])]);
  const [shippingMode, setShippingMode] = useState<ShippingMode>("SPD");
  const [shippingSolution, setShippingSolution] = useState<ShippingSolution>("USE_YOUR_OWN");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [freightValue, setFreightValue] = useState("500");
  const [freightClass, setFreightClass] = useState("FC_50");
  const [palletQty, setPalletQty] = useState("1");
  const [palletLength, setPalletLength] = useState("48");
  const [palletWidth, setPalletWidth] = useState("40");
  const [palletHeight, setPalletHeight] = useState("48");
  const [palletWeight, setPalletWeight] = useState("500");

  const [inboundPlanId, setInboundPlanId] = useState("");
  const [packingOptions, setPackingOptions] = useState<PackingOption[]>([]);
  const [selectedPackingOptionId, setSelectedPackingOptionId] = useState("");
  const [placementOptions, setPlacementOptions] = useState<PlacementOption[]>([]);
  const [selectedPlacementOptionId, setSelectedPlacementOptionId] = useState("");
  const [shipmentIds, setShipmentIds] = useState<string[]>([]);
  const [transportationOptions, setTransportationOptions] = useState<TransportationOption[]>([]);
  const [transportByShipment, setTransportByShipment] = useState<Record<string, string>>({});
  const [deliveryWindowOptions, setDeliveryWindowOptions] = useState<DeliveryWindowOption[]>([]);
  const [deliveryByShipment, setDeliveryByShipment] = useState<Record<string, string>>({});
  const [confirmResult, setConfirmResult] = useState<Record<string, unknown> | null>(null);

  const validPlanLines = useMemo(
    () => planLines.filter((l) => l.msku.trim() && l.quantity > 0),
    [planLines]
  );

  const selectedPlacement = placementOptions.find(
    (p) => p.placementOptionId === selectedPlacementOptionId
  );

  const shipmentsNeedingDelivery = useMemo(() => {
    const ids = new Set<string>();
    for (const opt of transportationOptions) {
      const selected = transportByShipment[opt.shipmentId];
      if (selected === opt.transportationOptionId && opt.needsDeliveryWindow) {
        ids.add(opt.shipmentId);
      }
    }
    if (shippingSolution === "USE_YOUR_OWN") {
      for (const sid of shipmentIds) ids.add(sid);
    }
    return Array.from(ids);
  }, [transportationOptions, transportByShipment, shippingSolution, shipmentIds]);

  useEffect(() => {
    if (!open) return;
    setStep("details");
    setLoading(false);
    setConfirmResult(null);
    setInboundPlanId("");
    setPackingOptions([]);
    setSelectedPackingOptionId("");
    setPlacementOptions([]);
    setSelectedPlacementOptionId("");
    setShipmentIds([]);
    setTransportationOptions([]);
    setTransportByShipment({});
    setDeliveryWindowOptions([]);
    setDeliveryByShipment({});
    setPlanName("");
    setPlanLines([{ msku: "", quantity: 1 }]);
    setBoxes([emptyBox([])]);
    if (activeWarehouses.length === 1) setWarehouseId(activeWarehouses[0].id);
  }, [open, activeWarehouses]);

  const wizardPost = async (payload: Record<string, unknown>) => {
    const token = await getAuthToken();
    const res = await fetch("/api/amazon/fba/inbound/wizard", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId: clientUserId, ...payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data.error as string) || "Request failed");
    return data;
  };

  const buildBoxesPayload = () =>
    boxes.map((box) => ({
      lengthIn: Number(box.lengthIn) || 12,
      widthIn: Number(box.widthIn) || 10,
      heightIn: Number(box.heightIn) || 8,
      weightLb: Number(box.weightLb) || 5,
      boxCount: Math.max(1, Number(box.boxCount) || 1),
      items: box.items
        .filter((l) => l.msku.trim() && l.quantity > 0)
        .map((l) => ({ msku: l.msku.trim(), quantity: l.quantity })),
    }));

  const buildShipping = () =>
    shippingPayload(shippingMode, shippingSolution, {
      name: contactName.trim(),
      email: contactEmail.trim(),
      phone: contactPhone.trim(),
    }, {
      freightValue,
      freightClass,
      palletQty,
      palletLength,
      palletWidth,
      palletHeight,
      palletWeight,
    });

  const onCreatePlan = async () => {
    if (!validPlanLines.length || !warehouseId) {
      toast({ variant: "destructive", title: "Complete plan SKUs and warehouse" });
      return;
    }
    setLoading(true);
    try {
      const data = await wizardPost({
        action: "create_plan",
        warehouseId,
        planName: planName.trim() || undefined,
        items: validPlanLines.map((l) => ({ msku: l.msku.trim(), quantity: l.quantity })),
      });
      setInboundPlanId(String(data.inboundPlanId || ""));
      const opts = (data.packingOptions as PackingOption[]) || [];
      setPackingOptions(opts);
      setSelectedPackingOptionId(opts[0]?.packingOptionId || "");
      setStep("packing");
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Create plan failed",
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  };

  const onApplyPacking = async () => {
    if (!selectedPackingOptionId) {
      toast({ variant: "destructive", title: "Select a packing option" });
      return;
    }
    setLoading(true);
    try {
      const data = await wizardPost({
        action: "apply_packing",
        inboundPlanId,
        packingOptionId: selectedPackingOptionId,
        items: validPlanLines.map((l) => ({ msku: l.msku.trim(), quantity: l.quantity })),
        boxes: buildBoxesPayload(),
      });
      const opts = (data.placementOptions as PlacementOption[]) || [];
      setPlacementOptions(opts);
      setSelectedPlacementOptionId(opts[0]?.placementOptionId || "");
      setStep("placement");
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Packing step failed",
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  };

  const onLoadTransportation = async () => {
    const placement = placementOptions.find(
      (p) => p.placementOptionId === selectedPlacementOptionId
    );
    if (!placement) {
      toast({ variant: "destructive", title: "Select a placement option" });
      return;
    }
    setShipmentIds(placement.shipmentIds);
    setLoading(true);
    try {
      const data = await wizardPost({
        action: "load_transportation",
        inboundPlanId,
        placementOptionId: selectedPlacementOptionId,
        shipmentIds: placement.shipmentIds,
        shipping: buildShipping(),
      });
      const opts = (data.transportationOptions as TransportationOption[]) || [];
      setTransportationOptions(opts);
      const defaults: Record<string, string> = {};
      for (const sid of placement.shipmentIds) {
        const prefer = opts.find(
          (o) =>
            o.shipmentId === sid &&
            o.shippingMode.includes(shippingMode === "LTL" ? "LTL" : "SMALL_PARCEL") &&
            o.shippingSolution.includes(
              shippingSolution === "AMAZON_PARTNERED" ? "PARTNERED" : "YOUR_OWN"
            )
        );
        defaults[sid] = prefer?.transportationOptionId || opts.find((o) => o.shipmentId === sid)?.transportationOptionId || "";
      }
      setTransportByShipment(defaults);
      const dOpts = (data.deliveryWindowOptions as DeliveryWindowOption[]) || [];
      setDeliveryWindowOptions(dOpts);
      const dDefaults: Record<string, string> = {};
      for (const w of dOpts) {
        if (!dDefaults[w.shipmentId]) dDefaults[w.shipmentId] = w.deliveryWindowOptionId;
      }
      setDeliveryByShipment(dDefaults);
      setStep("transportation");
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Transportation load failed",
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  };

  const onContinueFromTransport = async () => {
    for (const sid of shipmentIds) {
      if (!transportByShipment[sid]) {
        toast({ variant: "destructive", title: `Select carrier for shipment ${sid}` });
        return;
      }
    }

    const needsWindow = shipmentIds.filter((sid) => {
      const opt = transportationOptions.find(
        (o) => o.transportationOptionId === transportByShipment[sid]
      );
      return opt?.needsDeliveryWindow || shippingSolution === "USE_YOUR_OWN";
    });

    if (needsWindow.length) {
      const missing = needsWindow.filter(
        (sid) => !deliveryWindowOptions.some((w) => w.shipmentId === sid)
      );
      if (missing.length) {
        setLoading(true);
        try {
          const data = await wizardPost({
            action: "load_delivery_windows",
            inboundPlanId,
            shipmentIds: missing,
          });
          const extra = (data.deliveryWindowOptions as DeliveryWindowOption[]) || [];
          setDeliveryWindowOptions((prev) => {
            const merged = [...prev];
            for (const w of extra) {
              if (!merged.some((m) => m.deliveryWindowOptionId === w.deliveryWindowOptionId)) {
                merged.push(w);
              }
            }
            return merged;
          });
          setDeliveryByShipment((prev) => {
            const next = { ...prev };
            for (const w of extra) {
              if (!next[w.shipmentId]) next[w.shipmentId] = w.deliveryWindowOptionId;
            }
            return next;
          });
        } catch (e) {
          toast({
            variant: "destructive",
            title: "Delivery windows failed",
            description: e instanceof Error ? e.message : undefined,
          });
          setLoading(false);
          return;
        }
        setLoading(false);
      }
      setStep("delivery");
    } else {
      setStep("review");
    }
  };

  const onContinueFromDelivery = () => {
    for (const sid of shipmentsNeedingDelivery) {
      if (!deliveryByShipment[sid]) {
        toast({ variant: "destructive", title: `Select delivery window for ${sid}` });
        return;
      }
    }
    setStep("review");
  };

  const onConfirmShip = async () => {
    setLoading(true);
    try {
      const data = await wizardPost({
        action: "confirm_ship",
        inboundPlanId,
        placementOptionId: selectedPlacementOptionId,
        shipmentIds,
        shipping: buildShipping(),
        transportationSelections: shipmentIds.map((sid) => ({
          shipmentId: sid,
          transportationOptionId: transportByShipment[sid],
        })),
        deliveryWindowSelections: shipmentsNeedingDelivery.map((sid) => ({
          shipmentId: sid,
          deliveryWindowOptionId: deliveryByShipment[sid],
        })),
        transportationOptions,
      });
      setConfirmResult(data);
      setStep("done");
      toast({ title: "Inbound confirmed", description: "Labels ready when Amazon provides them." });
      onCompleted();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Confirm failed",
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  };

  const addFromInventory = (sku: string) => {
    setPlanLines((prev) => {
      const existing = prev.find((l) => l.msku === sku);
      if (existing) {
        return prev.map((l) => (l.msku === sku ? { ...l, quantity: l.quantity + 1 } : l));
      }
      if (prev.length === 1 && !prev[0].msku.trim()) return [{ msku: sku, quantity: 1 }];
      return [...prev, { msku: sku, quantity: 1 }];
    });
  };

  const stepIndex = ["details", "packing", "placement", "transportation", "delivery", "review", "done"].indexOf(step);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create FBA inbound (admin)</DialogTitle>
          <DialogDescription>
            Admin-only · {clientLabel || "Client"} · Step {Math.min(stepIndex + 1, 6)}/6 — {STEP_LABELS[step]}
          </DialogDescription>
        </DialogHeader>

        {step !== "done" && step !== "details" && (
          <div className="flex flex-wrap gap-1">
            {(["packing", "placement", "transportation", "delivery", "review"] as WizardStep[]).map((s) => (
              <Badge
                key={s}
                variant={step === s ? "default" : stepIndex > ["packing", "placement", "transportation", "delivery", "review"].indexOf(s) ? "secondary" : "outline"}
                className="text-[10px]"
              >
                {STEP_LABELS[s]}
              </Badge>
            ))}
          </div>
        )}

        {step === "done" && confirmResult ? (
          <div className="space-y-3 py-2 text-sm">
            <p>
              <span className="font-medium">Plan:</span>{" "}
              <span className="font-mono text-xs break-all">{String(confirmResult.inboundPlanId)}</span>
            </p>
            {Array.isArray(confirmResult.labels) &&
              confirmResult.labels.map((label: { shipmentId: string; downloadUrl?: string; labelKind?: string }) => (
                <div key={label.shipmentId} className="rounded-lg border p-3">
                  <p className="font-medium">{label.shipmentId}</p>
                  {label.downloadUrl ? (
                    <a href={label.downloadUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                      Download {label.labelKind || "labels"}
                    </a>
                  ) : (
                    <p className="text-xs text-muted-foreground">Labels pending in Seller Central</p>
                  )}
                </div>
              ))}
          </div>
        ) : step === "packing" ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Choose how Amazon groups SKUs for packing.</p>
            <RadioGroup value={selectedPackingOptionId} onValueChange={setSelectedPackingOptionId}>
              {packingOptions.map((opt) => (
                <label
                  key={opt.packingOptionId}
                  className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer has-[:checked]:border-primary"
                >
                  <RadioGroupItem value={opt.packingOptionId} className="mt-1" />
                  <div>
                    <p className="text-sm font-medium">{opt.description}</p>
                    {opt.feesLabel && <p className="text-xs text-muted-foreground">{opt.feesLabel}</p>}
                  </div>
                </label>
              ))}
            </RadioGroup>
          </div>
        ) : step === "placement" ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Choose destination FC split (placement).</p>
            <RadioGroup value={selectedPlacementOptionId} onValueChange={setSelectedPlacementOptionId}>
              {placementOptions.map((opt) => (
                <label
                  key={opt.placementOptionId}
                  className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer has-[:checked]:border-primary"
                >
                  <RadioGroupItem value={opt.placementOptionId} className="mt-1" />
                  <div>
                    <p className="text-sm font-medium">{opt.description}</p>
                    <p className="text-xs text-muted-foreground font-mono">{opt.shipmentIds.join(", ")}</p>
                  </div>
                </label>
              ))}
            </RadioGroup>
          </div>
        ) : step === "transportation" ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Select carrier / mode per shipment. All Amazon-returned options are listed.
            </p>
            {shipmentIds.map((sid) => {
              const opts = transportationOptions.filter((o) => o.shipmentId === sid);
              return (
                <div key={sid} className="rounded-lg border p-3 space-y-2">
                  <p className="text-sm font-medium font-mono">{sid}</p>
                  <Select
                    value={transportByShipment[sid] || ""}
                    onValueChange={(v) => setTransportByShipment((prev) => ({ ...prev, [sid]: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select transportation" />
                    </SelectTrigger>
                    <SelectContent>
                      {opts.map((o) => (
                        <SelectItem key={o.transportationOptionId} value={o.transportationOptionId}>
                          {o.description}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        ) : step === "delivery" ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Required delivery windows (non-partnered / own carrier).</p>
            {shipmentsNeedingDelivery.map((sid) => {
              const opts = deliveryWindowOptions.filter((o) => o.shipmentId === sid);
              return (
                <div key={sid} className="rounded-lg border p-3 space-y-2">
                  <p className="text-sm font-medium font-mono">{sid}</p>
                  {opts.length ? (
                    <Select
                      value={deliveryByShipment[sid] || ""}
                      onValueChange={(v) => setDeliveryByShipment((prev) => ({ ...prev, [sid]: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select delivery window" />
                      </SelectTrigger>
                      <SelectContent>
                        {opts.map((o) => (
                          <SelectItem key={o.deliveryWindowOptionId} value={o.deliveryWindowOptionId}>
                            {o.description}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-xs text-muted-foreground">No windows returned — confirm may still work if not required.</p>
                  )}
                </div>
              );
            })}
          </div>
        ) : step === "review" ? (
          <div className="space-y-2 text-sm">
            <p><span className="font-medium">Plan ID:</span> <span className="font-mono text-xs">{inboundPlanId}</span></p>
            <p><span className="font-medium">Packing:</span> {packingOptions.find((p) => p.packingOptionId === selectedPackingOptionId)?.description}</p>
            <p><span className="font-medium">Placement:</span> {selectedPlacement?.description}</p>
            <p><span className="font-medium">Shipments:</span> {shipmentIds.join(", ")}</p>
            {shipmentIds.map((sid) => {
              const t = transportationOptions.find((o) => o.transportationOptionId === transportByShipment[sid]);
              return (
                <p key={sid}>
                  <span className="font-medium">{sid}:</span> {t?.description || transportByShipment[sid]}
                </p>
              );
            })}
            {shipmentsNeedingDelivery.map((sid) => {
              const w = deliveryWindowOptions.find((o) => o.deliveryWindowOptionId === deliveryByShipment[sid]);
              return w ? (
                <p key={`dw-${sid}`}>
                  <span className="font-medium">Window {sid}:</span> {w.description}
                </p>
              ) : null;
            })}
          </div>
        ) : (
          /* details step — same form fields as before, abbreviated layout */
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label>Plan name</Label>
                <Input value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="Optional" />
              </div>
              <div>
                <Label>Warehouse</Label>
                <Select value={warehouseId} onValueChange={setWarehouseId}>
                  <SelectTrigger><SelectValue placeholder="Ship from" /></SelectTrigger>
                  <SelectContent>
                    {activeWarehouses.map((w) => (
                      <SelectItem key={w.id} value={w.id}>{w.name || w.code}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label>Shipping type</Label>
                <Select value={shippingMode} onValueChange={(v) => setShippingMode(v as ShippingMode)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SPD">SPD — small parcel</SelectItem>
                    <SelectItem value="LTL">LTL — pallet freight</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Carrier</Label>
                <Select value={shippingSolution} onValueChange={(v) => setShippingSolution(v as ShippingSolution)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AMAZON_PARTNERED">Amazon partnered</SelectItem>
                    <SelectItem value="USE_YOUR_OWN">Your own carrier</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label className="text-xs">Contact</Label><Input value={contactName} onChange={(e) => setContactName(e.target.value)} /></div>
              <div><Label className="text-xs">Email</Label><Input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} /></div>
              <div><Label className="text-xs">Phone</Label><Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} /></div>
            </div>
            {fbaInventory.length > 0 && (
              <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto">
                {fbaInventory.slice(0, 30).map((r) => (
                  <Button key={r.sellerSku} type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => addFromInventory(r.sellerSku)}>
                    {r.sellerSku}
                  </Button>
                ))}
              </div>
            )}
            <div className="space-y-1">
              <Label>Plan SKUs</Label>
              {planLines.map((line, idx) => (
                <div key={idx} className="flex gap-2">
                  <Input value={line.msku} onChange={(e) => setPlanLines((p) => p.map((l, i) => i === idx ? { ...l, msku: e.target.value } : l))} placeholder="MSKU" className="flex-1" />
                  <Input type="number" min={1} value={line.quantity} onChange={(e) => setPlanLines((p) => p.map((l, i) => i === idx ? { ...l, quantity: Math.max(1, Number(e.target.value) || 1) } : l))} className="w-20" />
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setPlanLines((p) => [...p, { msku: "", quantity: 1 }])}><Plus className="h-3 w-3 mr-1" />SKU</Button>
            </div>
            {boxes.map((box, boxIdx) => (
              <div key={boxIdx} className="rounded-lg border p-3 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2"><Package className="h-4 w-4" />Box {boxIdx + 1}</p>
                <div className="grid grid-cols-5 gap-1">
                  {(["lengthIn", "widthIn", "heightIn", "weightLb", "boxCount"] as const).map((k) => (
                    <Input key={k} value={box[k]} onChange={(e) => setBoxes((p) => p.map((b, i) => i === boxIdx ? { ...b, [k]: e.target.value } : b))} placeholder={k} className="text-xs" />
                  ))}
                </div>
                {box.items.map((line, li) => (
                  <div key={li} className="flex gap-2">
                    <Input value={line.msku} onChange={(e) => setBoxes((p) => p.map((b, i) => i === boxIdx ? { ...b, items: b.items.map((it, j) => j === li ? { ...it, msku: e.target.value } : it) } : b))} placeholder="SKU in box" className="flex-1" />
                    <Input type="number" min={1} value={line.quantity} onChange={(e) => setBoxes((p) => p.map((b, i) => i === boxIdx ? { ...b, items: b.items.map((it, j) => j === li ? { ...it, quantity: Math.max(1, Number(e.target.value) || 1) } : it) } : b))} className="w-16" />
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => setBoxes((p) => p.map((b, i) => i === boxIdx ? { ...b, items: [...b.items, { msku: "", quantity: 1 }] } : b))}>+ line</Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setBoxes((p) => [...p, emptyBox(validPlanLines.map((l) => ({ ...l, quantity: 1 })))])}>Add box</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setBoxes([emptyBox(validPlanLines)])}>All SKUs → box 1</Button>
            </div>
            {shippingMode === "LTL" && (
              <div className="grid grid-cols-3 gap-2 rounded-lg border p-3">
                <Input value={palletQty} onChange={(e) => setPalletQty(e.target.value)} placeholder="Pallets" />
                <Input value={palletWeight} onChange={(e) => setPalletWeight(e.target.value)} placeholder="Pallet lb" />
                <Input value={freightValue} onChange={(e) => setFreightValue(e.target.value)} placeholder="Declared $" />
                <Input value={freightClass} onChange={(e) => setFreightClass(e.target.value)} placeholder="FC class" />
                <Input value={palletLength} onChange={(e) => setPalletLength(e.target.value)} placeholder="L" />
                <Input value={palletWidth} onChange={(e) => setPalletWidth(e.target.value)} placeholder="W" />
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === "done" ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              {step !== "details" && (
                <Button
                  variant="outline"
                  disabled={loading}
                  onClick={() => {
                    const order: WizardStep[] = ["details", "packing", "placement", "transportation", "delivery", "review"];
                    const i = order.indexOf(step);
                    if (i > 0) setStep(order[i - 1]);
                  }}
                >
                  Back
                </Button>
              )}
              {step === "details" && (
                <Button onClick={() => void onCreatePlan()} disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Create plan & continue
                </Button>
              )}
              {step === "packing" && (
                <Button onClick={() => void onApplyPacking()} disabled={loading}>Continue to placement</Button>
              )}
              {step === "placement" && (
                <Button onClick={() => void onLoadTransportation()} disabled={loading}>Load carrier options</Button>
              )}
              {step === "transportation" && (
                <Button onClick={() => void onContinueFromTransport()} disabled={loading}>Continue</Button>
              )}
              {step === "delivery" && (
                <Button onClick={onContinueFromDelivery} disabled={loading}>Review</Button>
              )}
              {step === "review" && (
                <Button onClick={() => void onConfirmShip()} disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Confirm & get labels
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
