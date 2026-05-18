"use client";

import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Location } from "@/types";

export type WarehouseLocationFormValues = {
  locationName: string;
  country: string;
  newCountryName: string;
  selectedCountry: string;
  stateOrProvince: string;
  newStateOrProvinceName: string;
  selectedStateOrProvince: string;
  street1: string;
  street2: string;
  city: string;
  zip: string;
};

export const emptyWarehouseLocationForm = (): WarehouseLocationFormValues => ({
  locationName: "",
  country: "",
  newCountryName: "",
  selectedCountry: "",
  stateOrProvince: "",
  newStateOrProvinceName: "",
  selectedStateOrProvince: "",
  street1: "",
  street2: "",
  city: "",
  zip: "",
});

export function locationToFormValues(loc: Location): WarehouseLocationFormValues {
  const country = (loc.country || "").trim();
  const state = (loc.stateOrProvince || "").trim();
  return {
    locationName: loc.name || "",
    selectedCountry: country || "",
    newCountryName: "",
    country: country,
    selectedStateOrProvince: state || "",
    newStateOrProvinceName: "",
    stateOrProvince: state,
    street1: loc.street1 || "",
    street2: loc.street2 || "",
    city: loc.city || "",
    zip: loc.zip || "",
  };
}

export function resolveCountryFromForm(f: WarehouseLocationFormValues): string {
  return (f.selectedCountry === "__new__" ? f.newCountryName : f.selectedCountry).trim();
}

export function resolveStateFromForm(f: WarehouseLocationFormValues): string {
  return (f.selectedStateOrProvince === "__new__" ? f.newStateOrProvinceName : f.selectedStateOrProvince).trim();
}

export function validateWarehouseLocationForm(f: WarehouseLocationFormValues): string | null {
  if (!f.locationName.trim()) return "Enter a location name.";
  const country = resolveCountryFromForm(f);
  if (!country) return "Select or enter a country.";
  const state = resolveStateFromForm(f);
  if (!state) return "Select or enter a state or province.";
  if (!f.street1.trim()) return "Enter street address.";
  if (!f.city.trim()) return "Enter city.";
  if (!f.zip.trim()) return "Enter zip or postal code.";
  return null;
}

export function warehouseLocationFormToPayload(f: WarehouseLocationFormValues) {
  return {
    name: f.locationName.trim(),
    country: resolveCountryFromForm(f),
    stateOrProvince: resolveStateFromForm(f),
    street1: f.street1.trim(),
    street2: f.street2.trim(),
    city: f.city.trim(),
    zip: f.zip.trim(),
  };
}

type Props = {
  values: WarehouseLocationFormValues;
  onChange: (next: WarehouseLocationFormValues) => void;
  existingLocations: Location[];
  disabled?: boolean;
  /** When true, location name field is hidden (editing linked location by id only). */
  hideLocationName?: boolean;
};

export function WarehouseLocationAddressFields({
  values,
  onChange,
  existingLocations,
  disabled,
  hideLocationName,
}: Props) {
  const countries = useMemo(() => {
    const vals = new Set<string>(["United States"]);
    for (const loc of existingLocations) {
      const c = (loc.country || "").trim();
      if (c) vals.add(c);
    }
    return Array.from(vals).sort((a, b) => a.localeCompare(b));
  }, [existingLocations]);

  const resolvedCountry = resolveCountryFromForm(values);

  const statesOrProvinces = useMemo(() => {
    if (!resolvedCountry) return [] as string[];
    const vals = new Set<string>();
    for (const loc of existingLocations) {
      if ((loc.country || "").trim().toLowerCase() !== resolvedCountry.toLowerCase()) continue;
      const s = (loc.stateOrProvince || "").trim();
      if (s) vals.add(s);
    }
    if (resolvedCountry.toLowerCase() === "united states") {
      vals.add("New Jersey");
    }
    return Array.from(vals).sort((a, b) => a.localeCompare(b));
  }, [existingLocations, resolvedCountry]);

  const patch = (partial: Partial<WarehouseLocationFormValues>) => onChange({ ...values, ...partial });

  return (
    <div className="space-y-3">
      {!hideLocationName ? (
        <div className="space-y-2">
          <Label>Location name</Label>
          <Input
            value={values.locationName}
            onChange={(e) => patch({ locationName: e.target.value })}
            placeholder="e.g. NJ1, NJ2, New Jersey Edison"
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">
            Shown to clients and used when assigning users to this warehouse.
          </p>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Country</Label>
          <Select
            value={values.selectedCountry || undefined}
            onValueChange={(v) =>
              patch({
                selectedCountry: v,
                selectedStateOrProvince: "",
                newStateOrProvinceName: "",
              })
            }
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select country" />
            </SelectTrigger>
            <SelectContent>
              {countries.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
              <SelectItem value="__new__">+ Add new country</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {values.selectedCountry === "__new__" ? (
          <div className="space-y-2">
            <Label>New country</Label>
            <Input
              value={values.newCountryName}
              onChange={(e) => patch({ newCountryName: e.target.value })}
              disabled={disabled}
            />
          </div>
        ) : (
          <div className="space-y-2">
            <Label>State / province</Label>
            <Select
              value={values.selectedStateOrProvince || undefined}
              onValueChange={(v) => patch({ selectedStateOrProvince: v })}
              disabled={disabled || !resolvedCountry}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select state" />
              </SelectTrigger>
              <SelectContent>
                {statesOrProvinces.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
                <SelectItem value="__new__">+ Add new state</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {values.selectedStateOrProvince === "__new__" ? (
        <div className="space-y-2">
          <Label>New state / province</Label>
          <Input
            value={values.newStateOrProvinceName}
            onChange={(e) => patch({ newStateOrProvinceName: e.target.value })}
            disabled={disabled}
          />
        </div>
      ) : null}

      <div className="space-y-2">
        <Label>Street address</Label>
        <Input
          value={values.street1}
          onChange={(e) => patch({ street1: e.target.value })}
          placeholder="Street line 1"
          disabled={disabled}
        />
      </div>
      <div className="space-y-2">
        <Label>Street line 2 (optional)</Label>
        <Input
          value={values.street2}
          onChange={(e) => patch({ street2: e.target.value })}
          disabled={disabled}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>City</Label>
          <Input value={values.city} onChange={(e) => patch({ city: e.target.value })} disabled={disabled} />
        </div>
        <div className="space-y-2">
          <Label>Zip / postal</Label>
          <Input value={values.zip} onChange={(e) => patch({ zip: e.target.value })} disabled={disabled} />
        </div>
      </div>
    </div>
  );
}
