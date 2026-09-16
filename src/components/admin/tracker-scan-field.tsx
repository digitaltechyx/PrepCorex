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

/**
 * Tracking input for Inbound / Outbound Tracker.
 * Bluetooth wedge scanners type into the focused field and send Enter (counted as scan).
 * Mobile camera scanning stays available via ScanCameraButton.
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

  const refocus = useCallback(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      window.setTimeout(() => inputRef.current?.focus(), 0);
    });
  }, []);

  useEffect(() => {
    refocus();
  }, [refocus]);

  useEffect(() => {
    if (wasAddingRef.current && !adding) {
      refocus();
    }
    wasAddingRef.current = adding;
  }, [adding, refocus]);

  const submit = async (raw: string, addedVia: "scan" | "manual") => {
    try {
      await onAdd(raw, addedVia);
    } finally {
      refocus();
    }
  };

  return (
    <div className="space-y-2">
      <form
        className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(value, "scan");
        }}
      >
        <Input
          ref={inputRef}
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
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
            onClick={() => void submit(value, "manual")}
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
        Pair your Bluetooth scanner (it acts like a keyboard). This field stays active — scan each
        label and Enter adds it automatically. Use Camera on mobile, or Add typed when entering by
        hand.
      </p>
    </div>
  );
}
