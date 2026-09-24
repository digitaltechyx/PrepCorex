"use client";

import { useCallback, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScanCameraButton } from "@/components/warehouse-ops/scan-camera-button";
import { cn } from "@/lib/utils";
import { Keyboard, Loader2, RefreshCw } from "lucide-react";

type TrackerScanFieldProps = {
  value: string;
  onChange: (value: string) => void;
  onAdd: (raw: string, addedVia: "scan" | "manual") => void | Promise<void>;
  adding: boolean;
  loading?: boolean;
  onReload?: () => void;
  scannerTitle: string;
  scannerDescription: string;
  inputPlaceholder?: string;
};

const WEDGE_GAP_MS = 150;
const MIN_WEDGE_LEN = 3;

function isOtherEditableField(target: EventTarget | null, trackerInput: HTMLInputElement | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  if (trackerInput && target === trackerInput) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

/**
 * Tracking input for Inbound / Outbound Tracker.
 * Bluetooth wedge scanners type like a keyboard. We listen page-wide so scans still
 * work after clicking filters, the table, or elsewhere (except other text fields).
 */
export function TrackerScanField({
  value,
  onChange,
  onAdd,
  adding,
  loading = false,
  onReload,
  scannerTitle,
  scannerDescription,
  inputPlaceholder = "Aim Bluetooth scanner here or type tracking number…",
}: TrackerScanFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const wasAddingRef = useRef(false);
  const onAddRef = useRef(onAdd);
  const onChangeRef = useRef(onChange);
  const addingRef = useRef(adding);
  const wedgeBufferRef = useRef("");
  const wedgeLastKeyAtRef = useRef(0);

  useEffect(() => {
    onAddRef.current = onAdd;
  }, [onAdd]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    addingRef.current = adding;
  }, [adding]);

  const refocus = useCallback(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      window.setTimeout(() => inputRef.current?.focus(), 0);
    });
  }, []);

  const submit = useCallback(
    async (raw: string, addedVia: "scan" | "manual") => {
      try {
        await onAddRef.current(raw, addedVia);
      } finally {
        wedgeBufferRef.current = "";
        refocus();
      }
    },
    [refocus]
  );

  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  }, [submit]);

  useEffect(() => {
    refocus();
  }, [refocus]);

  useEffect(() => {
    if (wasAddingRef.current && !adding) {
      refocus();
    }
    wasAddingRef.current = adding;
  }, [adding, refocus]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (addingRef.current) return;

      const trackerInput = inputRef.current;
      const onTrackerInput = e.target === trackerInput;

      if (isOtherEditableField(e.target, trackerInput)) {
        return;
      }

      if (onTrackerInput) {
        return;
      }

      if (e.key === "Enter") {
        const code = wedgeBufferRef.current.trim();
        wedgeBufferRef.current = "";
        if (code.length >= MIN_WEDGE_LEN) {
          e.preventDefault();
          e.stopPropagation();
          onChangeRef.current("");
          void submitRef.current(code, "scan");
        }
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const now = Date.now();
        if (now - wedgeLastKeyAtRef.current > WEDGE_GAP_MS) {
          wedgeBufferRef.current = "";
        }
        wedgeLastKeyAtRef.current = now;
        wedgeBufferRef.current += e.key;
        onChangeRef.current(wedgeBufferRef.current);
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (e.key === "Backspace" && wedgeBufferRef.current) {
        wedgeBufferRef.current = wedgeBufferRef.current.slice(0, -1);
        onChangeRef.current(wedgeBufferRef.current);
        e.preventDefault();
        e.stopPropagation();
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return (
    <div className="space-y-2">
      <form
        className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center"
        onSubmit={(e) => {
          e.preventDefault();
          wedgeBufferRef.current = "";
          void submit(value, "scan");
        }}
      >
        <Input
          ref={inputRef}
          autoFocus
          value={value}
          onChange={(e) => {
            wedgeBufferRef.current = "";
            onChange(e.target.value);
          }}
          placeholder={inputPlaceholder}
          className="w-full font-mono text-sm sm:min-w-[220px] sm:max-w-md sm:flex-1"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          inputMode="text"
          aria-busy={adding}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            disabled={adding || !value.trim()}
            className="shrink-0"
            onClick={() => {
              wedgeBufferRef.current = "";
              void submit(value, "manual");
            }}
          >
            {adding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            <Keyboard className="mr-2 h-4 w-4" />
            Add typed
          </Button>
          <ScanCameraButton
            onScan={(text) => void submit(text, "scan")}
            showLabel
            label="Camera"
            disabled={adding}
            scannerTitle={scannerTitle}
            scannerDescription={scannerDescription}
            shippingBarcode
          />
          {onReload ? (
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              onClick={onReload}
              disabled={loading}
            >
              <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
              Reload
            </Button>
          ) : null}
        </div>
      </form>
      <p className="text-xs text-muted-foreground">
        Bluetooth scanner works anywhere on this page — click filters or the table and keep scanning;
        Enter adds each label. Typing in the search box above pauses wedge capture until you click
        back here. Use Camera on mobile, or Add typed for manual entry.
      </p>
    </div>
  );
}
