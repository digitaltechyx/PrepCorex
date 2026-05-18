"use client";

import { useState, useMemo } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { formatUserDisplayName } from "@/lib/format-user-display";
import { useCollection } from "@/hooks/use-collection";
import { removeLocation } from "@/lib/locations";
import Link from "next/link";
import { formatLocationPath } from "@/lib/region-display";
import { formatWarehouseDisplayName } from "@/lib/warehouse-display";
import { normalizeUserLocationIds } from "@/lib/user-locations";
import type { Location as LocationType, UserProfile } from "@/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { MapPin, Trash2, Loader2, Search, Warehouse } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
type LocationDoc = {
  id: string;
  name?: string;
  active?: boolean;
  country?: string;
  stateOrProvince?: string;
  street1?: string;
  street2?: string;
  city?: string;
  zip?: string;
};

export function AssignLocationTab() {
  const { toast } = useToast();
  const { data: locationDocs, loading: locationsLoading } = useCollection<LocationDoc>("locations");
  const { data: users } = useCollection<UserProfile>("users");

  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [unassigning, setUnassigning] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [selectedLocationIds, setSelectedLocationIds] = useState<Set<string>>(new Set());
  const [userSearch, setUserSearch] = useState("");
  const [locationSearch, setLocationSearch] = useState("");

  const activeLocations = useMemo(
    () =>
      locationDocs
        .filter((l) => l.active !== false)
        .map(
          (l) =>
            ({
              id: l.id,
              name: l.name ?? "",
              country: l.country ?? "",
              stateOrProvince: l.stateOrProvince ?? "",
              street1: l.street1 ?? "",
              street2: l.street2 ?? "",
              city: l.city ?? "",
              zip: l.zip ?? "",
              active: true,
            } as LocationType)
        ),
    [locationDocs]
  );

  const countries = useMemo(() => {
    const vals = Array.from(
      new Set(activeLocations.map((loc) => (loc.country || "").trim() || "Uncategorized"))
    );
    return vals.sort((a, b) => a.localeCompare(b));
  }, [activeLocations]);

  const locationLabel = (loc: LocationType) =>
    formatLocationPath(loc.country, loc.stateOrProvince, loc.name);

  const assignableUsers = useMemo(
    () =>
      users
        .filter((u) => u.uid && u.status !== "deleted")
        .sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || "")),
    [users]
  );

  const filteredAssignableUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return assignableUsers;
    return assignableUsers.filter(
      (u) =>
        (u.name ?? "").toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q) ||
        (u.uid ?? "").toLowerCase().includes(q)
    );
  }, [assignableUsers, userSearch]);

  const filteredLocations = useMemo(() => {
    const q = locationSearch.trim().toLowerCase();
    if (!q) return activeLocations;
    return activeLocations.filter((loc) => {
      const country = (loc.country || "").trim();
      const stateOrProvince = (loc.stateOrProvince || "").trim();
      const path = formatLocationPath(loc.country, loc.stateOrProvince, loc.name);
      const pathLegacy =
        country && stateOrProvince
          ? `${country} > ${stateOrProvince} > ${loc.name}`
          : country
            ? `${country} > ${loc.name}`
            : loc.name;
      const hay = `${path} ${pathLegacy}`.toLowerCase();
      return hay.includes(q);
    });
  }, [activeLocations, locationSearch]);

  const handleRemoveLocation = async (id: string) => {
    setConfirmRemoveId(null);
    setRemovingId(id);
    try {
      await removeLocation(id);
      toast({ title: "Success", description: "Location removed." });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: (e as Error).message });
    } finally {
      setRemovingId(null);
    }
  };

  const toggleUser = (uid: string) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const toggleLocation = (id: string) => {
    setSelectedLocationIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAssignLocationsToUsers = async () => {
    if (selectedUserIds.size === 0 || selectedLocationIds.size === 0) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Select at least one user and one location.",
      });
      return;
    }
    setAssigning(true);
    try {
      const locationIds = Array.from(selectedLocationIds);
      for (const uid of selectedUserIds) {
        const user = users.find((u) => u.uid === uid);
        const current = normalizeUserLocationIds(user?.locations);
        const merged = Array.from(new Set([...current, ...locationIds]));
        await updateDoc(doc(db, "users", uid), { locations: merged });
      }
      setSelectedUserIds(new Set());
      setSelectedLocationIds(new Set());
      toast({ title: "Success", description: "Locations assigned to selected users." });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: (e as Error).message });
    } finally {
      setAssigning(false);
    }
  };

  const handleRemoveLocationsFromUsers = async () => {
    if (selectedUserIds.size === 0 || selectedLocationIds.size === 0) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Select at least one user and one location to remove.",
      });
      return;
    }
    setUnassigning(true);
    try {
      const locationIds = new Set(Array.from(selectedLocationIds));
      for (const uid of selectedUserIds) {
        const row = users.find((u) => u.uid === uid);
        const current = normalizeUserLocationIds(row?.locations);
        const next = current.filter((id) => !locationIds.has(id));
        await updateDoc(doc(db, "users", uid), { locations: next });
      }
      setSelectedUserIds(new Set());
      setSelectedLocationIds(new Set());
      toast({ title: "Success", description: "Removed selected locations from the selected users." });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: (e as Error).message });
    } finally {
      setUnassigning(false);
    }
  };

  return (
    <div className="space-y-8">
      <Card className="overflow-hidden rounded-2xl border-2 shadow-sm">
        <CardHeader className="border-b bg-muted/20 pb-6">
          <CardTitle className="flex items-center gap-3 text-xl">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <MapPin className="h-5 w-5" />
            </span>
            Active locations
          </CardTitle>
          <CardDescription className="text-base">
            Locations are created in Warehouses (with address and layout). Here you assign existing locations to users.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          <div className="flex flex-col gap-3 rounded-xl border-2 border-violet-200 bg-violet-50/80 p-4 dark:border-violet-900 dark:bg-violet-950/30 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <Warehouse className="h-5 w-5 shrink-0 text-violet-600 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-foreground">Add a new warehouse site</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Use Admin → Warehouses to create the location, address, and bin layout in one step.
                </p>
              </div>
            </div>
            <Button asChild className="rounded-xl shrink-0">
              <Link href="/admin/dashboard/warehouses">Open Warehouses</Link>
            </Button>
          </div>
          {locationsLoading ? (
            <div className="flex items-center gap-2 rounded-xl border-2 border-dashed border-muted-foreground/30 bg-muted/20 py-6 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading locations…
            </div>
          ) : activeLocations.length === 0 ? (
            <p className="rounded-xl border-2 border-dashed border-muted-foreground/30 bg-muted/10 py-6 text-center text-sm text-muted-foreground">
              No active locations yet. Create one under Admin → Warehouses.
            </p>
          ) : (
            <div className="space-y-4">
              {countries.map((country) => {
                const countryMatch = (locCountry?: string) =>
                  country === "Uncategorized"
                    ? !(locCountry || "").trim()
                    : (locCountry || "").trim() === country;
                const states = Array.from(
                  new Set(
                    activeLocations
                      .filter((loc) => countryMatch(loc.country))
                      .map((loc) => (loc.stateOrProvince || "").trim() || "Unspecified")
                  )
                ).sort((a, b) => a.localeCompare(b));
                return (
                  <div key={country} className="rounded-xl border-2 border-border/60 bg-card p-4">
                    <h4 className="text-sm font-semibold">{country}</h4>
                    <div className="mt-3 space-y-3">
                      {states.map((stateOrProvince) => {
                        const locationsInState = activeLocations.filter(
                          (loc) =>
                            countryMatch(loc.country) &&
                            ((loc.stateOrProvince || "").trim() || "Unspecified") === stateOrProvince
                        );
                        return (
                          <div key={`${country}-${stateOrProvince}`} className="rounded-lg border bg-muted/20 p-3">
                            <p className="text-sm font-medium">{stateOrProvince}</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {locationsInState.map((loc) => (
                                <div
                                  key={loc.id}
                                  className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2"
                                >
                                  <MapPin className="h-4 w-4 text-muted-foreground" />
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium text-foreground">
                                      {formatWarehouseDisplayName(loc.name)}
                                    </p>
                                    <p className="truncate text-xs text-muted-foreground">
                                      {[loc.street1, loc.street2, loc.city, loc.zip].filter(Boolean).join(", ") || "Address not set"}
                                    </p>
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="ml-auto h-7 w-7 rounded-lg text-destructive hover:bg-destructive/10 hover:text-destructive"
                                    onClick={() => setConfirmRemoveId(loc.id)}
                                    disabled={removingId === loc.id}
                                  >
                                    {removingId === loc.id ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-4 w-4" />
                                    )}
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {activeLocations.filter((loc) => !(loc.country || "").trim()).length > 0 && (
                <div className="rounded-xl border-2 border-dashed border-amber-300/80 bg-amber-50 p-3 text-xs text-amber-800">
                  Legacy locations without country/state exist. You can keep using them, or recreate them in the new
                  Country → State/Province → Location structure.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-2xl border-2 shadow-sm">
        <CardHeader className="border-b bg-muted/20 pb-6">
          <CardTitle className="flex items-center gap-3 text-xl">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <MapPin className="h-5 w-5" />
            </span>
            Assign locations to users
          </CardTitle>
          <CardDescription className="text-base">
            Select users and locations. Use Assign to add warehouses to each user&apos;s list, or Remove from users
            to take warehouses away.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
          {activeLocations.length === 0 ? (
            <p className="rounded-xl border-2 border-dashed border-muted-foreground/30 bg-muted/10 py-8 text-center text-sm text-muted-foreground">
              Add at least one location first.
            </p>
          ) : (
            <>
              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Users</Label>
                  <div className="relative rounded-xl border-2 border-border/60 bg-muted/5 overflow-hidden">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <Input
                      placeholder="Search users..."
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      className="h-10 rounded-t-xl rounded-b-none border-0 border-b bg-transparent pl-9 pr-3 focus-visible:ring-0"
                    />
                    <ScrollArea className="h-[180px] p-3">
                      <div className="space-y-3">
                        {filteredAssignableUsers.length === 0 ? (
                          <p className="py-4 text-center text-sm text-muted-foreground">No users match your search.</p>
                        ) : (
                          filteredAssignableUsers.map((u) => (
                            <div key={u.uid} className="flex items-center space-x-3 rounded-lg py-1.5">
                              <Checkbox
                                id={`user-${u.uid}`}
                                checked={selectedUserIds.has(u.uid!)}
                                onCheckedChange={() => toggleUser(u.uid!)}
                              />
                              <label
                                htmlFor={`user-${u.uid}`}
                                className="cursor-pointer text-sm font-medium"
                              >
                                {formatUserDisplayName(u, { showEmail: false })}
                                {normalizeUserLocationIds(u.locations).length > 0 && (
                                  <Badge variant="secondary" className="ml-2 font-medium">
                                    {normalizeUserLocationIds(u.locations).length} loc
                                  </Badge>
                                )}
                              </label>
                            </div>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Locations to assign</Label>
                  <div className="relative rounded-xl border-2 border-border/60 bg-muted/5 overflow-hidden">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <Input
                      placeholder="Search locations..."
                      value={locationSearch}
                      onChange={(e) => setLocationSearch(e.target.value)}
                      className="h-10 rounded-t-xl rounded-b-none border-0 border-b bg-transparent pl-9 pr-3 focus-visible:ring-0"
                    />
                    <ScrollArea className="h-[180px] p-3">
                      <div className="space-y-3">
                        {filteredLocations.length === 0 ? (
                          <p className="py-4 text-center text-sm text-muted-foreground">No locations match your search.</p>
                        ) : (
                          filteredLocations.map((loc) => (
                            <div key={loc.id} className="flex items-center space-x-3 rounded-lg py-1.5">
                              <Checkbox
                                id={`loc-${loc.id}`}
                                checked={selectedLocationIds.has(loc.id)}
                                onCheckedChange={() => toggleLocation(loc.id)}
                              />
                              <label htmlFor={`loc-${loc.id}`} className="cursor-pointer text-sm font-medium">
                                {locationLabel(loc)}
                              </label>
                            </div>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={handleAssignLocationsToUsers}
                  disabled={assigning || unassigning || selectedUserIds.size === 0 || selectedLocationIds.size === 0}
                  className="rounded-xl h-11 px-6 font-semibold"
                >
                  {assigning ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Assign locations to selected users
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRemoveLocationsFromUsers}
                  disabled={unassigning || assigning || selectedUserIds.size === 0 || selectedLocationIds.size === 0}
                  className="rounded-xl h-11 px-6 font-semibold border-destructive/40 text-destructive hover:bg-destructive/10"
                >
                  {unassigning ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Remove selected locations from users
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!confirmRemoveId} onOpenChange={(open) => !open && setConfirmRemoveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove location?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete the location. Users who had this location will no longer have it. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => confirmRemoveId && handleRemoveLocation(confirmRemoveId)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
