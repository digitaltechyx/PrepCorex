"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { BookmarkPlus, Plus, Trash2 } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { applyClientInvoiceLifecycleFields } from "@/lib/client-invoice-lifecycle";
import { generateInvoiceNumber } from "@/lib/invoice-utils";
import { normalizeShipmentItems } from "@/lib/shipment-utils";
import {
  addInvoiceCatalogLine,
  catalogLineLabel,
  deleteInvoiceCatalogLine,
  listInvoiceCatalogLines,
  type InvoiceCatalogLine,
} from "@/lib/invoice-line-catalog";
import type { ShippedItem, UserProfile } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

type ProductLine = {
  id: string;
  quantity: number;
  productName: string;
  shipDate: string;
  packaging: string;
  shipTo: string;
  unitPrice: number;
  shipmentId?: string;
};

type ServiceLine = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
};

function newId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function resolveShipDate(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return format(d, "dd/MM/yyyy");
    return value;
  }
  if (value && typeof value === "object" && "seconds" in (value as object)) {
    const seconds = Number((value as { seconds?: number }).seconds || 0);
    if (seconds > 0) return format(new Date(seconds * 1000), "dd/MM/yyyy");
  }
  return fallback;
}

function buildProductLinesFromShipments(shipments: ShippedItem[]): ProductLine[] {
  const todayLabel = format(new Date(), "dd/MM/yyyy");
  const lines: ProductLine[] = [];
  for (const shipped of shipments) {
    const shipDate = resolveShipDate(shipped.date, todayLabel);
    const shipTo = String(shipped.shipTo || "");
    for (const line of normalizeShipmentItems(shipped)) {
      const qty = Number(line.shippedQty ?? line.boxesShipped ?? 0);
      const unitPrice = Number(line.unitPrice ?? shipped.unitPrice ?? 0);
      lines.push({
        id: newId("prod"),
        quantity: qty,
        productName: line.productName || shipped.productName || "Unknown Product",
        shipDate,
        packaging: `${line.packOf ?? shipped.packOf ?? 1} Nos.`,
        shipTo,
        unitPrice,
        shipmentId: shipped.id,
      });
    }
    const labelPrice = Number((shipped as { labelPrice?: number }).labelPrice || 0);
    if (labelPrice > 0.0001) {
      const orderLabel =
        (shipped as { shopifyOrderName?: string }).shopifyOrderName ||
        (shipped as { shopifyOrderId?: string }).shopifyOrderId ||
        "Label";
      lines.push({
        id: newId("label"),
        quantity: 1,
        productName: `Shipping label · ${orderLabel}`,
        shipDate,
        packaging: "Label",
        shipTo,
        unitPrice: labelPrice,
        shipmentId: shipped.id,
      });
    }
  }
  return lines;
}

function buildInitialServiceLines(shipments: ShippedItem[]): ServiceLine[] {
  const lines: ServiceLine[] = [];
  for (const shipped of shipments) {
    const add = shipped.additionalServices;
    if (!add) continue;
    const bubble = Number(add.bubbleWrapFeet || 0);
    const sticker = Number(add.stickerRemovalItems || 0);
    const warn = Number(add.warningLabels || 0);
    const ppf = Number(add.pricePerFoot || 0);
    const ppi = Number(add.pricePerItem || 0);
    const ppl = Number(add.pricePerLabel || 0);
    if (bubble > 0) {
      lines.push({
        id: newId("svc"),
        description: "Bubble Wrap",
        quantity: bubble,
        unitPrice: ppf,
      });
    }
    if (sticker > 0) {
      lines.push({
        id: newId("svc"),
        description: "Sticker Removal",
        quantity: sticker,
        unitPrice: ppi,
      });
    }
    if (warn > 0) {
      lines.push({
        id: newId("svc"),
        description: "Warning Labels",
        quantity: warn,
        unitPrice: ppl,
      });
    }
  }
  return lines;
}

