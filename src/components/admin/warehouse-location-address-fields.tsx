"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Location } from "@/types";
import {
  WAREHOUSE_COUNTRIES,
  normalizeRegionName,
  normalizeWarehouseCountry,
  regionOptionsForCountry,
  type RegionOption,
} from "@/lib/region-display";

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
  const country = normalizeWarehouseCountry(loc.country) || (loc.country || "").trim();
  const state = normalizeRegionName(country, loc.stateOrProvince);
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
  return normalizeWarehouseCountry(f.selectedCountry) || f.selectedCountry.trim();
}

export function resolveStateFromForm(f: WarehouseLocationFormValues): string {
  return normalizeRegionName(resolveCountryFromForm(f), f.selectedStateOrProvince);
}

export function validateWarehouseLocationForm(f: WarehouseLocationFormValues): string | null {
  if (!f.locationName.trim()) return "Enter a location name.";
  const country = resolveCountryFromForm(f);
  if (!country || !normalizeWarehouseCountry(country)) {
    return "Select United States or Canada.";
  }
  const state = resolveStateFromForm(f);
  if (!state) return "Select a state or province.";
  const options = regionOptionsForCountry(country);
  const known = options.some(
    (o) => o.name.toLowerCase() === state.toLowerCase() || o.code === state.toUpperCase()
  );
  if (!known) return "Select a valid state or province from the list.";
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

function RegionCombobox({
  options,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  options: RegionOption[];
  value: string;
  onChange: (name: string) => void;
  disabled?: boolean;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const selected = useMemo(
    () => options.find((o) => o.name === value || o.code === value.toUpperCase()) ?? null,
    [options, value]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        o.code.toLowerCase().includes(q)
    );
  }, [options, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? `${selected.name} (${selected.code})` : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <div className="p-2 border-b">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or code…"
            className="h-8"
            autoFocus
          />
        </div>
        <div className="max-h-60 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">No match.</p>
          ) : (
            filtered.map((o) => {
              const isSelected = selected?.code === o.code;
              return (
                <button
                  key={o.code}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm",
                    "hover:bg-accent hover:text-accent-foreground",
                    isSelected && "bg-accent/60"
                  )}
                  onClick={() => {
                    onChange(o.name);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("h-4 w-4 shrink-0", isSelected ? "opacity-100" : "opacity-0")} />
                  <span className="flex-1 truncate">{o.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{o.code}</span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
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
  existingLocations: _existingLocations,
  disabled,
  hideLocationName,
}: Props) {
  void _existingLocations;

  const resolvedCountry = resolveCountryFromForm(values);
  const regionOptions = useMemo(
    () => regionOptionsForCountry(resolvedCountry),
    [resolvedCountry]
  );

  const patch = (partial: Partial<WarehouseLocationFormValues>) => onChange({ ...values, ...partial });

  return (
    <div className="space-y-3">
      {!hideLocationName ? (
        <div className="space-y-2">
          <Label>Location name</Label>
          <Input
            value={values.locationName}
            onChange={(e) => patch({ locationName: e.target.value })}
            placeholder="e.g. NY-01, NJ-02"
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
            value={normalizeWarehouseCountry(values.selectedCountry) || undefined}
            onValueChange={(v) =>
              patch({
                selectedCountry: v,
                country: v,
                selectedStateOrProvince: "",
                newStateOrProvinceName: "",
                newCountryName: "",
              })
            }
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select country" />
            </SelectTrigger>
            <SelectContent>
              {WAREHOUSE_COUNTRIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>{resolvedCountry === "Canada" ? "Province / territory" : "State"}</Label>
          <RegionCombobox
            options={regionOptions}
            value={values.selectedStateOrProvince}
            onChange={(name) =>
              patch({
                selectedStateOrProvince: name,
                stateOrProvince: name,
                newStateOrProvinceName: "",
              })
            }
            disabled={disabled || !resolvedCountry}
            placeholder={
              resolvedCountry === "Canada"
                ? "Search province…"
                : resolvedCountry
                  ? "Search state…"
                  : "Select country first"
            }
          />
        </div>
      </div>

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
