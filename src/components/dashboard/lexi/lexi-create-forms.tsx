"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { db } from "@/lib/firebase";
import { cn } from "@/lib/utils";

export type LexiFormKind = "inbound_create" | "outbound_create" | "report_generate";

type InventoryOption = {
  id: string;
  productName: string;
  sku: string;
  quantity: number;
};

type OutboundLineDraft = {
  key: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: string;
  packOf: string;
};

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
        {label}
        {required ? <span className="text-violet-600"> *</span> : null}
      </span>
      {children}
    </label>
  );
}

function selectClassName(extra?: string) {
  return cn(
    "flex h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] text-slate-900 shadow-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100",
    extra
  );
}

function useClientInventory(userId: string | undefined) {
  const [items, setItems] = useState<InventoryOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, `users/${userId}/inventory`));
        if (cancelled) return;
        const next = snap.docs
          .map((d) => {
            const data = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              productName: String(data.productName || "Product"),
              sku: data.sku != null ? String(data.sku) : "",
              quantity: Math.max(0, Math.floor(Number(data.quantity) || 0)),
            };
          })
          .sort((a, b) => a.productName.localeCompare(b.productName, undefined, { sensitivity: "base" }))
          .slice(0, 400);
        setItems(next);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return { items, loading };
}

export function LexiInboundCreateForm({
  userId,
  disabled,
  onCancel,
  onSubmit,
}: {
  userId: string;
  disabled?: boolean;
  onCancel: () => void;
  onSubmit: (fields: Record<string, unknown>) => Promise<void>;
}) {
  const { items, loading: inventoryLoading } = useClientInventory(userId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [productSubType, setProductSubType] = useState<"new" | "restock">("new");
  const [productId, setProductId] = useState("");
  const [productName, setProductName] = useState("");
  const [sku, setSku] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [expiryDate, setExpiryDate] = useState("");
  const [retailIdentifier, setRetailIdentifier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [carrier, setCarrier] = useState("");
  const [unitLengthIn, setUnitLengthIn] = useState("");
  const [unitWidthIn, setUnitWidthIn] = useState("");
  const [unitHeightIn, setUnitHeightIn] = useState("");
  const [unitWeightLb, setUnitWeightLb] = useState("");
  const [remarks, setRemarks] = useState("");

  const selected = useMemo(
    () => items.find((item) => item.id === productId) || null,
    [items, productId]
  );

  useEffect(() => {
    if (productSubType !== "restock" || !selected) return;
    setProductName(selected.productName);
    setSku(selected.sku || "");
  }, [productSubType, selected]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const qty = Math.floor(Number(quantity));
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Quantity must be greater than 0.");
      return;
    }
    if (productSubType === "new" && !productName.trim()) {
      setError("Product name is required.");
      return;
    }
    if (productSubType === "restock" && !productId) {
      setError("Select a product to restock.");
      return;
    }

    const fields: Record<string, unknown> = {
      productSubType,
      productName: productName.trim() || selected?.productName || "",
      quantity: qty,
    };
    if (productSubType === "restock") fields.productId = productId;
    if (sku.trim()) fields.sku = sku.trim();
    if (expiryDate.trim()) fields.expiryDate = expiryDate.trim();
    if (retailIdentifier.trim()) fields.retailIdentifier = retailIdentifier.trim();
    if (trackingNumber.trim()) fields.trackingNumber = trackingNumber.trim();
    if (carrier.trim()) fields.carrier = carrier.trim();
    if (remarks.trim()) fields.remarks = remarks.trim();
    if (unitLengthIn) fields.unitLengthIn = Number(unitLengthIn);
    if (unitWidthIn) fields.unitWidthIn = Number(unitWidthIn);
    if (unitHeightIn) fields.unitHeightIn = Number(unitHeightIn);
    if (unitWeightLb) fields.unitWeightLb = Number(unitWeightLb);

    setSubmitting(true);
    try {
      await onSubmit(fields);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not prepare inbound.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="rounded-2xl border border-violet-200 bg-white p-3 shadow-sm dark:border-violet-900 dark:bg-slate-900"
    >
      <div className="mb-2">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Create inbound</p>
        <p className="text-[11px] text-slate-500">Fill the form — then Confirm before anything is created.</p>
      </div>

      <div className="space-y-2.5">
        <Field label="Type" required>
          <select
            className={selectClassName()}
            value={productSubType}
            disabled={disabled || submitting}
            onChange={(e) => setProductSubType(e.target.value as "new" | "restock")}
          >
            <option value="new">New product</option>
            <option value="restock">Restock existing</option>
          </select>
        </Field>

        {productSubType === "restock" ? (
          <Field label="Product" required>
            <select
              className={selectClassName()}
              value={productId}
              disabled={disabled || submitting || inventoryLoading}
              onChange={(e) => setProductId(e.target.value)}
            >
              <option value="">{inventoryLoading ? "Loading inventory…" : "Select product…"}</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.productName}
                  {item.sku ? ` · ${item.sku}` : ""} · qty {item.quantity}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="Product name" required>
            <Input
              value={productName}
              disabled={disabled || submitting}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="Product name"
              className="h-9 rounded-lg text-[13px]"
            />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Field label="Quantity" required>
            <Input
              type="number"
              min={1}
              value={quantity}
              disabled={disabled || submitting}
              onChange={(e) => setQuantity(e.target.value)}
              className="h-9 rounded-lg text-[13px]"
            />
          </Field>
          <Field label="SKU">
            <Input
              value={sku}
              disabled={disabled || submitting}
              onChange={(e) => setSku(e.target.value)}
              placeholder="Optional"
              className="h-9 rounded-lg text-[13px]"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Expiry date">
            <Input
              type="date"
              value={expiryDate}
              disabled={disabled || submitting}
              onChange={(e) => setExpiryDate(e.target.value)}
              className="h-9 rounded-lg text-[13px]"
            />
          </Field>
          <Field label="Retail ID (UPC/FNSKU)">
            <Input
              value={retailIdentifier}
              disabled={disabled || submitting}
              onChange={(e) => setRetailIdentifier(e.target.value)}
              placeholder="Optional"
              className="h-9 rounded-lg text-[13px]"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Tracking #">
            <Input
              value={trackingNumber}
              disabled={disabled || submitting}
              onChange={(e) => setTrackingNumber(e.target.value)}
              placeholder="Optional"
              className="h-9 rounded-lg text-[13px]"
            />
          </Field>
          <Field label="Carrier">
            <select
              className={selectClassName()}
              value={carrier}
              disabled={disabled || submitting}
              onChange={(e) => setCarrier(e.target.value)}
            >
              <option value="">Optional</option>
              <option value="ups">UPS</option>
              <option value="fedex">FedEx</option>
              <option value="usps">USPS</option>
              <option value="dhl">DHL</option>
              <option value="other">Other</option>
            </select>
          </Field>
        </div>

        <div>
          <p className="mb-1 text-[11px] font-medium text-slate-600 dark:text-slate-300">
            Unit size / weight (optional)
          </p>
          <div className="grid grid-cols-4 gap-1.5">
            <Input
              type="number"
              min={0}
              step="0.01"
              value={unitLengthIn}
              disabled={disabled || submitting}
              onChange={(e) => setUnitLengthIn(e.target.value)}
              placeholder="L in"
              className="h-9 rounded-lg px-2 text-[12px]"
            />
            <Input
              type="number"
              min={0}
              step="0.01"
              value={unitWidthIn}
              disabled={disabled || submitting}
              onChange={(e) => setUnitWidthIn(e.target.value)}
              placeholder="W in"
              className="h-9 rounded-lg px-2 text-[12px]"
            />
            <Input
              type="number"
              min={0}
              step="0.01"
              value={unitHeightIn}
              disabled={disabled || submitting}
              onChange={(e) => setUnitHeightIn(e.target.value)}
              placeholder="H in"
              className="h-9 rounded-lg px-2 text-[12px]"
            />
            <Input
              type="number"
              min={0}
              step="0.01"
              value={unitWeightLb}
              disabled={disabled || submitting}
              onChange={(e) => setUnitWeightLb(e.target.value)}
              placeholder="lb"
              className="h-9 rounded-lg px-2 text-[12px]"
            />
          </div>
        </div>

        <Field label="Remarks">
          <Textarea
            value={remarks}
            disabled={disabled || submitting}
            onChange={(e) => setRemarks(e.target.value)}
            rows={2}
            placeholder="Optional notes"
            className="min-h-[56px] resize-none rounded-lg text-[13px]"
          />
        </Field>
      </div>

      {error ? <p className="mt-2 text-[12px] text-red-600">{error}</p> : null}

      <div className="mt-3 flex gap-2">
        <Button
          type="submit"
          size="sm"
          className="bg-violet-600 hover:bg-violet-700"
          disabled={disabled || submitting}
        >
          {submitting ? (
            <>
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              Preparing…
            </>
          ) : (
            "Review & Confirm"
          )}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={submitting} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function LexiOutboundCreateForm({
  userId,
  disabled,
  onCancel,
  onSubmit,
}: {
  userId: string;
  disabled?: boolean;
  onCancel: () => void;
  onSubmit: (fields: Record<string, unknown>) => Promise<void>;
}) {
  const { items, loading: inventoryLoading } = useClientInventory(userId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [service, setService] = useState("FBA/WFS/TFS");
  const [shipmentPreference, setShipmentPreference] = useState<"box" | "pallet">("box");
  const [productType, setProductType] = useState("");
  const [shipTo, setShipTo] = useState("");
  const [remarks, setRemarks] = useState("");
  const [lines, setLines] = useState<OutboundLineDraft[]>([
    { key: "1", productId: "", productName: "", sku: "", quantity: "1", packOf: "1" },
  ]);

  const updateLine = (key: string, patch: Partial<OutboundLineDraft>) => {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const handleProductPick = (key: string, productId: string) => {
    const product = items.find((item) => item.id === productId);
    updateLine(key, {
      productId,
      productName: product?.productName || "",
      sku: product?.sku || "",
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const prepared = lines
      .map((line) => ({
        productId: line.productId,
        productName: line.productName,
        sku: line.sku || undefined,
        quantity: Math.floor(Number(line.quantity)),
        packOf: Math.max(1, Math.floor(Number(line.packOf) || 1)),
      }))
      .filter((line) => line.productId && line.quantity > 0);

    if (prepared.length === 0) {
      setError("Add at least one product line with quantity.");
      return;
    }
    if (!service) {
      setError("Select a service.");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        service,
        shipmentPreference,
        productType: productType || undefined,
        shipTo: shipTo.trim() || undefined,
        remarks: remarks.trim() || undefined,
        lines: prepared,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not prepare outbound.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="rounded-2xl border border-violet-200 bg-white p-3 shadow-sm dark:border-violet-900 dark:bg-slate-900"
    >
      <div className="mb-2">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Create outbound</p>
        <p className="text-[11px] text-slate-500">
          Pick products and options — then Confirm before the request is created.
        </p>
      </div>

      <div className="space-y-2.5">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Service" required>
            <select
              className={selectClassName()}
              value={service}
              disabled={disabled || submitting}
              onChange={(e) => setService(e.target.value)}
            >
              <option value="FBA/WFS/TFS">FBA / WFS / TFS</option>
              <option value="DTC/FBM">DTC / FBM</option>
            </select>
          </Field>
          <Field label="Shipment" required>
            <select
              className={selectClassName()}
              value={shipmentPreference}
              disabled={disabled || submitting}
              onChange={(e) => setShipmentPreference(e.target.value as "box" | "pallet")}
            >
              <option value="box">Box (SPD)</option>
              <option value="pallet">Pallet (LTL)</option>
            </select>
          </Field>
        </div>

        <Field label="Product type">
          <select
            className={selectClassName()}
            value={productType}
            disabled={disabled || submitting}
            onChange={(e) => setProductType(e.target.value)}
          >
            <option value="">Optional</option>
            <option value="Standard">Standard</option>
            <option value="Custom">Custom</option>
            <option value="Large">Large</option>
          </select>
        </Field>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-[11px] font-medium text-slate-600">Product lines *</Label>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px] text-violet-700"
              disabled={disabled || submitting}
              onClick={() =>
                setLines((prev) => [
                  ...prev,
                  {
                    key: `${Date.now()}`,
                    productId: "",
                    productName: "",
                    sku: "",
                    quantity: "1",
                    packOf: "1",
                  },
                ])
              }
            >
              <Plus className="mr-1 h-3 w-3" />
              Add line
            </Button>
          </div>

          {lines.map((line, index) => (
            <div
              key={line.key}
              className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50/80 p-2 dark:border-slate-700 dark:bg-slate-950/40"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium text-slate-500">Line {index + 1}</p>
                {lines.length > 1 ? (
                  <button
                    type="button"
                    className="text-slate-400 hover:text-red-600"
                    disabled={disabled || submitting}
                    onClick={() => setLines((prev) => prev.filter((row) => row.key !== line.key))}
                    aria-label="Remove line"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              <select
                className={selectClassName("bg-white")}
                value={line.productId}
                disabled={disabled || submitting || inventoryLoading}
                onChange={(e) => handleProductPick(line.key, e.target.value)}
              >
                <option value="">{inventoryLoading ? "Loading inventory…" : "Select product…"}</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.productName}
                    {item.sku ? ` · ${item.sku}` : ""} · qty {item.quantity}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-1.5">
                <Input
                  type="number"
                  min={1}
                  value={line.quantity}
                  disabled={disabled || submitting}
                  onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                  placeholder="Boxes"
                  className="h-9 rounded-lg text-[13px]"
                />
                <Input
                  type="number"
                  min={1}
                  value={line.packOf}
                  disabled={disabled || submitting}
                  onChange={(e) => updateLine(line.key, { packOf: e.target.value })}
                  placeholder="Pack of"
                  className="h-9 rounded-lg text-[13px]"
                />
              </div>
            </div>
          ))}
        </div>

        <Field label="Ship-to / destination">
          <Input
            value={shipTo}
            disabled={disabled || submitting}
            onChange={(e) => setShipTo(e.target.value)}
            placeholder="Optional"
            className="h-9 rounded-lg text-[13px]"
          />
        </Field>

        <Field label="Remarks">
          <Textarea
            value={remarks}
            disabled={disabled || submitting}
            onChange={(e) => setRemarks(e.target.value)}
            rows={2}
            placeholder="Optional notes / extra services"
            className="min-h-[56px] resize-none rounded-lg text-[13px]"
          />
        </Field>
      </div>

      {error ? <p className="mt-2 text-[12px] text-red-600">{error}</p> : null}

      <div className="mt-3 flex gap-2">
        <Button
          type="submit"
          size="sm"
          className="bg-violet-600 hover:bg-violet-700"
          disabled={disabled || submitting}
        >
          {submitting ? (
            <>
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              Preparing…
            </>
          ) : (
            "Review & Confirm"
          )}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={submitting} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function LexiReportGenerateForm({
  disabled,
  onCancel,
  onSubmit,
}: {
  disabled?: boolean;
  onCancel: () => void;
  onSubmit: (fields: {
    reportType: string;
    period?: string;
    from?: string;
    to?: string;
  }) => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportType, setReportType] = useState("inventory");
  const [periodMode, setPeriodMode] = useState<"preset" | "custom">("preset");
  const [period, setPeriod] = useState("sep and october");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (periodMode === "custom" && (!from || !to)) {
      setError("Choose From and To dates.");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(
        periodMode === "custom" ? { reportType, from, to } : { reportType, period }
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate report.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="rounded-2xl border border-violet-200 bg-white p-3 shadow-sm dark:border-violet-900 dark:bg-slate-900"
    >
      <div className="mb-2">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Generate report CSV</p>
        <p className="text-[11px] text-slate-500">
          Pick exactly what you want — Inventory products and Inbound requests are separate.
        </p>
      </div>

      <div className="space-y-2.5">
        <Field label="Report type" required>
          <select
            className={selectClassName()}
            value={reportType}
            disabled={disabled || submitting}
            onChange={(e) => setReportType(e.target.value)}
          >
            <option value="inventory">Inventory products only</option>
            <option value="inbound">Inbound requests only</option>
            <option value="outbound">Outbound / shipped</option>
            <option value="returns">Returns</option>
            <option value="dispose">Dispose</option>
          </select>
        </Field>

        <Field label="Period mode" required>
          <select
            className={selectClassName()}
            value={periodMode}
            disabled={disabled || submitting}
            onChange={(e) => setPeriodMode(e.target.value as "preset" | "custom")}
          >
            <option value="preset">Preset / month name</option>
            <option value="custom">Custom from–to dates</option>
          </select>
        </Field>

        {periodMode === "preset" ? (
          <Field label="Period" required>
            <select
              className={selectClassName()}
              value={period}
              disabled={disabled || submitting}
              onChange={(e) => setPeriod(e.target.value)}
            >
              <option value="this_month">This month</option>
              <option value="last_month">Last month</option>
              <option value="sep and october">September and October</option>
              <option value="september">September</option>
              <option value="october">October</option>
              <option value="last_30_days">Last 30 days</option>
              <option value="this_year">This year</option>
              <option value="all_time">All time</option>
            </select>
          </Field>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Field label="From" required>
              <Input
                type="date"
                value={from}
                disabled={disabled || submitting}
                onChange={(e) => setFrom(e.target.value)}
                className="h-9 rounded-lg text-[13px]"
              />
            </Field>
            <Field label="To" required>
              <Input
                type="date"
                value={to}
                disabled={disabled || submitting}
                onChange={(e) => setTo(e.target.value)}
                className="h-9 rounded-lg text-[13px]"
              />
            </Field>
          </div>
        )}
      </div>

      {error ? <p className="mt-2 text-[12px] text-red-600">{error}</p> : null}

      <div className="mt-3 flex gap-2">
        <Button
          type="submit"
          size="sm"
          className="bg-violet-600 hover:bg-violet-700"
          disabled={disabled || submitting}
        >
          {submitting ? (
            <>
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              Generating…
            </>
          ) : (
            "Generate CSV"
          )}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={submitting} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
