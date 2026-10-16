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
    <div className="min-w-0 space-y-3 sm:space-y-6">
      <Card className="min-w-0 overflow-hidden rounded-xl border shadow-sm sm:rounded-2xl sm:border-2">
        <CardHeader className="border-b bg-muted/20 p-3 sm:p-6 sm:pb-4">
          <CardTitle className="flex items-center gap-2 text-base sm:gap-3 sm:text-xl">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 sm:h-10 sm:w-10 sm:rounded-xl">
              <MapPin className="h-4 w-4 sm:h-5 sm:w-5" />
            </span>
            Active locations
          </CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            Edit, set default inbound, or remove. New sites: Admin → Warehouses.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-3 pt-3 sm:space-y-5 sm:p-6 sm:pt-4">
          <div className="flex flex-col gap-2 rounded-lg border border-violet-200 bg-violet-50/80 p-3 dark:border-violet-900 dark:bg-violet-950/30 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:rounded-xl sm:border-2 sm:p-4">
            <div className="flex gap-2 sm:gap-3">
              <Warehouse className="mt-0.5 h-4 w-4 shrink-0 text-violet-600 sm:h-5 sm:w-5" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground sm:text-sm">Add a new warehouse site</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground sm:text-sm">
                  Create location, address, and bins under Warehouses.
                </p>
              </div>
            </div>
            <Button asChild size="sm" className="w-full shrink-0 rounded-lg sm:w-auto sm:rounded-xl">
              <Link href="/admin/dashboard/warehouses">Open Warehouses</Link>
            </Button>
          </div>

          {defaultLocationId ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100 sm:rounded-xl sm:px-4 sm:py-3 sm:text-sm">
              Default inbound:{" "}
              <span className="font-semibold">
                {formatWarehouseDisplayName(
                  activeLocations.find((l) => l.id === defaultLocationId)?.name ?? "—"
                )}
              </span>
              . Star a location to change it.
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-amber-300/80 bg-amber-50/50 px-3 py-2 text-xs text-amber-900 sm:rounded-xl sm:px-4 sm:py-3 sm:text-sm">
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

      <Card className="min-w-0 overflow-hidden rounded-xl border shadow-sm sm:rounded-2xl sm:border-2">
        <CardHeader className="border-b bg-muted/20 p-3 sm:p-6 sm:pb-4">
          <CardTitle className="flex items-center gap-2 text-base sm:gap-3 sm:text-xl">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary sm:h-10 sm:w-10 sm:rounded-xl">
              <MapPin className="h-4 w-4 sm:h-5 sm:w-5" />
            </span>
            Assign locations to users
          </CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            Select users and locations, then Assign or Remove.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-3 pt-3 sm:space-y-6 sm:p-6 sm:pt-4">
          {activeLocations.length === 0 ? (
            <p className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/10 py-6 text-center text-xs text-muted-foreground sm:rounded-xl sm:border-2 sm:py-8 sm:text-sm">
              Add at least one location first.
            </p>
          ) : (
            <>
              <div className="grid gap-3 lg:grid-cols-2 lg:gap-6">
                <div className="space-y-1.5 sm:space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs font-semibold sm:text-sm">Users</Label>
                    <span className="text-[10px] text-muted-foreground sm:text-xs">
                      {selectedUserIds.size} sel · {filteredAssignableUsers.length}
                    </span>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-muted/5 sm:rounded-xl sm:border-2">
                    <div className="relative border-b">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Search users…"
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                        className="h-9 rounded-t-lg rounded-b-none border-0 bg-transparent pl-9 pr-3 focus-visible:ring-0 sm:h-10 sm:rounded-t-xl"
                      />
                    </div>
                    <div className="max-h-[240px] space-y-1 overflow-y-auto overscroll-contain p-1.5 sm:max-h-[320px] sm:p-2">
                      {filteredAssignableUsers.length === 0 ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">
                          No users match your search.
                        </p>
                      ) : (
                        filteredAssignableUsers.map((u) => {
                          const checked = selectedUserIds.has(u.uid!);
                          const locCount = normalizeUserLocationIds(u.locations).length;
                          return (
                            <div
                              key={u.uid}
                              role="button"
                              tabIndex={0}
                              onClick={() => toggleUser(u.uid!)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  toggleUser(u.uid!);
                                }
                              }}
                              className={cn(
                                "flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
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
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5 sm:space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs font-semibold sm:text-sm">Locations</Label>
                    <span className="text-[10px] text-muted-foreground sm:text-xs">
                      {selectedLocationIds.size} sel · {filteredLocations.length}
                      {assignedLocationMeta.any.size > 0
                        ? ` · ${assignedLocationMeta.any.size} assigned`
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
                  <div className="rounded-lg border border-border/60 bg-muted/5 sm:rounded-xl sm:border-2">
                    <div className="relative border-b">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Search locations…"
                        value={locationSearch}
                        onChange={(e) => setLocationSearch(e.target.value)}
                        className="h-9 rounded-t-lg rounded-b-none border-0 bg-transparent pl-9 pr-3 focus-visible:ring-0 sm:h-10 sm:rounded-t-xl"
                      />
                    </div>
                    <div className="max-h-[240px] space-y-1 overflow-y-auto overscroll-contain p-1.5 sm:max-h-[320px] sm:p-2">
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
                            <div
                              key={loc.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => toggleLocation(loc.id)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  toggleLocation(loc.id);
                                }
                              }}
                              className={cn(
                                "flex w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
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
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
                <Button
                  onClick={handleAssignLocationsToUsers}
                  disabled={
                    assigning || unassigning || selectedUserIds.size === 0 || selectedLocationIds.size === 0
                  }
                  className="h-9 w-full rounded-lg font-semibold sm:h-11 sm:w-auto sm:rounded-xl sm:px-6"
                >
                  {assigning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  <span className="sm:hidden">Assign to users</span>
                  <span className="hidden sm:inline">Assign locations to selected users</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRemoveLocationsFromUsers}
                  disabled={
                    unassigning || assigning || selectedUserIds.size === 0 || selectedLocationIds.size === 0
                  }
                  className="h-9 w-full rounded-lg border-destructive/40 font-semibold text-destructive hover:bg-destructive/10 sm:h-11 sm:w-auto sm:rounded-xl sm:px-6"
                >
                  {unassigning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  <span className="sm:hidden">Remove from users</span>
                  <span className="hidden sm:inline">Remove selected locations from users</span>
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
        <DialogContent className="flex max-h-[100dvh] w-[calc(100%-1.5rem)] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:max-h-[90vh]">
          <DialogHeader className="shrink-0 border-b p-4 text-left sm:p-6">
            <DialogTitle className="text-base sm:text-lg">Edit location</DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              Update name and address for this warehouse site.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
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
          </div>
          <DialogFooter className="shrink-0 flex-col-reverse gap-2 border-t p-4 sm:flex-row sm:p-6 sm:pt-4">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => {
                setEditingLoc(null);
                setEditForm(null);
              }}
            >
              Cancel
            </Button>
            <Button type="button" className="w-full sm:w-auto" onClick={handleSaveEdit} disabled={savingEdit}>
              {savingEdit ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmRemoveId} onOpenChange={(open) => !open && setConfirmRemoveId(null)}>
        <AlertDialogContent className="w-[calc(100%-1.5rem)] max-w-lg">
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle>Remove location?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs sm:text-sm">
              This will delete the location. Users who had this location will no longer have it. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col-reverse gap-2 sm:flex-row">
            <AlertDialogCancel className="w-full sm:w-auto">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="w-full bg-destructive text-destructive-foreground sm:w-auto"
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
