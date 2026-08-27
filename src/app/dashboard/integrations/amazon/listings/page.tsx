"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, Package, Save } from "lucide-react";

type AmazonListingRow = {
  id: string;
  sellerSku: string;
  marketplaceId: string;
  asin?: string;
  title: string;
  sku?: string;
  status: string;
  quantity?: number;
  fulfillmentChannel?: string;
  imageUrl?: string;
};

export default function AmazonListingsPage() {
  const searchParams = useSearchParams();
  const connectionId = searchParams.get("connectionId")?.trim() || undefined;
  const { user } = useAuth();
  const { toast } = useToast();
  const [listings, setListings] = useState<AmazonListingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadHint, setLoadHint] = useState<string | null>(null);
  const [amazonEnvironment, setAmazonEnvironment] = useState<"sandbox" | "production" | null>(null);
  const [listingCount, setListingCount] = useState<number | null>(null);
  const [marketplaceIds, setMarketplaceIds] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const fetchListings = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(null);
    setLoadHint(null);
    try {
      const token = await user.getIdToken();
      const url = connectionId
        ? `/api/integrations/amazon/listings?connectionId=${encodeURIComponent(connectionId)}`
        : "/api/integrations/amazon/listings";
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (data.error as string) || "Failed to load Amazon listings";
        setLoadError(msg);
        setLoadHint(typeof data.hint === "string" ? data.hint : null);
        setListings([]);
        setAmazonEnvironment(null);
        setListingCount(null);
        setMarketplaceIds([]);
        toast({
          variant: "destructive",
          title: "Error",
          description: msg,
        });
        return;
      }
      setListings(data.listings ?? []);
      setAmazonEnvironment((data.environment as "sandbox" | "production") ?? null);
      setListingCount(typeof data.listingCount === "number" ? data.listingCount : null);
      setMarketplaceIds(Array.isArray(data.marketplaceIds) ? data.marketplaceIds : []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load Amazon listings.";
      setLoadError(msg);
      setListings([]);
      setAmazonEnvironment(null);
      setListingCount(null);
      setMarketplaceIds([]);
      toast({
        variant: "destructive",
        title: "Error",
        description: msg,
      });
    } finally {
      setLoading(false);
    }
  }, [user, toast, connectionId]);

  const fetchSelection = useCallback(async () => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const url = connectionId
        ? `/api/integrations/amazon/selected-listings?connectionId=${encodeURIComponent(connectionId)}`
        : "/api/integrations/amazon/selected-listings";
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const keys = Array.isArray(data.selectedListingKeys)
        ? (data.selectedListingKeys as string[])
        : Array.isArray(data.selectedAsinKeys)
          ? (data.selectedAsinKeys as string[])
          : [];
      setSelectedIds(new Set(keys.filter(Boolean)));
    } catch {
      // ignore
    }
  }, [user, connectionId]);

  useEffect(() => {
    if (user) {
      fetchListings();
      fetchSelection();
    }
  }, [user, fetchListings, fetchSelection]);

  const filtered =
    search.trim()
      ? listings.filter(
          (l) =>
            l.title.toLowerCase().includes(search.toLowerCase()) ||
            l.sellerSku.toLowerCase().includes(search.toLowerCase()) ||
            (l.asin || "").toLowerCase().includes(search.toLowerCase()) ||
            l.marketplaceId.toLowerCase().includes(search.toLowerCase())
        )
      : listings;

  const toggleListing = (id: string) => {
    if (!id) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectable = listings.filter((l) => !!l.id);
  const selectAll = () => setSelectedIds(new Set(filtered.map((l) => l.id).filter(Boolean)));
  const clearAll = () => setSelectedIds(new Set());

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const token = await user.getIdToken();
      const selectedRows = listings.filter((l) => selectedIds.has(l.id));
      const selectedListings = selectedRows.map((l) => ({
        id: l.id,
        sellerSku: l.sellerSku,
        marketplaceId: l.marketplaceId,
        asin: l.asin,
        title: l.title,
        sku: l.sku || l.sellerSku,
        status: l.status,
        quantity: typeof l.quantity === "number" ? l.quantity : undefined,
        fulfillmentChannel: l.fulfillmentChannel,
      }));
      const res = await fetch("/api/integrations/amazon/selected-listings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ selectedListings, connectionId: connectionId || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to save");
      }
      toast({
        title: "Saved",
        description: `${selectedRows.length} listing(s) linked to PrepCorex inventory.`,
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
            Amazon products we fulfill
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Select seller SKUs from your Amazon catalog to link into PrepCorex inventory. Order sync will come in a later step.
          </p>
          {amazonEnvironment && (
            <p className="text-sm mt-2 font-medium">
              Connected to Amazon{" "}
              <span className={amazonEnvironment === "sandbox" ? "text-amber-600" : "text-green-600"}>
                {amazonEnvironment === "sandbox" ? "Sandbox" : "Production"}
              </span>
              {listingCount !== null && (
                <span className="text-muted-foreground font-normal ml-2">
                  ({listingCount} listing{listingCount !== 1 ? "s" : ""} loaded)
                </span>
              )}
              {marketplaceIds.length > 0 && (
                <span className="text-muted-foreground font-normal ml-2">
                  · {marketplaceIds.join(", ")}
                </span>
              )}
            </p>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Select listings</CardTitle>
          <CardDescription>
            Choose which Amazon seller SKUs PrepCorex should track. Linked items appear under Inventory → Other Resources.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading listings from Amazon…
            </div>
          ) : loadError ? (
            <div className="py-6 space-y-3">
              <p className="text-destructive font-medium">{loadError}</p>
              {loadHint && <p className="text-sm text-muted-foreground">{loadHint}</p>}
              <Button variant="outline" onClick={() => fetchListings()}>
                Try again
              </Button>
            </div>
          ) : listings.length === 0 ? (
            <div className="py-6 space-y-3">
              <p className="text-muted-foreground">
                No Amazon listings returned for this seller account and marketplace set.
              </p>
              <p className="text-sm text-muted-foreground">
                Confirm the SP-API app has the Product Listing role, then reconnect Amazon from Integrations if needed.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  placeholder="Search by title, SKU, ASIN, or marketplace…"
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
                  {selectedIds.size} of {selectable.length} selected
                </span>
              </div>
              <div className="border rounded-lg divide-y max-h-[60vh] overflow-y-auto">
                {filtered.map((l) => (
                  <label
                    key={l.id}
                    className="flex items-center gap-3 px-4 py-2 hover:bg-muted/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedIds.has(l.id)}
                      onCheckedChange={() => toggleListing(l.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{l.title || "—"}</p>
                      <p className="text-sm text-muted-foreground">
                        SKU: {l.sellerSku}
                        {l.asin ? ` · ASIN: ${l.asin}` : ""}
                        {" · "}
                        Qty: {typeof l.quantity === "number" ? l.quantity : 0}
                        {" · "}
                        {l.status}
                        {l.fulfillmentChannel ? ` · ${l.fulfillmentChannel}` : ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-xs text-muted-foreground truncate max-w-[100px]">
                      {l.marketplaceId}
                    </div>
                  </label>
                ))}
              </div>
              <div className="flex justify-end">
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
