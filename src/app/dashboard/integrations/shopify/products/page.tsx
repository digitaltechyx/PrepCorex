"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, Package, RefreshCw, Save } from "lucide-react";

type VariantRow = {
  variantId: string;
  productId: string;
  productTitle: string;
  title: string;
  sku: string | null;
  inventoryQuantity: number | null;
  inventoryManagement: string | null;
};

type ShopifySelectedVariant = { variantId: string; productId: string; title: string; sku?: string };

export default function ShopifyProductsPage() {
  const searchParams = useSearchParams();
  const shop = searchParams.get("shop") ?? "";
  const { user } = useAuth();
  const { toast } = useToast();
  const [products, setProducts] = useState<{
    productId: string;
    productTitle: string;
    variants: { variantId: string; title: string; sku: string | null; inventoryQuantity: number | null; inventoryManagement: string | null }[];
  }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncingQty, setSyncingQty] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const pullLinkedQuantities = useCallback(
    async (variantIds: string[]) => {
      if (!user || !shop || variantIds.length === 0) return;
      try {
        const token = await user.getIdToken();
        await fetch("/api/shopify/pull-inventory", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ shop, variantIds }),
        });
      } catch {
        // non-fatal — webhook/order sync is primary
      }
    },
    [user, shop]
  );

  const fetchProducts = useCallback(async () => {
    if (!user || !shop) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/shopify/products?shop=${encodeURIComponent(shop)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        const msg = [data.error, data.detail].filter(Boolean).join(" — ") || "Failed to load products";
        throw new Error(msg);
      }
      const data = await res.json();
      setProducts(data.products ?? []);
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: e instanceof Error ? e.message : "Failed to load products." });
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [user, shop, toast]);

  const fetchSelection = useCallback(async () => {
    if (!user) return [] as string[];
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/integrations/shopify-connections", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return [];
      const data = await res.json();
      const shopNorm = shop.includes(".myshopify.com") ? shop : `${shop}.myshopify.com`;
      const conn = (data.connections ?? []).find((c: { shop: string }) => c.shop === shopNorm);
      const variants = (conn?.selectedVariants ?? []) as ShopifySelectedVariant[];
      const ids = variants.map((v) => v.variantId);
      setSelectedIds(new Set(ids));
      return ids;
    } catch {
      return [];
    }
  }, [user, shop]);

  useEffect(() => {
    if (!shop || !user) return;
    let cancelled = false;
    (async () => {
      await fetchProducts();
      const ids = await fetchSelection();
      if (!cancelled && ids.length > 0) {
        await pullLinkedQuantities(ids);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shop, user, fetchProducts, fetchSelection, pullLinkedQuantities]);

  const flatVariants: VariantRow[] = products.flatMap((p) =>
    p.variants.map((v) => ({
      variantId: v.variantId,
      productId: p.productId,
      productTitle: p.productTitle,
      title: v.title,
      sku: v.sku,
      inventoryQuantity: v.inventoryQuantity ?? null,
      inventoryManagement: v.inventoryManagement ?? null,
    }))
  );

  const filtered = search.trim()
    ? flatVariants.filter(
        (v) =>
          v.productTitle.toLowerCase().includes(search.toLowerCase()) ||
          (v.sku && v.sku.toLowerCase().includes(search.toLowerCase())) ||
          v.title.toLowerCase().includes(search.toLowerCase())
      )
    : flatVariants;

  const toggleVariant = (variantId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(variantId)) next.delete(variantId);
      else next.add(variantId);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(filtered.map((v) => v.variantId)));
  const clearAll = () => setSelectedIds(new Set());

  const handleSave = async () => {
    if (!user || !shop) return;
    setSaving(true);
    try {
      const token = await user.getIdToken();
      const selectedVariants: ShopifySelectedVariant[] = flatVariants
        .filter((v) => selectedIds.has(v.variantId))
        .map((v) => ({ variantId: v.variantId, productId: v.productId, title: `${v.productTitle} - ${v.title}`, sku: v.sku ?? undefined }));
      const res = await fetch("/api/integrations/shopify-selected-products", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ shop, selectedVariants }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Failed to save");
      }
      toast({
        title: "Saved",
        description: `${selectedVariants.length} product(s) linked. New items were added with their Shopify quantity; ongoing qty syncs both ways after this.`,
      });
      await fetchProducts();
      await pullLinkedQuantities(selectedVariants.map((v) => v.variantId));
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: e instanceof Error ? e.message : "Failed to save." });
    } finally {
      setSaving(false);
    }
  };

  const handleRefreshInventoryQty = async () => {
    if (!user || !shop || selectedIds.size === 0) return;
    setSyncingQty(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/shopify/pull-inventory", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ shop, variantIds: Array.from(selectedIds) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Failed to refresh");
      }
      toast({
        title: "Inventory updated",
        description: `Pulled Shopify qty into PrepCorex for ${data.updated ?? 0} linked product(s).`,
      });
      await fetchProducts();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Refresh failed",
        description: e instanceof Error ? e.message : "Could not pull quantities.",
      });
    } finally {
      setSyncingQty(false);
    }
  };

  const shopDisplay = shop.replace(".myshopify.com", "") || "Store";

  if (!shop) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/integrations">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Integrations
          </Link>
        </Button>
        <p className="text-muted-foreground">Missing store. Go to Integrations and click &quot;Manage products&quot; for a store.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard/integrations">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Integrations
            </Link>
          </Button>
          <h1 className="text-2xl font-bold mt-2 flex items-center gap-2">
            <Package className="h-7 w-7" />
            Products we fulfill — {shopDisplay}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Select the products/variants you have in your warehouse. PrepCorex will only process orders that contain these items.
          </p>
        </div>
      </div>

      <Card className="border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">After selection — quantities stay in sync</CardTitle>
          <CardDescription>
            Saving selection only adds/links products (new items get their current Shopify qty). After that, qty stays synced both ways: Shopify changes update PrepCorex via webhook; PrepCorex changes (putaway, restock, edit, ship, dispose) update Shopify. You do not need to re-select products after stock changes.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Select products</CardTitle>
          <CardDescription>
            Only orders containing at least one selected variant will be fulfilled through PrepCorex.
            Selection adds products with their actual Shopify quantity. After linking, stock stays synced both ways.
            Out-of-stock items can still be selected (e.g. if you are restocking).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading products from Shopify…
            </div>
          ) : flatVariants.length === 0 ? (
            <p className="text-muted-foreground py-6">No products in this store, or we couldn’t load them.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  placeholder="Search by product name or SKU…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="max-w-sm"
                />
                <Button variant="outline" size="sm" onClick={selectAll}>
                  Select all
                </Button>
                <Button variant="outline" size="sm" onClick={clearAll}>
                  Clear
                </Button>
                <span className="text-sm text-muted-foreground">
                  {selectedIds.size} of {flatVariants.length} selected
                </span>
              </div>
              <div className="border rounded-lg divide-y max-h-[60vh] overflow-y-auto">
                {filtered.map((v) => (
                  <label
                    key={v.variantId}
                    className="flex items-center gap-3 px-4 py-2 hover:bg-muted/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedIds.has(v.variantId)}
                      onCheckedChange={() => toggleVariant(v.variantId)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{v.productTitle}</p>
                      <p className="text-sm text-muted-foreground">
                        {v.title}
                        {v.sku ? ` · ${v.sku}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      {v.inventoryManagement == null || v.inventoryManagement === "" ? (
                        <span className="text-xs text-muted-foreground">Not tracked</span>
                      ) : v.inventoryQuantity !== null && v.inventoryQuantity <= 0 ? (
                        <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Out of stock</span>
                      ) : v.inventoryQuantity !== null ? (
                        <span className="text-xs text-muted-foreground">Qty: {v.inventoryQuantity}</span>
                      ) : null}
                    </div>
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={handleRefreshInventoryQty}
                  disabled={syncingQty || selectedIds.size === 0}
                >
                  {syncingQty ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Refresh inventory qty
                </Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                  Save selection
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
