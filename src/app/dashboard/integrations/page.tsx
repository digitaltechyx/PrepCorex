"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plug, Loader2, Plus, Trash2, Package, ShoppingBag, ShoppingCart } from "lucide-react";
import { format } from "date-fns";
import Link from "next/link";

const SHOPIFY_SCOPES = "read_orders,read_products,write_products,write_fulfillments,read_inventory,read_locations,write_inventory";

type ShopifySelectedVariant = { variantId: string; productId: string; title: string; sku?: string };

type ShopifyConnectionSummary = {
  id: string;
  shop: string;
  shopName: string;
  connectedAt: { seconds: number; nanoseconds: number } | string;
  selectedVariants?: ShopifySelectedVariant[];
};

type EbayConnectionSummary = {
  id: string;
  connectedAt: { seconds: number; nanoseconds: number } | string;
  environment: string;
  selectedOfferIds?: string[];
};

export default function IntegrationsPage() {
  const { user, userProfile } = useAuth();
  const { toast } = useToast();
  const [shopifyConnections, setShopifyConnections] = useState<ShopifyConnectionSummary[]>([]);
  const [ebayConnections, setEbayConnections] = useState<EbayConnectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [shopInput, setShopInput] = useState("");
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const [pendingDisconnect, setPendingDisconnect] = useState<{ id: string; shopName: string } | null>(null);
  const [ebayDisconnectId, setEbayDisconnectId] = useState<string | null>(null);
  const [ebayConnectLoading, setEbayConnectLoading] = useState(false);

  const fetchConnections = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const [shopifyRes, ebayRes] = await Promise.all([
        fetch("/api/integrations/shopify-connections", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/integrations/ebay-connections", { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (shopifyRes.ok) {
        const data = await shopifyRes.json();
        setShopifyConnections(data.connections ?? []);
      }
      if (ebayRes.ok) {
        const data = await ebayRes.json();
        setEbayConnections(data.connections ?? []);
      }
    } catch {
      setShopifyConnections([]);
      setEbayConnections([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConnections();
  }, [user?.uid]);

  const handleConnectShopify = () => {
    // Normalize: Shopify store subdomains are lowercase, no spaces (use hyphen e.g. my-store)
    let shop = shopInput.trim().toLowerCase().replace(/\.myshopify\.com$/i, "");
    shop = shop.replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""); // spaces -> hyphen, remove invalid chars
    if (!shop) {
      toast({ variant: "destructive", title: "Enter your store name", description: "Use only letters, numbers, or hyphens (e.g. mystore or my-store). No spaces." });
      return;
    }
    const clientId = process.env.NEXT_PUBLIC_SHOPIFY_CLIENT_ID;
    if (!clientId) {
      toast({ variant: "destructive", title: "Configuration error", description: "Shopify app not configured." });
      return;
    }
    const redirectUri = typeof window !== "undefined" ? `${window.location.origin}/dashboard/integrations/shopify/callback` : "";
    const shopDomain = shop.includes(".myshopify.com") ? shop : `${shop}.myshopify.com`;
    const url = `https://${shopDomain}/admin/oauth/authorize?client_id=${encodeURIComponent(clientId)}&scope=${encodeURIComponent(SHOPIFY_SCOPES)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
    setConnectDialogOpen(false);
    setShopInput("");
    window.location.href = url;
  };

  const handleDisconnect = async (id: string, removeInventory: boolean) => {
    if (!user) return;
    setDisconnectingId(id);
    try {
      const token = await user.getIdToken();
      const url = `/api/integrations/shopify-connections?id=${encodeURIComponent(id)}${removeInventory ? "&removeInventory=true" : ""}`;
      const res = await fetch(url, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to disconnect");
      }
      const data = await res.json().catch(() => ({}));
      const removed = (data.removedInventoryCount as number) ?? 0;
      toast({
        title: "Disconnected",
        description: removed > 0
          ? `Shopify store disconnected. ${removed} linked product(s) removed from your inventory.`
          : "Shopify store has been disconnected.",
      });
      setDisconnectDialogOpen(false);
      setPendingDisconnect(null);
      fetchConnections();
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Error", description: err instanceof Error ? err.message : "Could not disconnect." });
    } finally {
      setDisconnectingId(null);
    }
  };

  const openDisconnectDialog = (conn: ShopifyConnectionSummary) => {
    setPendingDisconnect({ id: conn.id, shopName: conn.shopName || conn.shop?.replace(".myshopify.com", "") || "this store" });
    setDisconnectDialogOpen(true);
  };

  const handleConnectEbay = async (addNew?: boolean) => {
    if (!user) return;
    setEbayConnectLoading(true);
    try {
      const token = await user.getIdToken();
      const url = addNew ? "/api/integrations/ebay/authorize-url?addNew=true" : "/api/integrations/ebay/authorize-url";
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ variant: "destructive", title: "eBay", description: data.error || "Could not start connection." });
        return;
      }
      if (data.url) window.location.href = data.url;
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: e instanceof Error ? e.message : "Failed to connect eBay." });
    } finally {
      setEbayConnectLoading(false);
    }
  };

  const handleDisconnectEbay = async (id: string) => {
    if (!user) return;
    setEbayDisconnectId(id);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/integrations/ebay-connections?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to disconnect");
      }
      toast({ title: "Disconnected", description: "eBay account has been disconnected." });
      fetchConnections();
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Error", description: err instanceof Error ? err.message : "Could not disconnect." });
    } finally {
      setEbayDisconnectId(null);
    }
  };

  const formatConnectedAt = (raw: ShopifyConnectionSummary["connectedAt"]) => {
    if (!raw) return "—";
    if (typeof raw === "string") return format(new Date(raw), "PP");
    if (raw.seconds) return format(new Date(raw.seconds * 1000), "PP");
    return "—";
  };

  return (
    <div className="space-y-6">
      <Card className="border-2 shadow-xl overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm">
                <Plug className="h-7 w-7" />
              </div>
              <div>
                <CardTitle className="text-2xl font-bold text-white">Integrations</CardTitle>
                <CardDescription className="text-emerald-100 mt-1">
                  Connect your stores and accounts. Orders and data sync automatically.
                </CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6 space-y-8">
          {/* Shopify */}
          <section>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
              <div>
                <h3 className="text-lg font-semibold">Shopify</h3>
                <p className="text-sm text-muted-foreground">
                  Connect one or more Shopify stores. Orders will sync to PrepCorex and admins can fulfill them here.
                </p>
              </div>
              <Dialog open={connectDialogOpen} onOpenChange={setConnectDialogOpen}>
                <Button onClick={() => setConnectDialogOpen(true)} className="shrink-0">
                  <Plus className="h-4 w-4 mr-2" />
                  {shopifyConnections.length > 0 ? "Connect another store" : "Connect Shopify"}
                </Button>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Connect Shopify store</DialogTitle>
                    <DialogDescription>
                      Enter your store name (the part before .myshopify.com). Use letters, numbers, or hyphens—no spaces.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 pt-2">
                    <div className="space-y-2">
                      <Label>Store name</Label>
                      <Input
                        placeholder="e.g. mystore or my-store"
                        value={shopInput}
                        onChange={(e) => setShopInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleConnectShopify()}
                      />
                      <p className="text-xs text-muted-foreground">
                        From mystore.myshopify.com use: mystore. Use a hyphen for multi-word stores (e.g. psf-testing). Spaces are removed.
                      </p>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" onClick={() => setConnectDialogOpen(false)}>Cancel</Button>
                      <Button onClick={handleConnectShopify}>Continue to Shopify</Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            <Dialog open={disconnectDialogOpen} onOpenChange={(open) => { setDisconnectDialogOpen(open); if (!open) setPendingDisconnect(null); }}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Disconnect Shopify store?</DialogTitle>
                  <DialogDescription>
                    This will remove the connection to {pendingDisconnect?.shopName ?? "this store"}. You can either keep the products that were linked to this store in your PrepCorex inventory, or remove them.
                  </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => pendingDisconnect && handleDisconnect(pendingDisconnect.id, false)}
                    disabled={!pendingDisconnect || disconnectingId === pendingDisconnect.id}
                  >
                    {pendingDisconnect && disconnectingId === pendingDisconnect.id ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Disconnect only (keep linked products in inventory)
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => pendingDisconnect && handleDisconnect(pendingDisconnect.id, true)}
                    disabled={!pendingDisconnect || disconnectingId === pendingDisconnect.id}
                  >
                    Disconnect and remove linked products from inventory
                  </Button>
                  <Button variant="ghost" onClick={() => { setDisconnectDialogOpen(false); setPendingDisconnect(null); }}>
                    Cancel
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            {loading ? (
              <div className="flex items-center gap-2 text-muted-foreground py-6">
                <Loader2 className="h-5 w-5 animate-spin" />
                Loading connected stores…
              </div>
            ) : shopifyConnections.length === 0 ? (
              <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-center">
                <p className="text-sm text-muted-foreground">No Shopify stores connected yet.</p>
                <p className="text-xs text-muted-foreground mt-1">Click “Connect Shopify” to add your first store.</p>
              </div>
            ) : (
              <ul className="space-y-3">
                {shopifyConnections.map((conn) => (
                  <li
                    key={conn.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border bg-card p-4 shadow-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">{conn.shopName || conn.shop}</p>
                      <p className="text-sm text-muted-foreground truncate">{conn.shop}</p>
                      <p className="text-xs text-muted-foreground mt-1">Connected {formatConnectedAt(conn.connectedAt)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 flex-wrap">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/dashboard/integrations/shopify/products?shop=${encodeURIComponent(conn.shop)}`}>
                          <Package className="h-4 w-4 mr-1" />
                          {Array.isArray(conn.selectedVariants) && conn.selectedVariants.length > 0
                            ? `Products (${conn.selectedVariants.length})`
                            : "Manage products"}
                        </Link>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => openDisconnectDialog(conn)}
                        disabled={disconnectingId === conn.id}
                      >
                        {disconnectingId === conn.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
                        Disconnect
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* eBay */}
          <section className="pt-6 border-t">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
              <div>
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <ShoppingBag className="h-5 w-5" />
                  eBay
                </h3>
                <p className="text-sm text-muted-foreground">
                  Connect your eBay seller account. Orders for selected listings will sync to PrepCorex (event-based).
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button onClick={() => handleConnectEbay(ebayConnections.length > 0)} disabled={ebayConnectLoading}>
                  {ebayConnectLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                  {ebayConnections.length > 0 ? "Add another eBay account" : "Connect eBay"}
                </Button>
              </div>
            </div>
            {!loading && ebayConnections.length > 0 ? (
              <ul className="space-y-3">
                {ebayConnections.map((conn) => (
                  <li
                    key={conn.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border bg-card p-4 shadow-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">eBay account</p>
                      <p className="text-xs text-muted-foreground mt-1 capitalize">{conn.environment}</p>
                      <p className="text-xs text-muted-foreground">Connected {formatConnectedAt(conn.connectedAt)}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 flex-wrap">
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/dashboard/integrations/ebay/listings?connectionId=${encodeURIComponent(conn.id)}`}>
                          <Package className="h-4 w-4 mr-1" />
                          {Array.isArray(conn.selectedOfferIds) && conn.selectedOfferIds.length > 0
                            ? `Listings (${conn.selectedOfferIds.length})`
                            : "Manage listings"}
                        </Link>
                      </Button>
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/dashboard/integrations/ebay/orders?connectionId=${encodeURIComponent(conn.id)}`}>
                          <ShoppingCart className="h-4 w-4 mr-1" />
                          Orders
                        </Link>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDisconnectEbay(conn.id)}
                        disabled={ebayDisconnectId === conn.id}
                      >
                        {ebayDisconnectId === conn.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
                        Disconnect
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
            {!loading && ebayConnections.length === 0 && (
              <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-center">
                <p className="text-sm text-muted-foreground">No eBay account connected.</p>
                <p className="text-xs text-muted-foreground mt-1">Click &quot;Connect eBay&quot; to link your seller account (Sandbox or Production).</p>
              </div>
            )}
          </section>

          {/* Placeholder for future integrations */}
          <section className="pt-4 border-t">
            <h3 className="text-lg font-semibold text-muted-foreground">More integrations</h3>
            <p className="text-sm text-muted-foreground mt-1">Amazon and other platforms coming soon.</p>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
