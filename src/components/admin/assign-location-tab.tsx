"use client";

import { useMemo, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { formatUserDisplayName } from "@/lib/format-user-display";
import { useCollection } from "@/hooks/use-collection";
import { useAuth } from "@/hooks/use-auth";
import { removeLocation, updateLocation } from "@/lib/locations";
import {
  findDefaultWarehouseLocationIdInList,
  setDefaultInboundLocation,
} from "@/lib/default-warehouse";
import { logRolesPermissionsEvent } from "@/lib/roles-permissions-audit";
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
import {
  MapPin,
  Trash2,
  Loader2,
  Search,
  Warehouse,
  Pencil,
  Star,
} from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

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
  isDefaultInbound?: boolean;
};

type EditForm = {
  name: string;
  country: string;
  stateOrProvince: string;
  street1: string;
  street2: string;
  city: string;
  zip: string;
};

export function AssignLocationTab() {
  const { toast } = useToast();
  const { userProfile: adminUser } = useAuth();
  const { data: locationDocs, loading: locationsLoading } = useCollection<LocationDoc>("locations");
  const { data: users } = useCollection<UserProfile>("users");

  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [unassigning, setUnassigning] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [selectedLocationIds, setSelectedLocationIds] = useState<Set<string>>(new Set());
  const [userSearch, setUserSearch] = useState("");
  const [locationSearch, setLocationSearch] = useState("");
  const [editingLoc, setEditingLoc] = useState<LocationType | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const actor = {
    actorUid: adminUser?.uid ?? null,
    actorName: adminUser?.name ?? null,
    actorEmail: adminUser?.email ?? null,
  };

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
              isDefaultInbound: l.isDefaultInbound === true,
            }) as LocationType
        ),
    [locationDocs]
  );

  const defaultLocationId = useMemo(
    () => findDefaultWarehouseLocationIdInList(activeLocations) ?? null,
    [activeLocations]
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
        (u.uid ?? "").toLowerCase().includes(q) ||
        String(u.clientId ?? "").toLowerCase().includes(q)
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
      const hay = `${path} ${pathLegacy} ${formatWarehouseDisplayName(loc.name)}`.toLowerCase();
      return hay.includes(q);
    });
  }, [activeLocations, locationSearch]);

  /** Location ids already on the selected user(s) — shown as Assigned (not the action checkbox). */
  const assignedLocationMeta = useMemo(() => {
    if (selectedUserIds.size === 0) {
      return { any: new Set<string>(), all: new Set<string>(), selectedCount: 0 };
    }
    const selected = users.filter((u) => u.uid && selectedUserIds.has(u.uid));
    const any = new Set<string>();
    const counts = new Map<string, number>();
    for (const u of selected) {
      for (const id of normalizeUserLocationIds(u.locations)) {
        any.add(id);
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    const all = new Set<string>();
    const n = selected.length;
    counts.forEach((count, id) => {
      if (count === n) all.add(id);
    });
    return { any, all, selectedCount: n };
  }, [selectedUserIds, users]);

  const openEdit = (loc: LocationType) => {
    setEditingLoc(loc);
    setEditForm({
      name: loc.name ?? "",
      country: loc.country ?? "",
      stateOrProvince: loc.stateOrProvince ?? "",
      street1: loc.street1 ?? "",
      street2: loc.street2 ?? "",
      city: loc.city ?? "",
      zip: loc.zip ?? "",
    });
  };

  const handleSaveEdit = async () => {
    if (!editingLoc || !editForm) return;
    const name = editForm.name.trim();
    if (!name) {
      toast({ variant: "destructive", title: "Error", description: "Location name is required." });
      return;
    }
    setSavingEdit(true);
    try {
      await updateLocation(editingLoc.id, {
        name,
        country: editForm.country,
        stateOrProvince: editForm.stateOrProvince,
        street1: editForm.street1,
        street2: editForm.street2,
        city: editForm.city,
        zip: editForm.zip,
      });
      void logRolesPermissionsEvent({
        ...actor,
        action: "location_updated",
        description: `Updated location ${formatWarehouseDisplayName(name)}`,
        locationIds: [editingLoc.id],
        locationLabels: [formatWarehouseDisplayName(name)],
        metadata: { previousName: editingLoc.name },
      });
      toast({ title: "Success", description: "Location updated." });
      setEditingLoc(null);
      setEditForm(null);
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: (e as Error).message });
    } finally {
      setSavingEdit(false);
    }
  };

  const handleSetDefault = async (loc: LocationType) => {
    if (loc.isDefaultInbound === true) return;
    setSettingDefaultId(loc.id);
    try {
      await setDefaultInboundLocation(loc.id);
      void logRolesPermissionsEvent({
        ...actor,
        action: "default_location_changed",
        description: `Set default inbound warehouse to ${formatWarehouseDisplayName(loc.name)}`,
        locationIds: [loc.id],
        locationLabels: [formatWarehouseDisplayName(loc.name)],
        metadata: { previousDefaultId: defaultLocationId },
      });
      toast({
        title: "Default location updated",
        description: `${formatWarehouseDisplayName(loc.name)} is now the default inbound warehouse.`,
      });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: (e as Error).message });
    } finally {
      setSettingDefaultId(null);
    }
  };

  const handleRemoveLocation = async (id: string) => {
    setConfirmRemoveId(null);
    const loc = activeLocations.find((l) => l.id === id);
    setRemovingId(id);
    try {
      await removeLocation(id);
      void logRolesPermissionsEvent({
        ...actor,
        action: "location_removed",
        description: `Removed location ${formatWarehouseDisplayName(loc?.name ?? id)}`,
        locationIds: [id],
        locationLabels: [formatWarehouseDisplayName(loc?.name ?? id)],
      });
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
      const targetUserIds = Array.from(selectedUserIds);
      const targetUserLabels = targetUserIds.map((uid) => {
        const u = users.find((row) => row.uid === uid);
        return u ? formatUserDisplayName(u, { showEmail: false }) : uid;
      });
      const locationLabels = locationIds.map((id) => {
        const loc = activeLocations.find((l) => l.id === id);
        return loc ? formatWarehouseDisplayName(loc.name) : id;
      });

      for (const uid of selectedUserIds) {
        const user = users.find((u) => u.uid === uid);
        const current = normalizeUserLocationIds(user?.locations);
        const merged = Array.from(new Set([...current, ...locationIds]));
        await updateDoc(doc(db, "users", uid), { locations: merged });
      }

      void logRolesPermissionsEvent({
        ...actor,
        action: "locations_assigned",
        description: `Assigned ${locationLabels.length} location(s) to ${targetUserIds.length} user(s)`,
        targetUserIds,
        targetUserLabels,
        locationIds,
        locationLabels,
      });

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
      const locationIds = Array.from(selectedLocationIds);
      const locationIdSet = new Set(locationIds);
      const targetUserIds = Array.from(selectedUserIds);
      const targetUserLabels = targetUserIds.map((uid) => {
        const u = users.find((row) => row.uid === uid);
        return u ? formatUserDisplayName(u, { showEmail: false }) : uid;
      });
      const locationLabels = locationIds.map((id) => {
        const loc = activeLocations.find((l) => l.id === id);
        return loc ? formatWarehouseDisplayName(loc.name) : id;
      });

      for (const uid of selectedUserIds) {
        const row = users.find((u) => u.uid === uid);
        const current = normalizeUserLocationIds(row?.locations);
        const next = current.filter((id) => !locationIdSet.has(id));
        await updateDoc(doc(db, "users", uid), { locations: next });
      }

      void logRolesPermissionsEvent({
        ...actor,
        action: "locations_removed_from_users",
        description: `Removed ${locationLabels.length} location(s) from ${targetUserIds.length} user(s)`,
        targetUserIds,
        targetUserLabels,
        locationIds,
        locationLabels,
      });

      setSelectedUserIds(new Set());
      setSelectedLocationIds(new Set());
      toast({ title: "Success", description: "Removed selected locations from the selected users." });
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: (e as Error).message });
    } finally {
      setUnassigning(false);
    }
  };

  const renderLocationChip = (loc: LocationType) => {
    const isDefault = defaultLocationId === loc.id;
    return (
      <div
        key={loc.id}
        className={cn(
          "flex min-w-[220px] max-w-full items-center gap-2 rounded-lg border bg-background px-3 py-2",
          isDefault && "border-amber-400/80 bg-amber-50/60 dark:bg-amber-950/20"
        )}
      >
        <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-sm font-medium text-foreground">
              {formatWarehouseDisplayName(loc.name)}
            </p>
            {isDefault ? (
              <Badge className="bg-amber-500/90 text-[10px] font-semibold text-white hover:bg-amber-500">
                Default
              </Badge>
            ) : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {[loc.street1, loc.street2, loc.city, loc.zip].filter(Boolean).join(", ") ||
              "Address not set"}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 rounded-lg"
          title={isDefault ? (loc.isDefaultInbound ? "Current default" : "Confirm as default") : "Set as default"}
          disabled={loc.isDefaultInbound === true || settingDefaultId === loc.id}
          onClick={() => handleSetDefault(loc)}
        >
          {settingDefaultId === loc.id ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Star
              className={cn("h-4 w-4", isDefault ? "fill-amber-500 text-amber-500" : "text-muted-foreground")}
            />
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 rounded-lg"
          title="Edit location"
          onClick={() => openEdit(loc)}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 rounded-lg text-destructive hover:bg-destructive/10 hover:text-destructive"
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
    );
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
            Edit warehouse details, set the system default inbound location, or remove a site. New warehouses are
            created under Admin → Warehouses.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          <div className="flex flex-col gap-3 rounded-xl border-2 border-violet-200 bg-violet-50/80 p-4 dark:border-violet-900 dark:bg-violet-950/30 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-3">
              <Warehouse className="mt-0.5 h-5 w-5 shrink-0 text-violet-600" />
              <div>
                <p className="text-sm font-medium text-foreground">Add a new warehouse site</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Use Admin → Warehouses to create the location, address, and bin layout in one step.
                </p>
              </div>
            </div>
            <Button asChild className="shrink-0 rounded-xl">
              <Link href="/admin/dashboard/warehouses">Open Warehouses</Link>
            </Button>
          </div>

          {defaultLocationId ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100">
              Default inbound warehouse:{" "}
              <span className="font-semibold">
                {formatWarehouseDisplayName(
                  activeLocations.find((l) => l.id === defaultLocationId)?.name ?? "—"
                )}
              </span>
              . New clients keep this location when roles are saved. Use the star on any location to change it.
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-amber-300/80 bg-amber-50/50 px-4 py-3 text-sm text-amber-900">
              No default inbound warehouse is set. Click the star on a location to choose one.
            </div>
          )}

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
                              {locationsInState.map(renderLocationChip)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
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
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-sm font-semibold">Users</Label>
                    <span className="text-xs text-muted-foreground">
                      {selectedUserIds.size} selected · {filteredAssignableUsers.length} shown
                    </span>
                  </div>
                  <div className="rounded-xl border-2 border-border/60 bg-muted/5">
                    <div className="relative border-b">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Search users..."
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                        className="h-10 rounded-t-xl rounded-b-none border-0 bg-transparent pl-9 pr-3 focus-visible:ring-0"
                      />
                    </div>
                    <div className="max-h-[320px] space-y-1 overflow-y-auto overscroll-contain p-2">
                      {filteredAssignableUsers.length === 0 ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">
                          No users match your search.
                        </p>
                      ) : (
                        filteredAssignableUsers.map((u) => {
                          const checked = selectedUserIds.has(u.uid!);
                          const locCount = normalizeUserLocationIds(u.locations).length;
                          return (
                            <button
                              key={u.uid}
                              type="button"
                              onClick={() => toggleUser(u.uid!)}
                              className={cn(
                                "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
                                checked ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted/60"
                              )}
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={() => toggleUser(u.uid!)}
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`Select ${formatUserDisplayName(u, { showEmail: false })}`}
                              />
                              <span className="min-w-0 flex-1 text-sm font-medium">
                                {formatUserDisplayName(u, { showEmail: false })}
                              </span>
                              {locCount > 0 ? (
                                <Badge variant="secondary" className="shrink-0 font-medium">
                                  {locCount} loc
                                </Badge>
                              ) : null}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-sm font-semibold">Locations to assign</Label>
                    <span className="text-xs text-muted-foreground">
                      {selectedLocationIds.size} selected · {filteredLocations.length} shown
                      {assignedLocationMeta.any.size > 0
                        ? ` · ${assignedLocationMeta.any.size} already assigned`
                        : ""}
                    </span>
                  </div>
                  {selectedUserIds.size > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Green rows / Assigned badge = already on the selected user
                      {selectedUserIds.size > 1 ? "(s)" : ""}. Checkboxes are for assign/remove only.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Select a user to see which locations they already have.
                    </p>
                  )}
                  <div className="rounded-xl border-2 border-border/60 bg-muted/5">
                    <div className="relative border-b">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Search locations..."
                        value={locationSearch}
                        onChange={(e) => setLocationSearch(e.target.value)}
                        className="h-10 rounded-t-xl rounded-b-none border-0 bg-transparent pl-9 pr-3 focus-visible:ring-0"
                      />
                    </div>
                    <div className="max-h-[320px] space-y-1 overflow-y-auto overscroll-contain p-2">
                      {filteredLocations.length === 0 ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">
                          No locations match your search.
                        </p>
                      ) : (
                        filteredLocations.map((loc) => {
                          const checked = selectedLocationIds.has(loc.id);
                          const isDefault = defaultLocationId === loc.id;
                          const isAssigned = assignedLocationMeta.any.has(loc.id);
                          const assignedToAll =
                            assignedLocationMeta.selectedCount > 1 &&
                            assignedLocationMeta.all.has(loc.id);
                          return (
                            <button
                              key={loc.id}
                              type="button"
                              onClick={() => toggleLocation(loc.id)}
                              className={cn(
                                "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
                                checked
                                  ? "bg-primary/10 ring-1 ring-primary/30"
                                  : isAssigned
                                    ? "bg-emerald-50 ring-1 ring-emerald-200/80 dark:bg-emerald-950/30 dark:ring-emerald-800/60"
                                    : "hover:bg-muted/60"
                              )}
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={() => toggleLocation(loc.id)}
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`Select ${locationLabel(loc)}`}
                              />
                              <span className="min-w-0 flex-1 text-sm font-medium">{locationLabel(loc)}</span>
                              {isAssigned ? (
                                <Badge
                                  variant="outline"
                                  className="shrink-0 border-emerald-500/60 bg-emerald-500/10 text-[10px] text-emerald-800 dark:text-emerald-300"
                                >
                                  {assignedLocationMeta.selectedCount > 1
                                    ? assignedToAll
                                      ? "Assigned (all)"
                                      : "Assigned (some)"
                                    : "Assigned"}
                                </Badge>
                              ) : null}
                              {isDefault ? (
                                <Badge
                                  variant="outline"
                                  className="shrink-0 border-amber-400 text-[10px] text-amber-700"
                                >
                                  Default
                                </Badge>
                              ) : null}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={handleAssignLocationsToUsers}
                  disabled={
                    assigning || unassigning || selectedUserIds.size === 0 || selectedLocationIds.size === 0
                  }
                  className="h-11 rounded-xl px-6 font-semibold"
                >
                  {assigning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Assign locations to selected users
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRemoveLocationsFromUsers}
                  disabled={
                    unassigning || assigning || selectedUserIds.size === 0 || selectedLocationIds.size === 0
                  }
                  className="h-11 rounded-xl border-destructive/40 px-6 font-semibold text-destructive hover:bg-destructive/10"
                >
                  {unassigning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Remove selected locations from users
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={!!editingLoc}
        onOpenChange={(open) => {
          if (!open) {
            setEditingLoc(null);
            setEditForm(null);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit location</DialogTitle>
            <DialogDescription>
              Update the display name and address fields for this warehouse site.
            </DialogDescription>
          </DialogHeader>
          {editForm ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="edit-loc-name">Name</Label>
                <Input
                  id="edit-loc-name"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-loc-country">Country</Label>
                <Input
                  id="edit-loc-country"
                  value={editForm.country}
                  onChange={(e) => setEditForm({ ...editForm, country: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-loc-state">State / Province</Label>
                <Input
                  id="edit-loc-state"
                  value={editForm.stateOrProvince}
                  onChange={(e) => setEditForm({ ...editForm, stateOrProvince: e.target.value })}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="edit-loc-street1">Street 1</Label>
                <Input
                  id="edit-loc-street1"
                  value={editForm.street1}
                  onChange={(e) => setEditForm({ ...editForm, street1: e.target.value })}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="edit-loc-street2">Street 2</Label>
                <Input
                  id="edit-loc-street2"
                  value={editForm.street2}
                  onChange={(e) => setEditForm({ ...editForm, street2: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-loc-city">City</Label>
                <Input
                  id="edit-loc-city"
                  value={editForm.city}
                  onChange={(e) => setEditForm({ ...editForm, city: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-loc-zip">ZIP</Label>
                <Input
                  id="edit-loc-zip"
                  value={editForm.zip}
                  onChange={(e) => setEditForm({ ...editForm, zip: e.target.value })}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEditingLoc(null);
                setEditForm(null);
              }}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleSaveEdit} disabled={savingEdit}>
              {savingEdit ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
