"use client";

import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { UserProfile } from "@/types";

export function formatClientOptionLabel(client: UserProfile): string {
  const name = client.name || client.email || client.uid;
  return client.clientId ? `${name} (${client.clientId})` : name;
}

type Props = {
  clients: UserProfile[];
  clientId: string;
  clientLabel: string;
  onChange: (next: { clientId: string; clientLabel: string }) => void;
  disabled?: boolean;
};

function ClientOptionButton({
  selected,
  onPick,
  children,
  className,
}: {
  selected?: boolean;
  onPick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm",
        "cursor-pointer touch-manipulation",
        "hover:bg-accent hover:text-accent-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        "active:bg-accent/80",
        className
      )}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onPick();
      }}
    >
      {children}
    </button>
  );
}

export function CrossdockClientCombobox({
  clients,
  clientId,
  clientLabel,
  onChange,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(clientLabel);

  useEffect(() => {
    setQuery(clientLabel);
  }, [clientLabel]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => {
      const label = formatClientOptionLabel(c).toLowerCase();
      const email = (c.email ?? "").toLowerCase();
      const cid = (c.clientId ?? "").toLowerCase();
      return label.includes(q) || email.includes(q) || cid.includes(q);
    });
  }, [clients, query]);

  const trimmedQuery = query.trim();
  const exactMatch = useMemo(() => {
    if (!trimmedQuery) return false;
    const t = trimmedQuery.toLowerCase();
    return clients.some(
      (c) =>
        formatClientOptionLabel(c).toLowerCase() === t ||
        (c.name ?? "").toLowerCase() === t ||
        (c.email ?? "").toLowerCase() === t
    );
  }, [clients, trimmedQuery]);

  function pickClient(c: UserProfile) {
    const label = formatClientOptionLabel(c);
    onChange({ clientId: c.uid, clientLabel: label });
    setQuery(label);
    setOpen(false);
  }

  function useTypedName() {
    if (!trimmedQuery) return;
    onChange({ clientId: "", clientLabel: trimmedQuery });
    setOpen(false);
  }

  function handleSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (filtered.length === 1) {
      pickClient(filtered[0]);
      return;
    }
    if (trimmedQuery && !exactMatch) {
      useTypedName();
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal h-10",
            !clientLabel && "text-muted-foreground"
          )}
        >
          <span className="truncate text-left">
            {clientLabel || "Optional — search or type client…"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-center border-b px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search client or type new name…"
            className="h-10 border-0 shadow-none focus-visible:ring-0"
            autoFocus
          />
        </div>
        <div
          className="max-h-[280px] overflow-y-auto overscroll-contain p-1"
          role="listbox"
        >
          {filtered.length === 0 && !trimmedQuery ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">No clients in the system.</p>
          ) : null}
          {filtered.length > 0 ? (
            <div className="py-1">
              <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
                Clients in system
              </p>
              {filtered.map((c) => (
                <ClientOptionButton
                  key={c.uid}
                  selected={clientId === c.uid}
                  onPick={() => pickClient(c)}
                >
                  <Check
                    className={cn(
                      "h-4 w-4 shrink-0",
                      clientId === c.uid ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="truncate">{formatClientOptionLabel(c)}</span>
                </ClientOptionButton>
              ))}
            </div>
          ) : trimmedQuery ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">
              No match — use custom name below.
            </p>
          ) : null}
          {trimmedQuery && !exactMatch ? (
            <ClientOptionButton
              onPick={useTypedName}
              className="text-indigo-700 font-medium border-t mt-1 pt-2"
            >
              <span className="pl-6">Use “{trimmedQuery}” (not in system)</span>
            </ClientOptionButton>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
