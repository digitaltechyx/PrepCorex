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
import { ArrowLeft, Loader2, Package, Save } from "lucide-react";

type SkuRow = { skuId: string; sellerSku: string | null; quantity: number | null };
type ProductRow = {
  productId: string;
  productTitle: string;
  status: string | null;
  skus: SkuRow[];
};

export default function TikTokProductsPage() {
  const searchParams = useSearchParams();
  const connectionId = searchParams.get("connectionId") ?? "";
  const { user } = useAuth();
  const { toast } = useToast();
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [shopName, setShopName] = useState("TikTok Shop");

  const fetchProducts = useCallback(async () => {
    if (!user || !connectionId) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `/api/tiktok/products?connectionId=${encodeURIComponent(connectionId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        throw new Error([data.error, data.detail].filter(Boolean).join(" — ") || "Failed to load products");
      }
      const data = await res.json();
      setProducts(data.products ?? []);
      if (data.shopName) setShopName(data.shopName);
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

  const fetchSelection = useCallback(async () => {
    if (!user || !connectionId) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/integrations/tiktok-connections", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const conn = (data.connections ?? []).find((c: { id: string }) => c.id === connectionId);
      const selected = (conn?.selectedProducts ?? []) as Array<{ skuId: string }>;
      setSelectedIds(new Set(selected.map((s) => s.skuId)));
    } catch {
      // ignore
    }
  }, [user, connectionId]);

  useEffect(() => {
    void fetchProducts();
    void fetchSelection();
  }, [fetchProducts, fetchSelection]);

  const filtered = products.filter((p) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    if (p.productTitle.toLowerCase().includes(q)) return true;
    return p.skus.some(
      (s) => s.sellerSku?.toLowerCase().includes(q) || s.skuId.toLowerCase().includes(q)
    );
  });

  const toggleSku = (skuId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(skuId)) next.delete(skuId);
      else next.add(skuId);
      return next;
    });
  };

  const handleSave = async () => {
    if (!user || !connectionId) return;
    setSaving(true);
    try {
      const selectedProducts: Array<{
        productId: string;
        skuId: string;
        title: string;
        sku?: string;
        quantity?: number;
      }> = [];
      for (const p of products) {
        for (const s of p.skus) {
          if (!selectedIds.has(s.skuId)) continue;
          selectedProducts.push({
            productId: p.productId,
            skuId: s.skuId,
            title: p.skus.length > 1 ? `${p.productTitle} — ${s.sellerSku || s.skuId}` : p.productTitle,
            ...(s.sellerSku ? { sku: s.sellerSku } : {}),
            ...(typeof s.quantity === "number" ? { quantity: s.quantity } : {}),
          });
        }
      }
      const token = await user.getIdToken();
      const res = await fetch("/api/integrations/tiktok-selected-products", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ connectionId, selectedProducts }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save");
      toast({
        title: "Saved",
        description: `${selectedProducts.length} SKU(s) linked to your inventory.`,
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e instanceof Error ? e.message : "Could not save selection.",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!connectionId) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Missing connectionId.</p>
        <Button asChild className="mt-4" variant="outline">
          <Link href="/dashboard/integrations">Back</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard/integrations">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Integrations
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={`/dashboard/tiktok-orders?connectionId=${encodeURIComponent(connectionId)}`}>
            View orders
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Select TikTok products
          </CardTitle>
          <CardDescription>
            Choose SKUs from <strong>{shopName}</strong> that PrepCorex should fulfill and track in inventory.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Input
              placeholder="Search products or SKU…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void handleSave()} disabled={saving || loading}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save selection ({selectedIds.size})
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading products…
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No products found.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {filtered.map((p) => (
                <li key={p.productId} className="p-3 sm:p-4">
                  <p className="font-medium">{p.productTitle}</p>
                  <p className="text-xs text-muted-foreground">{p.status ?? "—"}</p>
                  <div className="mt-2 space-y-2">
                    {p.skus.map((s) => (
                      <label
                        key={s.skuId}
                        className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50"
                      >
                        <Checkbox
                          checked={selectedIds.has(s.skuId)}
                          onCheckedChange={() => toggleSku(s.skuId)}
                        />
                        <span className="text-sm">
                          {s.sellerSku || s.skuId}
                          {s.quantity != null ? (
                            <span className="ml-2 text-muted-foreground">qty {s.quantity}</span>
                          ) : null}
                        </span>
                      </label>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
