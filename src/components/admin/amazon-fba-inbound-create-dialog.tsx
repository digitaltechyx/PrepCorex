"use client";

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  Box,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Loader2,
  MapPin,
  Package,
  Plus,
  Trash2,
  Truck,
  User,
  Warehouse,
} from "lucide-react";

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
  packing: "Packing",
  placement: "Placement",
  transportation: "Carrier",
  delivery: "Delivery",
  review: "Review",
  done: "Complete",
};

const WIZARD_STEPS: WizardStep[] = [
  "details",
  "packing",
  "placement",
  "transportation",
  "delivery",
  "review",
];

const BOX_FIELD_LABELS: Record<
  "lengthIn" | "widthIn" | "heightIn" | "weightLb" | "boxCount",
  string
> = {
  lengthIn: "Length (in)",
  widthIn: "Width (in)",
  heightIn: "Height (in)",
  weightLb: "Weight (lb)",
  boxCount: "Box qty",
};

function WizardStepper({ step }: { step: WizardStep }) {
  const activeIndex =
    step === "done"
      ? WIZARD_STEPS.length
      : Math.max(0, WIZARD_STEPS.indexOf(step));

  return (
    <div className="rounded-xl border bg-muted/20 px-3 py-4 sm:px-4">
      <ol className="flex items-center justify-between gap-1">
        {WIZARD_STEPS.map((wizardStep, index) => {
          const done = step === "done" || index < activeIndex;
          const current = step !== "done" && wizardStep === step;
          return (
            <li key={wizardStep} className="flex min-w-0 flex-1 items-center">
              <div className="flex min-w-0 flex-col items-center gap-1.5 text-center">
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors",
                    done
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : current
                        ? "border-orange-500 bg-orange-500 text-white"
                        : "border-muted-foreground/25 bg-background text-muted-foreground"
                  )}
                >
                  {done ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
                </div>
                <span
                  className={cn(
                    "hidden max-w-[4.5rem] truncate text-[10px] font-medium leading-tight sm:block",
                    current ? "text-orange-600" : done ? "text-emerald-700" : "text-muted-foreground"
                  )}
                >
                  {STEP_LABELS[wizardStep]}
                </span>
              </div>
              {index < WIZARD_STEPS.length - 1 ? (
                <div
                  className={cn(
                    "mx-1 h-0.5 min-w-[8px] flex-1 rounded-full",
                    index < activeIndex ? "bg-emerald-500" : "bg-muted-foreground/20"
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-center text-xs text-muted-foreground sm:hidden">
        Step {Math.min(activeIndex + 1, 6)} of 6 · {STEP_LABELS[step === "done" ? "review" : step]}
      </p>
    </div>
  );
}

function SectionCard({
  title,
  description,
  icon: Icon,
  children,
  className,
}: {
  title: string;
  description?: string;
  icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("overflow-hidden border-muted/80 shadow-sm", className)}>
      <CardHeader className="space-y-0 border-b bg-muted/25 px-4 py-3">
        <div className="flex items-start gap-3">
          {Icon ? (
            <div className="rounded-lg bg-orange-500/10 p-2 text-orange-600">
              <Icon className="h-4 w-4" />
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <CardTitle className="text-sm font-semibold">{title}</CardTitle>
            {description ? (
              <CardDescription className="mt-0.5 text-xs">{description}</CardDescription>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4">{children}</CardContent>
    </Card>
  );
}

function OptionCard({
  title,
  subtitle,
  meta,
  value,
}: {
  title: string;
  subtitle?: string;
  meta?: string;
  value: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-all hover:border-orange-300 hover:bg-orange-50/40 has-[[data-state=checked]]:border-orange-500 has-[[data-state=checked]]:bg-orange-50/60 has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-orange-500/20"
      )}
    >
      <RadioGroupItem value={value} className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium leading-snug">{title}</p>
        {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
        {meta ? <p className="font-mono text-[11px] text-muted-foreground break-all">{meta}</p> : null}
      </div>
    </label>
  );
}

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


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] max-w-4xl flex-col gap-0 overflow-hidden p-0">
        <div className="border-b bg-gradient-to-r from-slate-950 via-slate-900 to-orange-950 px-6 py-5 text-white">
          <DialogHeader className="space-y-3 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                Admin only
              </span>
              <span className="rounded-full bg-orange-500/20 px-2.5 py-0.5 text-[10px] font-medium text-orange-100">
                Amazon FBA inbound
              </span>
            </div>
            <DialogTitle className="text-xl font-semibold tracking-tight text-white">
              Create FBA inbound plan
            </DialogTitle>
            <DialogDescription className="text-sm text-slate-300">
              {clientLabel || "Client"} · Build the plan, confirm placement, then retrieve shipping labels
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {step !== "done" ? <WizardStepper step={step} /> : null}

          {step === "done" && confirmResult ? (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4">
                <div className="rounded-full bg-emerald-500 p-2 text-white">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-semibold text-emerald-900">Inbound confirmed</p>
                  <p className="text-sm text-emerald-800">
                    Amazon accepted the shipment plan. Download labels when ready.
                  </p>
                </div>
              </div>
              <SectionCard title="Plan reference" icon={ClipboardList}>
                <p className="font-mono text-xs break-all text-muted-foreground">
                  {String(confirmResult.inboundPlanId)}
                </p>
              </SectionCard>
              {Array.isArray(confirmResult.labels) &&
                confirmResult.labels.map(
                  (label: { shipmentId: string; downloadUrl?: string; labelKind?: string }) => (
                    <Card key={label.shipmentId} className="border-muted/80 shadow-sm">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-mono">{label.shipmentId}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        {label.downloadUrl ? (
                          <a
                            href={label.downloadUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-sm font-medium text-orange-600 hover:text-orange-700 hover:underline"
                          >
                            Download {label.labelKind || "labels"}
                            <ChevronRight className="h-4 w-4" />
                          </a>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Labels pending in Seller Central
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  )
                )}
            </div>
          ) : step === "packing" ? (
            <SectionCard
              title="Packing option"
              description="Choose how Amazon groups SKUs for this inbound plan."
              icon={Package}
            >
              <RadioGroup value={selectedPackingOptionId} onValueChange={setSelectedPackingOptionId}>
                <div className="space-y-2">
                  {packingOptions.map((opt) => (
                    <OptionCard
                      key={opt.packingOptionId}
                      value={opt.packingOptionId}
                      title={opt.description}
                      subtitle={opt.feesLabel || undefined}
                    />
                  ))}
                </div>
              </RadioGroup>
            </SectionCard>
          ) : step === "placement" ? (
            <SectionCard
              title="Fulfillment center placement"
              description="Choose where Amazon splits inventory across FC shipments."
              icon={MapPin}
            >
              <RadioGroup value={selectedPlacementOptionId} onValueChange={setSelectedPlacementOptionId}>
                <div className="space-y-2">
                  {placementOptions.map((opt) => (
                    <OptionCard
                      key={opt.placementOptionId}
                      value={opt.placementOptionId}
                      title={opt.description}
                      subtitle={opt.feesLabel || undefined}
                      meta={opt.shipmentIds.join(", ")}
                    />
                  ))}
                </div>
              </RadioGroup>
            </SectionCard>
          ) : step === "transportation" ? (
            <SectionCard
              title="Carrier & transportation"
              description="Select the carrier option Amazon returned for each shipment."
              icon={Truck}
            >
              <div className="space-y-3">
                {shipmentIds.map((sid) => {
                  const opts = transportationOptions.filter((o) => o.shipmentId === sid);
                  return (
                    <div key={sid} className="rounded-xl border bg-muted/10 p-4 space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Shipment
                      </p>
                      <p className="font-mono text-sm font-medium">{sid}</p>
                      <Select
                        value={transportByShipment[sid] || ""}
                        onValueChange={(v) => setTransportByShipment((prev) => ({ ...prev, [sid]: v }))}
                      >
                        <SelectTrigger className="bg-background">
                          <SelectValue placeholder="Select transportation option" />
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
            </SectionCard>
          ) : step === "delivery" ? (
            <SectionCard
              title="Delivery windows"
              description="Required for non-partnered or your-own-carrier LTL freight."
              icon={CalendarClock}
            >
              <div className="space-y-3">
                {shipmentsNeedingDelivery.map((sid) => {
                  const opts = deliveryWindowOptions.filter((o) => o.shipmentId === sid);
                  return (
                    <div key={sid} className="rounded-xl border bg-muted/10 p-4 space-y-2">
                      <p className="font-mono text-sm font-medium">{sid}</p>
                      {opts.length ? (
                        <Select
                          value={deliveryByShipment[sid] || ""}
                          onValueChange={(v) => setDeliveryByShipment((prev) => ({ ...prev, [sid]: v }))}
                        >
                          <SelectTrigger className="bg-background">
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
                        <p className="text-xs text-muted-foreground">
                          No windows returned — confirm may still work if not required.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          ) : step === "review" ? (
            <div className="space-y-4">
              <SectionCard title="Review before confirm" description="Check selections, then confirm with Amazon." icon={ClipboardList}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Plan ID</p>
                    <p className="mt-1 font-mono text-xs break-all">{inboundPlanId}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Shipping</p>
                    <p className="mt-1 text-sm">{shippingMode === "LTL" ? "LTL pallet freight" : "SPD small parcel"}</p>
                    <p className="text-xs text-muted-foreground">
                      {shippingSolution === "AMAZON_PARTNERED" ? "Amazon partnered" : "Your own carrier"}
                    </p>
                  </div>
                </div>
                <Separator />
                <div className="space-y-2 text-sm">
                  <p><span className="font-medium">Packing:</span>{" "}
                    {packingOptions.find((p) => p.packingOptionId === selectedPackingOptionId)?.description}
                  </p>
                  <p><span className="font-medium">Placement:</span> {selectedPlacement?.description}</p>
                  <p><span className="font-medium">Shipments:</span>{" "}
                    <span className="font-mono text-xs">{shipmentIds.join(", ")}</span>
                  </p>
                  {shipmentIds.map((sid) => {
                    const t = transportationOptions.find(
                      (o) => o.transportationOptionId === transportByShipment[sid]
                    );
                    return (
                      <p key={sid}>
                        <span className="font-medium font-mono text-xs">{sid}:</span>{" "}
                        {t?.description || transportByShipment[sid]}
                      </p>
                    );
                  })}
                  {shipmentsNeedingDelivery.map((sid) => {
                    const w = deliveryWindowOptions.find(
                      (o) => o.deliveryWindowOptionId === deliveryByShipment[sid]
                    );
                    return w ? (
                      <p key={`dw-${sid}`}>
                        <span className="font-medium">Delivery {sid}:</span> {w.description}
                      </p>
                    ) : null;
                  })}
                </div>
              </SectionCard>
            </div>
          ) : (
            <div className="space-y-4">
              <SectionCard
                title="Plan & ship-from"
                description="Name the plan and choose the warehouse address Amazon should use."
                icon={Warehouse}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="plan-name">Plan name</Label>
                    <Input
                      id="plan-name"
                      value={planName}
                      onChange={(e) => setPlanName(e.target.value)}
                      placeholder="e.g. March restock — Kate Smith"
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Ship-from warehouse</Label>
                    <Select value={warehouseId} onValueChange={setWarehouseId}>
                      <SelectTrigger className="bg-background">
                        <SelectValue placeholder="Select warehouse" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeWarehouses.map((w) => (
                          <SelectItem key={w.id} value={w.id}>
                            {w.name || w.code}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </SectionCard>

              <SectionCard
                title="Shipping method"
                description="SPD for cartons; LTL when freight moves on pallets."
                icon={Truck}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Shipping type</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        variant={shippingMode === "SPD" ? "default" : "outline"}
                        className={cn(shippingMode === "SPD" && "bg-orange-600 hover:bg-orange-700")}
                        onClick={() => setShippingMode("SPD")}
                      >
                        SPD
                      </Button>
                      <Button
                        type="button"
                        variant={shippingMode === "LTL" ? "default" : "outline"}
                        className={cn(shippingMode === "LTL" && "bg-orange-600 hover:bg-orange-700")}
                        onClick={() => setShippingMode("LTL")}
                      >
                        LTL
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {shippingMode === "SPD" ? "Small parcel / master cases" : "Pallet freight shipment"}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Carrier arrangement</Label>
                    <Select
                      value={shippingSolution}
                      onValueChange={(v) => setShippingSolution(v as ShippingSolution)}
                    >
                      <SelectTrigger className="bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="AMAZON_PARTNERED">Amazon partnered carrier</SelectItem>
                        <SelectItem value="USE_YOUR_OWN">Your own carrier</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </SectionCard>

              <SectionCard
                title="Freight contact"
                description="Used for Amazon transportation and delivery coordination."
                icon={User}
              >
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="contact-name">Contact name</Label>
                    <Input
                      id="contact-name"
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                      placeholder="Full name"
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="contact-email">Email</Label>
                    <Input
                      id="contact-email"
                      type="email"
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                      placeholder="name@company.com"
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="contact-phone">Phone</Label>
                    <Input
                      id="contact-phone"
                      value={contactPhone}
                      onChange={(e) => setContactPhone(e.target.value)}
                      placeholder="+1 …"
                      className="bg-background"
                    />
                  </div>
                </div>
              </SectionCard>

              <SectionCard
                title="Plan SKUs"
                description="MSKUs and quantities included in this inbound plan."
                icon={ClipboardList}
              >
                {fbaInventory.length > 0 ? (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Quick add from FBA inventory</Label>
                    <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto rounded-lg border bg-muted/20 p-2">
                      {fbaInventory.slice(0, 30).map((r) => (
                        <Button
                          key={r.sellerSku}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 bg-background text-xs"
                          onClick={() => addFromInventory(r.sellerSku)}
                        >
                          {r.sellerSku}
                          <span className="ml-1 text-muted-foreground">({r.fulfillableQuantity})</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="space-y-2">
                  <div className="hidden gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid sm:grid-cols-[1fr_96px_40px]">
                    <span>MSKU</span>
                    <span>Quantity</span>
                    <span />
                  </div>
                  {planLines.map((line, idx) => (
                    <div key={idx} className="grid gap-2 sm:grid-cols-[1fr_96px_40px]">
                      <Input
                        value={line.msku}
                        onChange={(e) =>
                          setPlanLines((p) =>
                            p.map((l, i) => (i === idx ? { ...l, msku: e.target.value } : l))
                          )
                        }
                        placeholder="Seller SKU (MSKU)"
                        className="bg-background"
                      />
                      <Input
                        type="number"
                        min={1}
                        value={line.quantity}
                        onChange={(e) =>
                          setPlanLines((p) =>
                            p.map((l, i) =>
                              i === idx
                                ? { ...l, quantity: Math.max(1, Number(e.target.value) || 1) }
                                : l
                            )
                          )
                        }
                        className="bg-background"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                        disabled={planLines.length <= 1}
                        onClick={() =>
                          setPlanLines((p) => (p.length <= 1 ? p : p.filter((_, i) => i !== idx)))
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPlanLines((p) => [...p, { msku: "", quantity: 1 }])}
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Add SKU line
                  </Button>
                </div>
              </SectionCard>

              <SectionCard
                title="Carton packing"
                description="Box dimensions and which SKUs go in each carton. Amazon requires this even for LTL."
                icon={Box}
              >
                <div className="space-y-4">
                  {boxes.map((box, boxIdx) => (
                    <div key={boxIdx} className="rounded-xl border bg-muted/10 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="flex items-center gap-2 text-sm font-semibold">
                          <Package className="h-4 w-4 text-orange-600" />
                          Carton {boxIdx + 1}
                        </p>
                        {boxes.length > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 text-destructive"
                            onClick={() => setBoxes((p) => p.filter((_, i) => i !== boxIdx))}
                          >
                            <Trash2 className="mr-1 h-3.5 w-3.5" />
                            Remove
                          </Button>
                        ) : null}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-5">
                        {(["lengthIn", "widthIn", "heightIn", "weightLb", "boxCount"] as const).map(
                          (k) => (
                            <div key={k} className="space-y-1.5">
                              <Label className="text-xs">{BOX_FIELD_LABELS[k]}</Label>
                              <Input
                                value={box[k]}
                                onChange={(e) =>
                                  setBoxes((p) =>
                                    p.map((b, i) => (i === boxIdx ? { ...b, [k]: e.target.value } : b))
                                  )
                                }
                                className="bg-background"
                              />
                            </div>
                          )
                        )}
                      </div>
                      <Separator />
                      <div className="space-y-2">
                        <Label className="text-xs">Contents in this carton</Label>
                        {box.items.map((line, li) => (
                          <div key={li} className="grid gap-2 sm:grid-cols-[1fr_96px_40px]">
                            <Input
                              value={line.msku}
                              onChange={(e) =>
                                setBoxes((p) =>
                                  p.map((b, i) =>
                                    i === boxIdx
                                      ? {
                                          ...b,
                                          items: b.items.map((it, j) =>
                                            j === li ? { ...it, msku: e.target.value } : it
                                          ),
                                        }
                                      : b
                                  )
                                )
                              }
                              placeholder="MSKU in carton"
                              className="bg-background"
                            />
                            <Input
                              type="number"
                              min={1}
                              value={line.quantity}
                              onChange={(e) =>
                                setBoxes((p) =>
                                  p.map((b, i) =>
                                    i === boxIdx
                                      ? {
                                          ...b,
                                          items: b.items.map((it, j) =>
                                            j === li
                                              ? {
                                                  ...it,
                                                  quantity: Math.max(1, Number(e.target.value) || 1),
                                                }
                                              : it
                                          ),
                                        }
                                      : b
                                  )
                                )
                              }
                              className="bg-background"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="text-destructive"
                              disabled={box.items.length <= 1}
                              onClick={() =>
                                setBoxes((p) =>
                                  p.map((b, i) =>
                                    i === boxIdx
                                      ? {
                                          ...b,
                                          items:
                                            b.items.length <= 1
                                              ? b.items
                                              : b.items.filter((_, j) => j !== li),
                                        }
                                      : b
                                  )
                                )
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setBoxes((p) =>
                              p.map((b, i) =>
                                i === boxIdx
                                  ? { ...b, items: [...b.items, { msku: "", quantity: 1 }] }
                                  : b
                              )
                            )
                          }
                        >
                          <Plus className="mr-1.5 h-3.5 w-3.5" />
                          Add SKU to carton
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setBoxes((p) => [...p, emptyBox(validPlanLines.map((l) => ({ ...l, quantity: 1 })))])
                    }
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Add carton
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setBoxes([emptyBox(validPlanLines)])}
                  >
                    Put all SKUs in carton 1
                  </Button>
                </div>
              </SectionCard>

              {shippingMode === "LTL" ? (
                <SectionCard
                  title="LTL freight pallets"
                  description="Pallet count, weight, and dimensions for Amazon freight quoting."
                  icon={Truck}
                  className="border-orange-200/60"
                >
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Number of pallets</Label>
                      <Input
                        type="number"
                        min={1}
                        value={palletQty}
                        onChange={(e) => setPalletQty(e.target.value)}
                        className="bg-background"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Pallet weight (lb)</Label>
                      <Input
                        type="number"
                        min={0}
                        value={palletWeight}
                        onChange={(e) => setPalletWeight(e.target.value)}
                        className="bg-background"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Declared value (USD)</Label>
                      <Input
                        type="number"
                        min={0}
                        value={freightValue}
                        onChange={(e) => setFreightValue(e.target.value)}
                        className="bg-background"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Freight class</Label>
                      <Input
                        value={freightClass}
                        onChange={(e) => setFreightClass(e.target.value)}
                        placeholder="FC_50"
                        className="bg-background"
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Length (in)</Label>
                      <Input
                        type="number"
                        min={0}
                        value={palletLength}
                        onChange={(e) => setPalletLength(e.target.value)}
                        className="bg-background"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Width (in)</Label>
                      <Input
                        type="number"
                        min={0}
                        value={palletWidth}
                        onChange={(e) => setPalletWidth(e.target.value)}
                        className="bg-background"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Height (in)</Label>
                      <Input
                        type="number"
                        min={0}
                        value={palletHeight}
                        onChange={(e) => setPalletHeight(e.target.value)}
                        className="bg-background"
                      />
                    </div>
                  </div>
                </SectionCard>
              ) : null}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 border-t bg-muted/20 px-6 py-4">
          {step === "done" ? (
            <Button className="bg-orange-600 hover:bg-orange-700" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          ) : (
            <>
              {step !== "details" ? (
                <Button
                  variant="outline"
                  disabled={loading}
                  onClick={() => {
                    const i = WIZARD_STEPS.indexOf(step);
                    if (i > 0) setStep(WIZARD_STEPS[i - 1]);
                  }}
                >
                  Back
                </Button>
              ) : (
                <div />
              )}
              {step === "details" ? (
                <Button
                  className="bg-orange-600 hover:bg-orange-700"
                  onClick={() => void onCreatePlan()}
                  disabled={loading}
                >
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Create plan & continue
                </Button>
              ) : null}
              {step === "packing" ? (
                <Button
                  className="bg-orange-600 hover:bg-orange-700"
                  onClick={() => void onApplyPacking()}
                  disabled={loading}
                >
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Continue to placement
                </Button>
              ) : null}
              {step === "placement" ? (
                <Button
                  className="bg-orange-600 hover:bg-orange-700"
                  onClick={() => void onLoadTransportation()}
                  disabled={loading}
                >
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Load carrier options
                </Button>
              ) : null}
              {step === "transportation" ? (
                <Button
                  className="bg-orange-600 hover:bg-orange-700"
                  onClick={() => void onContinueFromTransport()}
                  disabled={loading}
                >
                  Continue
                </Button>
              ) : null}
              {step === "delivery" ? (
                <Button className="bg-orange-600 hover:bg-orange-700" onClick={onContinueFromDelivery} disabled={loading}>
                  Review shipment
                </Button>
              ) : null}
              {step === "review" ? (
                <Button className="bg-orange-600 hover:bg-orange-700" onClick={() => void onConfirmShip()} disabled={loading}>
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Confirm & get labels
                </Button>
              ) : null}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
