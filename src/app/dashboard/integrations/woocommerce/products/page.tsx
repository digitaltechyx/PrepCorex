"use client";

import { useCallback, useEffect, useState, Suspense } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, Package, Save } from "lucide-react";

type VariantRow = {
  productId: string;
  productTitle: string;
  variantId: string;
  title: string;
  sku: string | null;
  inventoryQuantity: number | null;
  type: string;
};

type WooSelectedProduct = {
  productId: string;
  variationId?: string | null;
  title: string;
  sku?: string;
};

function WooProductsContent() {
  const searchParams = useSearchParams();
  const connectionId = searchParams.get("connectionId") ?? "";
  const { user } = useAuth();
  const { toast } = useToast();
  const [products, setProducts] = useState<
    Array<{
      productId: string;
      productTitle: string;
      type: string;
      variants: Array<{
        variantId: string;
        title: string;
        sku: string | null;
        inventoryQuantity: number | null;
      }>;
    }>
  >([]);
  const [storeUrl, setStoreUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const selectionKey = (productId: string, variantId: string) => `${productId}:${variantId}`;

  const fetchProducts = useCallback(async () => {
    if (!user || !connectionId) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/integrations/woocommerce/products?connectionId=${encodeURIComponent(connectionId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load products");
      setProducts(data.products ?? []);
      setStoreUrl(data.storeUrl || "");
      const selected = (data.selectedProducts ?? []) as WooSelectedProduct[];
      setSelectedKeys(
        new Set(
          selected.map((s) =>
            selectionKey(s.productId, s.variationId || s.productId)
          )
        )
      );
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e instanceof Error ? e.message : "Failed to load products.",
      });
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [user, connectionId, toast]);

  useEffect(() => {
    if (connectionId && user) void fetchProducts();
  }, [connectionId, user, fetchProducts]);

  const flatVariants: VariantRow[] = products.flatMap((p) =>
    p.variants.map((v) => ({
      productId: p.productId,
      productTitle: p.productTitle,
      variantId: v.variantId,
      title: v.title,
      sku: v.sku,
      inventoryQuantity: v.inventoryQuantity,
      type: p.type,
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

  const toggle = (productId: string, variantId: string) => {
    const key = selectionKey(productId, variantId);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = () =>
    setSelectedKeys(new Set(filtered.map((v) => selectionKey(v.productId, v.variantId))));
  const clearAll = () => setSelectedKeys(new Set());

  const handleSave = async () => {
    if (!user || !connectionId) return;
    setSaving(true);
    try {
      const token = await user.getIdToken();
      const selectedProducts: WooSelectedProduct[] = flatVariants
        .filter((v) => selectedKeys.has(selectionKey(v.productId, v.variantId)))
        .map((v) => ({
          productId: v.productId,
          variationId: v.type === "variable" ? v.variantId : null,
          title:
            v.type === "variable"
              ? `${v.productTitle} - ${v.title}`
              : v.productTitle,
          sku: v.sku ?? undefined,
        }));
      const res = await fetch("/api/integrations/woocommerce-selected-products", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ connectionId, selectedProducts }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save");
      toast({
        title: "Saved",
        description: `${selectedProducts.length} product(s) linked into PrepCorex inventory.`,
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e instanceof Error ? e.message : "Failed to save.",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!connectionId) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/integrations">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Integrations
          </Link>
        </Button>
        <p className="text-sm text-muted-foreground">Missing connectionId.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Button variant="ghost" size="sm" className="mb-2 -ml-2 h-8 px-2" asChild>
            <Link href="/dashboard/integrations">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Integrations
            </Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">WooCommerce products</h1>
          <p className="text-sm text-muted-foreground">
            Select products to sync into PrepCorex inventory
            {storeUrl ? ` · ${storeUrl}` : ""}.
          </p>
        </div>
        <Button onClick={() => void handleSave()} disabled={saving || loading || !user}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save selection
        </Button>
      </div>

      <Card>
        <CardHeader className="gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-lg">Catalog</CardTitle>
            <CardDescription>
              Linked products appear in inventory with source WooCommerce. Stock changes in PrepCorex
              can push back to the store.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="sm:w-[220px]"
            />
            <Button variant="outline" size="sm" onClick={selectAll}>
              Select all
            </Button>
            <Button variant="ghost" size="sm" onClick={clearAll}>
              Clear
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading products…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground">
              <Package className="h-8 w-8 opacity-40" />
              <p className="font-medium">No products found</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((v) => {
                const key = selectionKey(v.productId, v.variantId);
                const checked = selectedKeys.has(key);
                return (
                  <label
                    key={key}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 hover:bg-muted/30"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggle(v.productId, v.variantId)}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {v.productTitle}
                        {v.type === "variable" ? ` · ${v.title}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {[v.sku ? `SKU ${v.sku}` : null, `Stock ${v.inventoryQuantity ?? "—"}`]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function WooCommerceProductsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading…
        </div>
      }
    >
      <WooProductsContent />
    </Suspense>
  );
}
