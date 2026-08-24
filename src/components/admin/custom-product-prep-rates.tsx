"use client";

import { useMemo, useState } from "react";
import { deleteDoc, doc, setDoc, Timestamp } from "firebase/firestore";
import { Boxes, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { useCollection } from "@/hooks/use-collection";
import { db } from "@/lib/firebase";
import { getPricingProfileCollectionPath } from "@/lib/pricing-profiles";
import { isIntegrationInventorySource } from "@/lib/integration-inventory-sources";
import type { InventoryItem, UserProductPrepRate } from "@/types";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Props = {
  profileId: string;
  clientUserId: string;
  clientName: string;
};

type DraftRate = {
  productId: string;
  productName: string;
  sku: string;
  fbaRate: string;
  fbmRate: string;
};

export function CustomProductPrepRatesPanel({ profileId, clientUserId, clientName }: Props) {
  const { toast } = useToast();
  const ratesPath = getPricingProfileCollectionPath(profileId, "productPrepRates");
  const inventoryPath = `users/${clientUserId}/inventory`;

  const { data: rateDocs, loading: ratesLoading } = useCollection<UserProductPrepRate>(ratesPath);
  const { data: inventory, loading: inventoryLoading } = useCollection<InventoryItem>(inventoryPath);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, DraftRate>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const warehouseInventory = useMemo(
    () =>
      (inventory || []).filter(
        (item) =>
          item.status !== "Out of Stock" &&
          !isIntegrationInventorySource((item as { source?: string }).source)
      ),
    [inventory]
  );

  const existingIds = useMemo(
    () => new Set((rateDocs || []).map((r) => String(r.productId || r.id))),
    [rateDocs]
  );

  const rows = useMemo(() => {
    return (rateDocs || [])
      .map((row) => {
        const productId = String(row.productId || row.id);
        const draft = drafts[productId];
        const inv = warehouseInventory.find((i) => i.id === productId);
        return {
          productId,
          productName: draft?.productName || row.productName || inv?.productName || "Product",
          sku: draft?.sku || row.sku || inv?.sku || "",
          fbaRate:
            draft?.fbaRate ??
            (row.fbaRate != null && Number.isFinite(Number(row.fbaRate))
              ? String(row.fbaRate)
              : ""),
          fbmRate:
            draft?.fbmRate ??
            (row.fbmRate != null && Number.isFinite(Number(row.fbmRate))
              ? String(row.fbmRate)
              : ""),
        };
      })
      .sort((a, b) => a.productName.localeCompare(b.productName));
  }, [rateDocs, drafts, warehouseInventory]);

  const pickerItems = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return warehouseInventory
      .filter((item) => !existingIds.has(item.id))
      .filter((item) => {
        if (!q) return true;
        return [item.productName, item.sku, item.retailIdentifier]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q);
      })
      .slice(0, 80);
  }, [warehouseInventory, existingIds, pickerQuery]);

  const updateDraft = (productId: string, patch: Partial<DraftRate>, fallback: DraftRate) => {
    setDrafts((prev) => ({
      ...prev,
      [productId]: {
        ...(prev[productId] || fallback),
        ...patch,
      },
    }));
  };

  const parseOptionalRate = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) throw new Error("Rates must be empty or a valid number ≥ 0.");
    return n;
  };

  const saveRow = async (row: DraftRate) => {
    setSavingId(row.productId);
    try {
      const fbaRate = parseOptionalRate(row.fbaRate);
      const fbmRate = parseOptionalRate(row.fbmRate);
      if (fbaRate == null && fbmRate == null) {
        throw new Error("Enter at least one of FBA or FBM rate.");
      }
      await setDoc(
        doc(db, ratesPath, row.productId),
        {
          productId: row.productId,
          productName: row.productName,
          sku: row.sku || null,
          fbaRate,
          fbmRate,
          updatedAt: Timestamp.now(),
        },
        { merge: true }
      );
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[row.productId];
        return next;
      });
      toast({
        title: "Product rate saved",
        description: `${row.productName} will use these rates instead of profile tiers.`,
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not save",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setSavingId(null);
    }
  };

  const removeRow = async (productId: string, productName: string) => {
    setRemovingId(productId);
    try {
      await deleteDoc(doc(db, ratesPath, productId));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[productId];
        return next;
      });
      toast({
        title: "Override removed",
        description: `${productName} will use the assigned profile rates again.`,
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not remove",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setRemovingId(null);
    }
  };

  const addProduct = async (item: InventoryItem) => {
    try {
      await setDoc(doc(db, ratesPath, item.id), {
        productId: item.id,
        productName: item.productName,
        sku: item.sku || null,
        fbaRate: null,
        fbmRate: null,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      setPickerOpen(false);
      setPickerQuery("");
      toast({
        title: "Product added",
        description: "Enter FBA and/or FBM unit rates, then Save.",
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not add product",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    }
  };

  return (
    <Card className="overflow-hidden rounded-2xl border border-slate-200 bg-white/90 shadow-sm">
      <CardHeader className="border-b bg-gradient-to-r from-amber-50 to-orange-50 pb-3">
        <CardTitle className="flex items-center gap-2 text-xl text-amber-800">
          <Boxes className="h-5 w-5" />
          Product-specific FBA / FBM rates
        </CardTitle>
        <CardDescription className="text-amber-900/80">
          For <span className="font-medium">{clientName}</span> custom profile only. Listed products
          use these flat unit rates; all other products keep the volume-tier rates above.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Leave a rate blank to keep the profile tier for that service.
          </p>
          <Button type="button" size="sm" onClick={() => setPickerOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add product
          </Button>
        </div>

        {ratesLoading || inventoryLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading product rates…
          </p>
        ) : rows.length === 0 ? (
          <p className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            No product overrides yet. Add a warehouse product to give it a different FBA or FBM
            unit price.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="w-[120px]">FBA rate ($)</TableHead>
                  <TableHead className="w-[120px]">FBM rate ($)</TableHead>
                  <TableHead className="w-[160px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const fallback: DraftRate = row;
                  return (
                    <TableRow key={row.productId}>
                      <TableCell>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{row.productName}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            SKU: {row.sku || "—"}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          className="h-8"
                          placeholder="Profile tier"
                          value={row.fbaRate}
                          onChange={(e) =>
                            updateDraft(row.productId, { fbaRate: e.target.value }, fallback)
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          className="h-8"
                          placeholder="Profile tier"
                          value={row.fbmRate}
                          onChange={(e) =>
                            updateDraft(row.productId, { fbmRate: e.target.value }, fallback)
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Button
                            type="button"
                            size="sm"
                            className="h-8"
                            disabled={savingId === row.productId}
                            onClick={() => void saveRow(row)}
                          >
                            {savingId === row.productId ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              "Save"
                            )}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 text-destructive"
                            disabled={removingId === row.productId}
                            onClick={() => void removeRow(row.productId, row.productName)}
                          >
                            {removingId === row.productId ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Add product override</DialogTitle>
              <DialogDescription>
                Choose a warehouse product for {clientName}. Marketplace sync items are excluded.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search product or SKU…"
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                />
              </div>
              <div className="max-h-[320px] space-y-1 overflow-y-auto rounded-md border p-2">
                {pickerItems.length === 0 ? (
                  <p className="p-4 text-center text-sm text-muted-foreground">
                    No matching warehouse products.
                  </p>
                ) : (
                  pickerItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="flex w-full items-start justify-between gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => void addProduct(item)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{item.productName}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          SKU: {item.sku || "—"} · Qty {item.quantity}
                        </span>
                      </span>
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        Add
                      </Badge>
                    </button>
                  ))
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
