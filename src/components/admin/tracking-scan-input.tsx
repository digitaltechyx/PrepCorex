"use client";

import { useRef, useState } from "react";
import { Delete, Keyboard, KeyboardOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScanCameraButton } from "@/components/warehouse-ops/scan-camera-button";
import { cn } from "@/lib/utils";

const KEY_ROWS = ["1234567890", "QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"] as const;

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  camera?: {
    onScan: (value: string) => void;
    disabled?: boolean;
    scannerTitle?: string;
    scannerDescription?: string;
  };
};

/**
 * Tracking field that works with a Bluetooth wedge scanner and an in-app keyboard.
 * Mobile OS hides the soft keyboard when a scanner is paired as a hardware keyboard;
 * the on-screen pad types into the same field without disconnecting the gun.
 */
export function TrackingScanInput({
  value,
  onChange,
  onSubmit,
  placeholder = "Scan, type, or use camera…",
  disabled,
  autoFocus,
  className,
  camera,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [padOpen, setPadOpen] = useState(false);

  const keepFocus = () => {
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const insert = (char: string) => {
    onChange(`${value}${char}`);
    keepFocus();
  };

  const backspace = () => {
    onChange(value.slice(0, -1));
    keepFocus();
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="font-mono"
          autoFocus={autoFocus}
          disabled={disabled}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          enterKeyHint="done"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSubmit?.(value);
            }
          }}
        />
        <Button
          type="button"
          variant={padOpen ? "default" : "outline"}
          className="shrink-0"
          disabled={disabled}
          title={padOpen ? "Hide on-screen keyboard" : "Show on-screen keyboard"}
          aria-pressed={padOpen}
          onClick={() => {
            setPadOpen((open) => !open);
            keepFocus();
          }}
        >
          {padOpen ? <KeyboardOff className="h-4 w-4" /> : <Keyboard className="h-4 w-4" />}
          <span className="ml-1.5 hidden sm:inline">Keyboard</span>
        </Button>
        {camera ? (
          <ScanCameraButton
            showLabel
            label="Camera"
            disabled={disabled || camera.disabled}
            scannerTitle={camera.scannerTitle}
            scannerDescription={camera.scannerDescription}
            onScan={camera.onScan}
          />
        ) : null}
      </div>

      {padOpen ? (
        <div className="rounded-xl border bg-muted/40 p-2 space-y-1.5">
          <p className="px-1 text-[11px] text-muted-foreground">
            On-screen keys work while the barcode scanner stays connected. Scanner can still type
            into the box.
          </p>
          {KEY_ROWS.map((row) => (
            <div key={row} className="flex justify-center gap-1">
              {row.split("").map((key) => (
                <button
                  key={key}
                  type="button"
                  disabled={disabled}
                  className="min-h-10 min-w-[1.85rem] flex-1 rounded-md border bg-background px-0.5 text-sm font-semibold tabular-nums shadow-sm active:bg-muted disabled:opacity-50"
                  // Keep focus on the input so HID scanner keystrokes still land there.
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => insert(key)}
                >
                  {key}
                </button>
              ))}
            </div>
          ))}
          <div className="flex gap-1 pt-0.5">
            <button
              type="button"
              disabled={disabled}
              className="flex min-h-10 flex-[1.2] items-center justify-center gap-1 rounded-md border bg-background text-sm font-medium shadow-sm active:bg-muted disabled:opacity-50"
              onPointerDown={(e) => e.preventDefault()}
              onClick={backspace}
            >
              <Delete className="h-4 w-4" />
              Delete
            </button>
            <button
              type="button"
              disabled={disabled}
              className="min-h-10 flex-1 rounded-md border bg-background text-sm font-medium shadow-sm active:bg-muted disabled:opacity-50"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange("");
                keepFocus();
              }}
            >
              Clear
            </button>
            {onSubmit ? (
              <button
                type="button"
                disabled={disabled || !value.trim()}
                className="min-h-10 flex-[1.4] rounded-md bg-primary text-sm font-semibold text-primary-foreground shadow-sm active:opacity-90 disabled:opacity-50"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => onSubmit(value)}
              >
                Done
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
