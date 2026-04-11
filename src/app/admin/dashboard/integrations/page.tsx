"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { Loader2, Plug, ShoppingBag, ShoppingCart, Trash2, Users } from "lucide-react";

type OverviewUser = {
  uid: string;
  email: string;
  displayName: string;
  clientId: string;
  shopifyCount: number;
  ebayCount: number;
};

type ShopifyRow = {
  id: string;
  shop: string;
  shopName: string;
  connectedAt: { seconds: number } | string | undefined;
};

type EbayRow = {
  id: string;
  connectedAt: { seconds: number } | string | undefined;
  environment: string;
};

function formatConnected(raw: ShopifyRow["connectedAt"]) {
  if (!raw) return "—";
  if (typeof raw === "string") return format(new Date(raw), "PP");
  if (typeof raw === "object" && "seconds" in raw && raw.seconds) {
    return format(new Date(raw.seconds * 1000), "PP");
  }
  return "—";
}

function AdminIntegrationsContent() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  const userIdParam = searchParams.get("userId");

  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewUsers, setOverviewUsers] = useState<OverviewUser[]>([]);
  const [totalWithIntegrations, setTotalWithIntegrations] = useState(0);

  const [selectedUid, setSelectedUid] = useState<string>("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [profile, setProfile] = useState<{ email: string; displayName: string; clientId: string } | null>(
    null
  );
  const [shopifyRows, setShopifyRows] = useState<ShopifyRow[]>([]);
  const [ebayRows, setEbayRows] = useState<EbayRow[]>([]);

  const [usersDialogOpen, setUsersDialogOpen] = useState(false);
  const [shopifyDisconnect, setShopifyDisconnect] = useState<{
    id: string;
    label: string;
  } | null>(null);
  const [removeShopifyInventory, setRemoveShopifyInventory] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const fetchOverview = useCallback(async () => {
    if (!user) return;
    setOverviewLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/admin/integrations/overview", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load overview");
      setTotalWithIntegrations(data.totalUsersWithIntegrations ?? 0);
      setOverviewUsers(data.users ?? []);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not load integrations overview",
        description: e instanceof Error ? e.message : "",
      });
      setOverviewUsers([]);
      setTotalWithIntegrations(0);
    } finally {
      setOverviewLoading(false);
    }
  }, [user, toast]);

  const fetchUserDetails = useCallback(
    async (targetUid: string) => {
      if (!user || !targetUid) {
        setProfile(null);
        setShopifyRows([]);
        setEbayRows([]);
        return;
      }
      setDetailLoading(true);
      try {
        const token = await user.getIdToken();
        const res = await fetch(
          `/api/admin/integrations/user?targetUid=${encodeURIComponent(targetUid)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to load user integrations");
        setProfile(data.profile ?? null);
        setShopifyRows(data.shopify ?? []);
        setEbayRows(data.ebay ?? []);
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Could not load user",
          description: e instanceof Error ? e.message : "",
        });
        setProfile(null);
        setShopifyRows([]);
        setEbayRows([]);
      } finally {
        setDetailLoading(false);
      }
    },
    [user, toast]
  );

  useEffect(() => {
    void fetchOverview();
  }, [fetchOverview]);

  useEffect(() => {
    if (!userIdParam) return;
    setSelectedUid((prev) => (prev === userIdParam ? prev : userIdParam));
  }, [userIdParam]);

  useEffect(() => {
    if (selectedUid) void fetchUserDetails(selectedUid);
    else {
      setProfile(null);
      setShopifyRows([]);
      setEbayRows([]);
    }
  }, [selectedUid, fetchUserDetails]);

  const selectUser = (uid: string) => {
    setSelectedUid(uid);
    router.replace(`/admin/dashboard/integrations?userId=${encodeURIComponent(uid)}`, { scroll: false });
  };

  const runDisconnect = async (platform: "shopify" | "ebay", connectionId: string, removeInv?: boolean) => {
    if (!user) return;
    setDisconnecting(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/admin/integrations/disconnect", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          targetUid: selectedUid,
          connectionId,
          removeInventory: platform === "shopify" ? !!removeInv : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Disconnect failed");
      toast({
        title: "Disconnected",
        description:
          platform === "shopify" && data.removedInventoryCount > 0
            ? `Removed ${data.removedInventoryCount} linked inventory item(s).`
            : `${platform === "shopify" ? "Shopify" : "eBay"} connection removed for this client.`,
      });
      setShopifyDisconnect(null);
      setRemoveShopifyInventory(false);
      await fetchOverview();
      await fetchUserDetails(selectedUid);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Disconnect failed",
        description: e instanceof Error ? e.message : "",
      });
    } finally {
      setDisconnecting(false);
    }
  };

  const userOptions = useMemo(() => overviewUsers, [overviewUsers]);
  const selectedInOverview = useMemo(
    () => userOptions.some((u) => u.uid === selectedUid),
    [userOptions, selectedUid]
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Integrations</h1>
          <p className="mt-1 text-sm text-slate-600">
            View connected Shopify and eBay accounts by client. You can disconnect stores on their behalf.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-auto shrink-0 gap-2 rounded-full border-cyan-200 bg-cyan-50/80 px-4 py-2 text-cyan-900 hover:bg-cyan-100"
          onClick={() => setUsersDialogOpen(true)}
          disabled={overviewLoading || totalWithIntegrations === 0}
        >
          <Users className="h-4 w-4" />
          <span className="font-semibold">{totalWithIntegrations}</span>
          <span className="text-sm font-normal">
            {totalWithIntegrations === 1 ? "user with integrations" : "users with integrations"}
          </span>
        </Button>
      </div>

      <Card className="border-slate-200">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Plug className="h-5 w-5 text-emerald-600" />
            Select client
          </CardTitle>
          <CardDescription>Choose a user to see their connected platforms.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {overviewLoading ? (
            <Skeleton className="h-10 w-full max-w-md" />
          ) : userOptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No clients have connected Shopify or eBay yet.</p>
          ) : (
            <div className="flex max-w-md flex-col gap-2">
              <Label>Client</Label>
              <Select
                value={selectedUid || undefined}
                onValueChange={(v) => selectUser(v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a client…" />
                </SelectTrigger>
                <SelectContent>
                  {selectedUid && !selectedInOverview ? (
                    <SelectItem value={selectedUid}>
                      Selected user (not in current list)
                    </SelectItem>
                  ) : null}
                  {userOptions.map((u) => (
                    <SelectItem key={u.uid} value={u.uid}>
                      {u.displayName}
                      {u.clientId ? ` · ${u.clientId}` : ""}
                      <span className="text-muted-foreground">
                        {" "}
                        ({u.shopifyCount} Shopify · {u.ebayCount} eBay)
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedUid ? (
        <div className="space-y-4">
          {detailLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {profile ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm">
                  <p className="font-semibold text-slate-900">{profile.displayName}</p>
                  <p className="text-slate-600">{profile.email || "—"}</p>
                  {profile.clientId ? (
                    <p className="text-slate-500">Client ID: {profile.clientId}</p>
                  ) : null}
                </div>
              ) : null}

              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <ShoppingBag className="h-4 w-4 text-emerald-600" />
                      Shopify
                    </CardTitle>
                    <CardDescription>Connected stores</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {shopifyRows.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No Shopify stores.</p>
                    ) : (
                      shopifyRows.map((row) => (
                        <div
                          key={row.id}
                          className="flex flex-col gap-2 rounded-lg border border-slate-100 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-900">
                              {row.shopName || row.shop || "Store"}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">{row.shop}</p>
                            <p className="text-xs text-muted-foreground">
                              Connected {formatConnected(row.connectedAt)}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0 text-destructive hover:bg-destructive/10"
                            onClick={() =>
                              setShopifyDisconnect({
                                id: row.id,
                                label: row.shopName || row.shop || "this store",
                              })
                            }
                          >
                            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                            Disconnect
                          </Button>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <ShoppingCart className="h-4 w-4 text-blue-600" />
                      eBay
                    </CardTitle>
                    <CardDescription>Connected accounts</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {ebayRows.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No eBay accounts.</p>
                    ) : (
                      ebayRows.map((row) => (
                        <div
                          key={row.id}
                          className="flex flex-col gap-2 rounded-lg border border-slate-100 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900 capitalize">{row.environment}</p>
                            <p className="text-xs text-muted-foreground">
                              Connected {formatConnected(row.connectedAt)}
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0 text-destructive hover:bg-destructive/10"
                            disabled={disconnecting}
                            onClick={() => void runDisconnect("ebay", row.id)}
                          >
                            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                            Disconnect
                          </Button>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </div>
      ) : null}

      <Dialog open={usersDialogOpen} onOpenChange={setUsersDialogOpen}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Users with integrations</DialogTitle>
            <DialogDescription>
              Clients who have at least one Shopify store or eBay account linked.
            </DialogDescription>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead className="text-center">Shopify</TableHead>
                <TableHead className="text-center">eBay</TableHead>
                <TableHead className="w-[100px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {overviewUsers.map((u) => (
                <TableRow key={u.uid}>
                  <TableCell>
                    <div className="font-medium">{u.displayName}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                    {u.clientId ? (
                      <Badge variant="secondary" className="mt-1 text-[10px]">
                        {u.clientId}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-center">{u.shopifyCount}</TableCell>
                  <TableCell className="text-center">{u.ebayCount}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        selectUser(u.uid);
                        setUsersDialogOpen(false);
                      }}
                    >
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>

      <Dialog open={!!shopifyDisconnect} onOpenChange={(o) => !o && setShopifyDisconnect(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect Shopify</DialogTitle>
            <DialogDescription>
              Remove {shopifyDisconnect?.label} for this client. Order webhooks will stop routing to them.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-2 space-y-0 py-2">
            <Checkbox
              id="rm-inv"
              checked={removeShopifyInventory}
              onCheckedChange={(c) => setRemoveShopifyInventory(c === true)}
            />
            <Label htmlFor="rm-inv" className="text-sm font-normal leading-snug">
              Also remove PrepCorex inventory items imported from this store (same as client disconnect).
            </Label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShopifyDisconnect(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={disconnecting || !shopifyDisconnect}
              onClick={() =>
                shopifyDisconnect &&
                void runDisconnect("shopify", shopifyDisconnect.id, removeShopifyInventory)
              }
            >
              {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Disconnect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AdminIntegrationsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-5xl space-y-6">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      }
    >
      <AdminIntegrationsContent />
    </Suspense>
  );
}
