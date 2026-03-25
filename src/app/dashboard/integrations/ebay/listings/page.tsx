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

type EbayListingRow = {
  offerId: string;
  sku: string;
  title: string;
  status: string;
  quantity?: number;
  listingId?: string;
  source?: "inventory" | "trading";
};

function getSelectionKey(listing: EbayListingRow): string {
  return listing.offerId || listing.listingId || "";
}

export default function EbayListingsPage() {
  const searchParams = useSearchParams();
  const connectionId = searchParams.get("connectionId")?.trim() || undefined;
  const { user } = useAuth();
  const { toast } = useToast();
  const [listings, setListings] = useState<EbayListingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ebayEnvironment, setEbayEnvironment] = useState<"sandbox" | "production" | null>(null);
  const [inventoryItemCount, setInventoryItemCount] = useState<number | null>(null);
  const [ebayReportedTotal, setEbayReportedTotal] = useState<number | null>(null);
  const [tradingActiveCount, setTradingActiveCount] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const fetchListings = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(null);
    try {
      const token = await user.getIdToken();
      const url = connectionId
        ? `/api/integrations/ebay/listings?connectionId=${encodeURIComponent(connectionId)}`
        : "/api/integrations/ebay/listings";
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (data.error as string) || "Failed to load listings";
        setLoadError(msg);
        setListings([]);
        setEbayEnvironment(null);
        setInventoryItemCount(null);
        setEbayReportedTotal(null);
        setTradingActiveCount(null);
        toast({
          variant: "destructive",
          title: "Error",
          description: msg,
        });
        return;
      }
      setListings(data.listings ?? []);
      setEbayEnvironment((data.environment as "sandbox" | "production") ?? null);
      setInventoryItemCount(typeof data.inventoryItemCount === "number" ? data.inventoryItemCount : null);
      setEbayReportedTotal(typeof data.ebayReportedTotal === "number" ? data.ebayReportedTotal : null);
      setTradingActiveCount(typeof data.tradingActiveCount === "number" ? data.tradingActiveCount : null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load eBay listings.";
      setLoadError(msg);
      setListings([]);
      setEbayEnvironment(null);
      setInventoryItemCount(null);
      setEbayReportedTotal(null);
      setTradingActiveCount(null);
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
        ? `/api/integrations/ebay/selected-listings?connectionId=${encodeURIComponent(connectionId)}`
        : "/api/integrations/ebay/selected-listings";
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const offerIds = Array.isArray(data.selectedOfferIds) ? (data.selectedOfferIds as string[]) : [];
      const listingIds = Array.isArray(data.selectedListingIds) ? (data.selectedListingIds as string[]) : [];
      setSelectedIds(new Set([...offerIds, ...listingIds].filter(Boolean)));
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
            l.sku.toLowerCase().includes(search.toLowerCase()) ||
            l.offerId.toLowerCase().includes(search.toLowerCase()) ||
            (l.listingId || "").toLowerCase().includes(search.toLowerCase())
        )
      : listings;

  const toggleListing = (selectionKey: string) => {
    if (!selectionKey) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(selectionKey)) next.delete(selectionKey);
      else next.add(selectionKey);
      return next;
    });
  };

  const selectable = listings.filter((l) => !!getSelectionKey(l));
  const tradingOnlyCount = listings.filter((l) => !l.offerId).length;
  const selectAll = () =>
    setSelectedIds(new Set(filtered.map((l) => getSelectionKey(l)).filter(Boolean)));
  const clearAll = () => setSelectedIds(new Set());

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const token = await user.getIdToken();
      const selectedRows = listings.filter((l) => selectedIds.has(getSelectionKey(l)));
      const offerIds = Array.from(new Set(selectedRows.map((l) => l.offerId).filter(Boolean)));
      const listingIds = Array.from(new Set(selectedRows.map((l) => l.listingId).filter(Boolean)));
      const selectedListings = selectedRows.map((l) => ({
        id: getSelectionKey(l),
        offerId: l.offerId || undefined,
        listingId: l.listingId || undefined,
        title: l.title || undefined,
        sku: l.sku || undefined,
        status: l.status || undefined,
        quantity: typeof l.quantity === "number" ? l.quantity : undefined,
        source: l.source || "inventory",
      }));
      const res = await fetch("/api/integrations/ebay/selected-listings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ offerIds, listingIds, selectedListings, connectionId: connectionId || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to save");
      }
      toast({
        title: "Saved",
        description: `${selectedRows.length} listing(s) selected. Only orders for these will sync to PrepCorex.`,
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
            eBay listings we fulfill
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Select the listings you fulfill through PrepCorex. Only orders containing at least one of these will sync to PrepCorex.
          </p>
          {ebayEnvironment && (
            <p className="text-sm mt-2 font-medium">
              Connected to eBay{" "}
              <span className={ebayEnvironment === "sandbox" ? "text-amber-600" : "text-green-600"}>
                {ebayEnvironment === "sandbox" ? "Sandbox" : "Production"}
              </span>
              {inventoryItemCount !== null && (
                <span className="text-muted-foreground font-normal ml-2">
                  ({inventoryItemCount} inventory item{inventoryItemCount !== 1 ? "s" : ""} from eBay)
                </span>
              )}
              {tradingActiveCount !== null && (
                <span className="text-muted-foreground font-normal ml-2">
                  ({tradingActiveCount} active listing{tradingActiveCount !== 1 ? "s" : ""} from Seller Hub)
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
            Choose which eBay listings are fulfilled by PrepCorex. Order sync (when enabled) will only include orders for these listings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading listings from eBay…
            </div>
          ) : loadError ? (
            <div className="py-6 space-y-3">
              <p className="text-destructive font-medium">{loadError}</p>
              <p className="text-sm text-muted-foreground">
                Make sure your eBay app has Inventory and Fulfillment permissions, and that you connected using the same environment (Sandbox or Production) where your listings exist.
              </p>
              <Button variant="outline" onClick={() => fetchListings()}>
                Try again
              </Button>
            </div>
          ) : listings.length === 0 ? (
            <div className="py-6 space-y-3">
              <p className="text-muted-foreground">
                {inventoryItemCount === 0
                  ? ebayReportedTotal != null && ebayReportedTotal > 0
                    ? `eBay Inventory API reports ${ebayReportedTotal} item(s) but none could be loaded for this connection.`
                    : "eBay returned 0 inventory items for this connection."
                  : inventoryItemCount != null && inventoryItemCount > 0
                    ? `${inventoryItemCount} inventory item(s) found but no published offers. Publish offers in Seller Hub to see them here.`
                    : "No listings found, or your eBay account has no inventory items/offers."}
              </p>
              <p className="text-sm text-muted-foreground border-l-4 border-slate-300 dark:border-slate-600 pl-3 py-1">
                <strong>Why don’t I see my Seller Hub “Active” listings?</strong> Seller Hub’s “Manage active listings” can
                include items created with <strong>Create listing</strong> or legacy tools. PrepCorex only shows items that exist in
                eBay’s <strong>Inventory API</strong>. If you have many active listings in Seller Hub but 0 here, those
                listings were likely created outside the Inventory API. To have them in PrepCorex, create or migrate listings using
                an eBay app or flow that uses the Inventory API (same eBay account and environment).
              </p>
              {ebayEnvironment && (
                <p className="text-sm text-muted-foreground border-l-4 border-amber-500 pl-3 py-1">
                  You're connected to <strong>{ebayEnvironment === "sandbox" ? "Sandbox" : "Production"}</strong>. Your
                  listings must be in this same environment. If they're on live eBay, connect with Production (EBAY_SANDBOX=false
                  and Production app keys). If they're test listings, use Sandbox (EBAY_SANDBOX=true and SBX keys). Disconnect
                  in Integrations and reconnect with the correct environment.
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                Connect eBay in Integrations and ensure you have inventory items and published offers in the Inventory API.
              </p>
            </div>
          ) : (
            <>
              {tradingOnlyCount > 0 && (
                <p className="text-sm text-muted-foreground border-l-4 border-blue-500 pl-3 py-1">
                  Showing {tradingOnlyCount} active Seller Hub listing{tradingOnlyCount !== 1 ? "s" : ""} that are not in
                  Inventory API. These are selectable and included in order sync.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  placeholder="Search by title, SKU, or offer ID…"
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
                {filtered.map((l) => {
                  const selectionKey = getSelectionKey(l);
                  return (
                    <label
                      key={l.offerId || l.listingId || l.sku}
                      className="flex items-center gap-3 px-4 py-2 hover:bg-muted/50 cursor-pointer"
                    >
                      <Checkbox
                        disabled={!selectionKey}
                        checked={selectedIds.has(selectionKey)}
                        onCheckedChange={() => toggleListing(selectionKey)}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{l.title || "—"}</p>
                        <p className="text-sm text-muted-foreground">
                          SKU: {l.sku} · Qty: {typeof l.quantity === "number" ? l.quantity : 0} · {l.status}
                          {l.source === "trading" ? " · Seller Hub" : ""}
                        </p>
                      </div>
                      <div className="shrink-0 text-xs text-muted-foreground truncate max-w-[120px]">
                        {l.offerId || l.listingId}
                      </div>
                    </label>
                  );
                })}
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