export function CreateOutboundInvoiceDialog({
  open,
  onOpenChange,
  clientUser,
  shipments,
  shipmentRequestId,
  onCreated,
  /** prepcorex = Create Invoice; crm_draft = add services then append to CRM draft */
  mode = "prepcorex",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientUser: Pick<UserProfile, "uid" | "name" | "email" | "phone">;
  shipments: ShippedItem[];
  shipmentRequestId?: string | null;
  onCreated?: () => void;
  mode?: "prepcorex" | "crm_draft";
}) {
  const isCrmDraftMode = mode === "crm_draft";
  const { user, userProfile } = useAuth();
  const { toast } = useToast();
  const catalogOwnerUid = userProfile?.uid || user?.uid || "";

  const isMarketplace = useMemo(() => {
    if (shipmentRequestId) return false;
    return shipments.some((s) => {
      if (s.shipmentRequestId) return false;
      if (s.quickFulfill === true) return true;
      const source = String(s.source || "").trim().toLowerCase();
      return source === "shopify" || source === "amazon" || source === "ebay";
    });
  }, [shipments, shipmentRequestId]);

  const [productLines, setProductLines] = useState<ProductLine[]>([]);
  const [serviceLines, setServiceLines] = useState<ServiceLine[]>([]);
  const [catalog, setCatalog] = useState<InvoiceCatalogLine[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newCatalogDesc, setNewCatalogDesc] = useState("");
  const [newCatalogQty, setNewCatalogQty] = useState("1");
  const [newCatalogPrice, setNewCatalogPrice] = useState("0");

  useEffect(() => {
    if (!open) return;
    setProductLines(buildProductLinesFromShipments(shipments));
    setServiceLines(buildInitialServiceLines(shipments));
  }, [open, shipments]);

  const reloadCatalog = async () => {
    if (!catalogOwnerUid) return;
    setCatalogLoading(true);
    try {
      setCatalog(await listInvoiceCatalogLines(catalogOwnerUid));
    } catch (err) {
      console.warn("[invoice-catalog] load failed", err);
      setCatalog([]);
    } finally {
      setCatalogLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !catalogOwnerUid) return;
    void reloadCatalog();
  }, [open, catalogOwnerUid]);

  const productSubtotal = useMemo(
    () => productLines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0),
    [productLines]
  );
  const servicesSubtotal = useMemo(
    () => serviceLines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0),
    [serviceLines]
  );
  const grandTotal = productSubtotal + servicesSubtotal;

  const applyCatalogToService = (lineId: string, catalogId: string) => {
    const row = catalog.find((c) => c.id === catalogId);
    if (!row) return;
    setServiceLines((prev) =>
      prev.map((line) =>
        line.id === lineId
          ? {
              ...line,
              description: row.description || catalogLineLabel(row),
              quantity: Number(row.quantity) || 1,
              unitPrice: Number(row.unitPrice) || 0,
            }
          : line
      )
    );
  };

  const saveServiceToCatalog = async (line: ServiceLine) => {
    if (!catalogOwnerUid) return;
    const description = line.description.trim();
    if (!description) {
      toast({ variant: "destructive", title: "Add a service description first" });
      return;
    }
    try {
      await addInvoiceCatalogLine(catalogOwnerUid, {
        description,
        quantity: Number(line.quantity) || 1,
        unitPrice: Number(line.unitPrice) || 0,
      });
      await reloadCatalog();
      toast({ title: "Saved to your catalog" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not save to catalog",
        description: err instanceof Error ? err.message : "Try again",
      });
    }
  };

  const addManualCatalogLine = async () => {
    if (!catalogOwnerUid) return;
    const description = newCatalogDesc.trim();
    if (!description) return;
    try {
      await addInvoiceCatalogLine(catalogOwnerUid, {
        description,
        quantity: Number(newCatalogQty) || 1,
        unitPrice: Number(newCatalogPrice) || 0,
      });
      setNewCatalogDesc("");
      setNewCatalogQty("1");
      setNewCatalogPrice("0");
      await reloadCatalog();
      toast({ title: "Catalog line added" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not add catalog line",
        description: err instanceof Error ? err.message : "Try again",
      });
    }
  };

  const handleGenerate = async () => {
    if (!clientUser?.uid) return;
    if (productLines.length === 0 && serviceLines.length === 0) {
      toast({ variant: "destructive", title: "Nothing to invoice" });
      return;
    }
    setSaving(true);
    try {
      const usableServices = serviceLines.filter(
        (line) => line.description.trim() && line.quantity > 0
      );

      if (isCrmDraftMode) {
        const {
          appendLinesToCrmOutboundDraft,
          crmLineDescription,
          markShipmentsLinkedToCrmDraft,
        } = await import("@/lib/crm-outbound-draft-invoice");

        // Persist additional services onto real shipped docs for audit / re-open.
        // Skip synthetic pre-dispatch rows (id request-…).
        if (usableServices.length > 0) {
          const batch = writeBatch(db);
          let writes = 0;
          for (const shipped of shipments) {
            if (!shipped.id || String(shipped.id).startsWith("request-")) continue;
            batch.update(doc(db, `users/${clientUser.uid}/shipped`, shipped.id), {
              adminInvoiceServices: usableServices.map((s) => ({
                description: s.description.trim(),
                quantity: s.quantity,
                unitPrice: s.unitPrice,
              })),
              updatedAt: serverTimestamp(),
            });
            writes += 1;
          }
          if (writes > 0) await batch.commit();
        }

        // Build from edited dialog lines so ship date lands in CRM Item Description.
        const primaryShipDate =
          productLines.map((l) => l.shipDate).find((d) => Boolean(String(d || "").trim())) ||
          format(new Date(), "dd/MM/yyyy");
        const shippedIds = [
          ...new Set(
            shipments
              .map((s) => s.id)
              .filter((id): id is string => Boolean(id) && !String(id).startsWith("request-"))
          ),
        ];
        const requestId =
          shipmentRequestId ||
          shipments.map((s) => s.shipmentRequestId).find((id) => Boolean(id)) ||
          null;
        // Prefer request id so pre-dispatch + post-dispatch lines share keys (no dupes / no dropped services).
        const scopeId = String(requestId || shippedIds[0] || "noscope").trim();
        const lines = [
          ...productLines
            .filter((l) => l.productName.trim() && l.quantity > 0)
            .map((l) => {
              const name = l.productName.trim();
              const shipDate = String(l.shipDate || primaryShipDate).trim();
              const shipTo = String(l.shipTo || "").trim();
              return {
                description: crmLineDescription({ name, shipDate, shipTo }),
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                amount: Math.round(l.quantity * l.unitPrice * 100) / 100,
                sourceKey: `request:${scopeId}:item:${name}:${l.quantity}`,
              };
            }),
          ...usableServices.map((s) => {
            const name = s.description.trim();
            const alreadyHasDate = /ship\s*date\s*:/i.test(name);
            return {
              description: alreadyHasDate
                ? name
                : crmLineDescription({ name, shipDate: primaryShipDate }),
              quantity: s.quantity,
              unitPrice: s.unitPrice,
              amount: Math.round(s.quantity * s.unitPrice * 100) / 100,
              // Include outbound scope so the same service on another order still appends.
              sourceKey: `request:${scopeId}:svc:${name}:${s.quantity}:${s.unitPrice}`,
            };
          }),
        ];

        const result = await appendLinesToCrmOutboundDraft({
          clientUser,
          lines,
          shipmentRequestId: requestId,
          shippedIds,
          adminUid: catalogOwnerUid || null,
        });
        await markShipmentsLinkedToCrmDraft({
          clientUserId: clientUser.uid,
          shippedIds,
          shipmentRequestId: requestId,
          externalInvoiceId: result.externalInvoiceId,
        });

        toast({
          title: result.created ? "CRM draft created" : "Added to CRM draft",
          description: `${result.addedCount} line(s) saved on the consolidated CRM invoice. Open CRM Invoice management to review and send.`,
        });
        onOpenChange(false);
        onCreated?.();
        return;
      }

      const today = new Date();
      const invoiceNumber = generateInvoiceNumber();
      const items = [
        ...productLines.map((line) => ({
          quantity: line.quantity,
          productName: line.productName,
          shipDate: line.shipDate,
          packaging: line.packaging,
          shipTo: line.shipTo,
          unitPrice: line.unitPrice,
          amount: line.quantity * line.unitPrice,
          shipmentId: line.shipmentId,
        })),
        ...usableServices.map((line) => ({
          quantity: line.quantity,
          productName: line.description.trim(),
          shipDate: format(today, "dd/MM/yyyy"),
          packaging: "Additional service",
          shipTo: productLines[0]?.shipTo || "",
          unitPrice: line.unitPrice,
          amount: line.quantity * line.unitPrice,
        })),
      ];
      const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
      const invoiceDoc = applyClientInvoiceLifecycleFields({
        invoiceNumber,
        date: format(today, "dd/MM/yyyy"),
        orderNumber: `ORD-${format(today, "yyyyMMdd")}-${Date.now().toString().slice(-4)}`,
        soldTo: {
          name: clientUser.name || "Unknown User",
          email: clientUser.email || "",
          phone: clientUser.phone || "",
          address: "",
        },
        fbm: "Standard Shipping",
        items,
        subtotal,
        grandTotal: subtotal,
        status: "pending" as const,
        createdAt: new Date(),
        userId: clientUser.uid,
        type: isMarketplace ? "marketplace" : "outbound",
        source: isMarketplace
          ? "admin_create_marketplace_invoice"
          : "admin_create_outbound_invoice",
        shipmentRequestId: shipmentRequestId || null,
        shippedIds: [
          ...new Set(
            shipments
              .map((s) => s.id)
              .filter((id): id is string => Boolean(id) && !String(id).startsWith("request-"))
          ),
        ],
      });

      const invoiceRef = await addDoc(
        collection(db, `users/${clientUser.uid}/invoices`),
        invoiceDoc
      );

      const batch = writeBatch(db);
      for (const shipped of shipments) {
        if (!shipped.id || String(shipped.id).startsWith("request-")) continue;
        batch.update(doc(db, `users/${clientUser.uid}/shipped`, shipped.id), {
          invoiceStatus: "invoiced",
          invoiceId: invoiceRef.id,
          invoiceNumber,
          invoicedAt: serverTimestamp(),
        });
      }
      const requestId =
        shipmentRequestId ||
        shipments.map((s) => s.shipmentRequestId).find((id) => Boolean(id));
      if (requestId) {
        batch.update(doc(db, `users/${clientUser.uid}/shipmentRequests`, requestId), {
          invoiceStatus: "invoiced",
          invoiceId: invoiceRef.id,
          invoiceNumber,
          invoicedAt: serverTimestamp(),
        });
      }
      await batch.commit();

      try {
        const { generateInvoicePDF } = await import("@/lib/invoice-generator");
        await generateInvoicePDF({
          invoiceNumber,
          date: invoiceDoc.date as string,
          orderNumber: invoiceDoc.orderNumber as string,
          soldTo: invoiceDoc.soldTo as {
            name: string;
            email: string;
            phone?: string;
            address?: string;
          },
          fbm: "Standard Shipping",
          items,
          subtotal,
          grandTotal: Number(invoiceDoc.grandTotal || subtotal),
          dueDate: invoiceDoc.dueDate,
        });
      } catch (pdfErr) {
        console.warn("[create-outbound-invoice] PDF skipped", pdfErr);
      }

      toast({
        title: "Invoice generated",
        description: `Invoice ${invoiceNumber} created for ${clientUser.name || "client"}.`,
      });
      onOpenChange(false);
      onCreated?.();
    } catch (err) {
      toast({
        variant: "destructive",
        title: isCrmDraftMode ? "Could not update CRM draft" : "Could not generate invoice",
        description: err instanceof Error ? err.message : "Try again",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[min(92dvh,920px)] w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="border-b px-4 py-3 text-left sm:px-6">
            <DialogTitle>
              {isCrmDraftMode
                ? "Add services → CRM draft"
                : isMarketplace
                  ? "Create invoice"
                  : "Create outbound invoice"}
            </DialogTitle>
            <DialogDescription>
              {isCrmDraftMode
                ? "Add any additional services for this dispatch, then save into this client’s consolidated CRM draft. Each line’s Item Description in CRM will include Ship date."
                : isMarketplace
                  ? "Review fulfilled order lines, add services from your catalog if needed, then generate the invoice."
                  : "Review shipment lines, add additional services (from your catalog or manually), then generate the invoice."}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="font-medium">{clientUser.name || clientUser.email}</div>
              <div className="text-muted-foreground">{clientUser.email}</div>
            </div>

            <section className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Shipment details</h3>
                <span className="text-xs text-muted-foreground">
                  Subtotal ${productSubtotal.toFixed(2)}
                </span>
              </div>
              {productLines.length === 0 ? (
                <p className="text-sm text-muted-foreground">No shipment product lines found.</p>
              ) : (
                <div className="space-y-2">
                  {productLines.map((line) => (
                    <div
                      key={line.id}
                      className="grid grid-cols-1 gap-2 rounded-md border p-2 sm:grid-cols-12 sm:items-end"
                    >
                      <div className="sm:col-span-4">
                        <Label className="text-xs">Product</Label>
                        <Input
                          value={line.productName}
                          onChange={(e) =>
                            setProductLines((prev) =>
                              prev.map((p) =>
                                p.id === line.id ? { ...p, productName: e.target.value } : p
                              )
                            )
                          }
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <Label className="text-xs">Ship date</Label>
                        <Input
                          value={line.shipDate}
                          onChange={(e) =>
                            setProductLines((prev) =>
                              prev.map((p) =>
                                p.id === line.id ? { ...p, shipDate: e.target.value } : p
                              )
                            )
                          }
                          placeholder="dd/MM/yyyy"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <Label className="text-xs">Qty</Label>
                        <Input
                          type="number"
                          min={0}
                          value={line.quantity}
                          onChange={(e) =>
                            setProductLines((prev) =>
                              prev.map((p) =>
                                p.id === line.id
                                  ? { ...p, quantity: Number(e.target.value) || 0 }
                                  : p
                              )
                            )
                          }
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <Label className="text-xs">Unit price</Label>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={line.unitPrice}
                          onChange={(e) =>
                            setProductLines((prev) =>
                              prev.map((p) =>
                                p.id === line.id
                                  ? { ...p, unitPrice: Number(e.target.value) || 0 }
                                  : p
                              )
                            )
                          }
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <Label className="text-xs">Amount</Label>
                        <div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm">
                          ${(line.quantity * line.unitPrice).toFixed(2)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <Separator />

            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Additional services</h3>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setCatalogOpen(true)}>
                    My catalog ({catalog.length})
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setServiceLines((prev) => [
                        ...prev,
                        { id: newId("svc"), description: "", quantity: 1, unitPrice: 0 },
                      ])
                    }
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Add service
                  </Button>
                </div>
              </div>

              {serviceLines.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No additional services yet. Add a line or fill from your catalog.
                </p>
              ) : (
                <div className="space-y-2">
                  {serviceLines.map((line) => (
                    <div
                      key={line.id}
                      className="grid grid-cols-1 gap-2 rounded-md border p-2 sm:grid-cols-12 sm:items-end"
                    >
                      <div className="sm:col-span-4">
                        <Label className="text-xs">Fill from my catalog</Label>
                        <Select
                          value=""
                          onValueChange={(catalogId) => applyCatalogToService(line.id, catalogId)}
                          disabled={catalogLoading || catalog.length === 0}
                        >
                          <SelectTrigger>
                            <SelectValue
                              placeholder={
                                catalogLoading
                                  ? "Loading catalog…"
                                  : catalog.length === 0
                                    ? "No saved lines yet"
                                    : "Fill from my catalog"
                              }
                            />
                          </SelectTrigger>
                          <SelectContent className="z-[100]">
                            {catalog.map((row) => (
                              <SelectItem key={row.id} value={row.id}>
                                {catalogLineLabel(row)} · ${Number(row.unitPrice || 0).toFixed(2)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="sm:col-span-3">
                        <Label className="text-xs">Service</Label>
                        <Input
                          value={line.description}
                          placeholder="Service name"
                          onChange={(e) =>
                            setServiceLines((prev) =>
                              prev.map((s) =>
                                s.id === line.id ? { ...s, description: e.target.value } : s
                              )
                            )
                          }
                        />
                      </div>
                      <div className="sm:col-span-1">
                        <Label className="text-xs">Qty</Label>
                        <Input
                          type="number"
                          min={0}
                          value={line.quantity}
                          onChange={(e) =>
                            setServiceLines((prev) =>
                              prev.map((s) =>
                                s.id === line.id
                                  ? { ...s, quantity: Number(e.target.value) || 0 }
                                  : s
                              )
                            )
                          }
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <Label className="text-xs">Unit price</Label>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={line.unitPrice}
                          onChange={(e) =>
                            setServiceLines((prev) =>
                              prev.map((s) =>
                                s.id === line.id
                                  ? { ...s, unitPrice: Number(e.target.value) || 0 }
                                  : s
                              )
                            )
                          }
                        />
                      </div>
                      <div className="flex gap-1 sm:col-span-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          title="Save to my catalog"
                          onClick={() => void saveServiceToCatalog(line)}
                        >
                          <BookmarkPlus className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          title="Remove line"
                          onClick={() =>
                            setServiceLines((prev) => prev.filter((s) => s.id !== line.id))
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="text-right text-sm text-muted-foreground">
                Services ${servicesSubtotal.toFixed(2)}
              </div>
            </section>
          </div>

          <DialogFooter className="gap-2 border-t px-4 py-3 sm:px-6">
            <div className="mr-auto text-sm font-medium">Total ${grandTotal.toFixed(2)}</div>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleGenerate()} disabled={saving}>
              {saving
                ? isCrmDraftMode
                  ? "Saving…"
                  : "Generating…"
                : isCrmDraftMode
                  ? "Save to CRM draft"
                  : "Generate invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={catalogOpen} onOpenChange={setCatalogOpen}>
        <DialogContent className="z-[100] max-h-[min(85dvh,720px)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>My invoice catalog</DialogTitle>
            <DialogDescription>
              Saved additional-service lines for one-click fill. Only you can see this catalog.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-6">
              <Input
                className="sm:col-span-3"
                placeholder="Description"
                value={newCatalogDesc}
                onChange={(e) => setNewCatalogDesc(e.target.value)}
              />
              <Input
                className="sm:col-span-1"
                type="number"
                min={0}
                placeholder="Qty"
                value={newCatalogQty}
                onChange={(e) => setNewCatalogQty(e.target.value)}
              />
              <Input
                className="sm:col-span-1"
                type="number"
                min={0}
                step="0.01"
                placeholder="Price"
                value={newCatalogPrice}
                onChange={(e) => setNewCatalogPrice(e.target.value)}
              />
              <Button type="button" className="sm:col-span-1" onClick={() => void addManualCatalogLine()}>
                Add
              </Button>
            </div>
            {catalog.length === 0 ? (
              <p className="text-sm text-muted-foreground">No saved lines yet.</p>
            ) : (
              <div className="space-y-2">
                {catalog.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-start justify-between gap-2 rounded-md border p-2 text-sm"
                  >
                    <div>
                      <div className="font-medium">{catalogLineLabel(row)}</div>
                      <div className="text-muted-foreground">
                        Qty {Number(row.quantity) || 0} · ${Number(row.unitPrice || 0).toFixed(2)}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={async () => {
                        if (!catalogOwnerUid) return;
                        await deleteInvoiceCatalogLine(catalogOwnerUid, row.id);
                        await reloadCatalog();
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Load shipped docs for a shipment request (by shipmentRequestId). */
export async function loadShippedForRequest(
  clientUserId: string,
  shipmentRequestId: string
): Promise<ShippedItem[]> {
  const snap = await getDocs(
    query(
      collection(db, `users/${clientUserId}/shipped`),
      where("shipmentRequestId", "==", shipmentRequestId)
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ShippedItem, "id">) }));
}
