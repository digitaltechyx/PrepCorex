"use client";

import { useRef, useState, type ReactNode, type RefObject } from "react";
import { Delete, Keyboard, KeyboardOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TRACKING_ROWS = ["1234567890", "QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"] as const;
const TEXT_ROWS = ["1234567890", "QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"] as const;

export type OnScreenKeyboardMode = "tracking" | "numeric" | "text";

type FieldProps = {
  value: string;
  onChange: (value: string) => void;
  mode?: OnScreenKeyboardMode;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  inputClassName?: string;
  multiline?: boolean;
  rows?: number;
  /** Extra controls beside the keyboard toggle (e.g. camera). */
  trailing?: ReactNode;
  onSubmit?: (value: string) => void;
  submitLabel?: string;
  hint?: string;
};

/**
 * Text field with an optional in-app keyboard.
 * Needed on mobile when a Bluetooth barcode scanner is paired (OS hides soft keyboard).
 */
export function OnScreenKeyboardField({
  value,
  onChange,
  mode = "text",
  placeholder,
  disabled,
  autoFocus,
  className,
  inputClassName,
  multiline,
  rows = 2,
  trailing,
  onSubmit,
  submitLabel = "Done",
  hint,
}: FieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [padOpen, setPadOpen] = useState(false);

  const focusTarget = () => {
    requestAnimationFrame(() => {
      if (multiline) areaRef.current?.focus();
      else inputRef.current?.focus();
    });
  };

  const insert = (char: string) => {
    if (mode === "numeric" && !/^\d$/.test(char)) return;
    onChange(`${value}${char}`);
    focusTarget();
  };

  const backspace = () => {
    onChange(value.slice(0, -1));
    focusTarget();
  };

  const defaultHint =
    mode === "numeric"
      ? "Tap keys if the phone keyboard is hidden by the scanner."
      : "Works while the barcode scanner stays connected.";

  return (
    <div className={cn("w-full min-w-0 space-y-2", className)}>
      <div className="flex w-full min-w-0 flex-wrap items-stretch gap-2 sm:flex-nowrap">
        {multiline ? (
          <Textarea
            ref={areaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            autoFocus={autoFocus}
            rows={rows}
            className={cn("min-w-0 w-full flex-1 basis-full sm:basis-auto", inputClassName)}
            autoComplete="off"
            spellCheck={false}
          />
        ) : (
          <Input
            ref={inputRef as RefObject<HTMLInputElement>}
            value={value}
            onChange={(e) => {
              const next = e.target.value;
              onChange(mode === "numeric" ? next.replace(/[^\d]/g, "") : next);
            }}
            placeholder={placeholder}
            disabled={disabled}
            autoFocus={autoFocus}
            className={cn(
              "min-w-0 flex-1",
              mode === "tracking" && "font-mono text-sm",
              inputClassName
            )}
            inputMode={mode === "numeric" ? "numeric" : "text"}
            enterKeyHint={onSubmit ? "done" : "enter"}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize={mode === "tracking" ? "characters" : "off"}
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === "Enter" && onSubmit && !multiline) {
                e.preventDefault();
                onSubmit(value);
              }
            }}
          />
        )}
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            size="icon"
            variant={padOpen ? "default" : "outline"}
            className="h-10 w-10 shrink-0 sm:h-9 sm:w-auto sm:px-3"
            disabled={disabled}
            title={padOpen ? "Hide on-screen keyboard" : "Show on-screen keyboard"}
            aria-label={padOpen ? "Hide on-screen keyboard" : "Show on-screen keyboard"}
            aria-pressed={padOpen}
            onClick={() => {
              setPadOpen((open) => !open);
              focusTarget();
            }}
          >
            {padOpen ? <KeyboardOff className="h-4 w-4" /> : <Keyboard className="h-4 w-4" />}
            <span className="ml-1.5 hidden sm:inline text-sm">Keyboard</span>
          </Button>
          {trailing}
        </div>
      </div>

      {padOpen ? (
        <OnScreenKeyboardPad
          mode={mode}
          disabled={disabled}
          hint={hint ?? defaultHint}
          canSubmit={Boolean(onSubmit) && Boolean(value.trim())}
          submitLabel={submitLabel}
          onInsert={insert}
          onBackspace={backspace}
          onClear={() => {
            onChange("");
            focusTarget();
          }}
          onSubmit={onSubmit ? () => onSubmit(value) : undefined}
        />
      ) : null}
    </div>
  );
}

type PadProps = {
  mode: OnScreenKeyboardMode;
  disabled?: boolean;
  hint: string;
  canSubmit: boolean;
  submitLabel: string;
  onInsert: (char: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  onSubmit?: () => void;
};

export function OnScreenKeyboardPad({
  mode,
  disabled,
  hint,
  canSubmit,
  submitLabel,
  onInsert,
  onBackspace,
  onClear,
  onSubmit,
}: PadProps) {
  const rows =
    mode === "numeric" ? null : mode === "tracking" ? TRACKING_ROWS : TEXT_ROWS;

  return (
    <div className="w-full min-w-0 max-w-full overflow-hidden rounded-xl border bg-muted/40 p-1.5 sm:p-2 space-y-1 sm:space-y-1.5">
      <p className="px-1 text-[10px] leading-snug text-muted-foreground sm:text-[11px]">{hint}</p>

      {mode === "numeric" ? (
        <div className="mx-auto grid w-full max-w-[280px] grid-cols-3 gap-1.5 sm:gap-2">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((key) => (
            <PadKey key={key} disabled={disabled} tall onPress={() => onInsert(key)}>
              {key}
            </PadKey>
          ))}
          <PadKey disabled={disabled} tall muted onPress={onClear}>
            Clear
          </PadKey>
          <PadKey disabled={disabled} tall onPress={() => onInsert("0")}>
            0
          </PadKey>
          <PadKey disabled={disabled} tall muted onPress={onBackspace}>
            <Delete className="h-4 w-4" />
          </PadKey>
          {onSubmit ? (
            <button
              type="button"
              disabled={disabled || !canSubmit}
              className="col-span-3 min-h-11 rounded-lg bg-primary text-sm font-semibold text-primary-foreground shadow-sm active:opacity-90 disabled:opacity-50 sm:min-h-12"
              onPointerDown={(e) => e.preventDefault()}
              onClick={onSubmit}
            >
              {submitLabel}
            </button>
          ) : null}
        </div>
      ) : (
        <>
          {rows!.map((row) => (
            <div
              key={row}
              className="grid w-full gap-0.5 sm:gap-1"
              style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}
            >
              {row.split("").map((key) => (
                <PadKey key={key} disabled={disabled} compact onPress={() => onInsert(key)}>
                  {key}
                </PadKey>
              ))}
            </div>
          ))}
          {mode === "text" ? (
            <PadKey disabled={disabled} className="w-full" onPress={() => onInsert(" ")}>
              Space
            </PadKey>
          ) : null}
          <div className="grid grid-cols-2 gap-1 pt-0.5 sm:grid-cols-[1.2fr_1fr_1.4fr]">
            <PadKey disabled={disabled} className="gap-1" onPress={onBackspace}>
              <Delete className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              <span className="text-xs sm:text-sm">Del</span>
            </PadKey>
            <PadKey disabled={disabled} onPress={onClear}>
              <span className="text-xs sm:text-sm">Clear</span>
            </PadKey>
            {onSubmit ? (
              <button
                type="button"
                disabled={disabled || !canSubmit}
                className="col-span-2 min-h-10 rounded-md bg-primary text-sm font-semibold text-primary-foreground shadow-sm active:opacity-90 disabled:opacity-50 sm:col-span-1 sm:min-h-11"
                onPointerDown={(e) => e.preventDefault()}
                onClick={onSubmit}
              >
                {submitLabel}
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function PadKey({
  children,
  disabled,
  className,
  onPress,
  compact,
  tall,
  muted,
}: {
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  onPress: () => void;
  compact?: boolean;
  tall?: boolean;
  muted?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "inline-flex items-center justify-center rounded-md border bg-background font-semibold tabular-nums shadow-sm touch-manipulation select-none active:bg-muted disabled:opacity-50",
        compact
          ? "min-h-9 px-0 text-xs sm:min-h-10 sm:text-sm"
          : tall
            ? "min-h-11 text-base sm:min-h-12 sm:text-lg"
            : "min-h-10 px-1 text-sm sm:min-h-11",
        muted && "bg-muted/60 text-muted-foreground font-medium",
        className
      )}
      onPointerDown={(e) => e.preventDefault()}
      onClick={onPress}
    >
      {children}
    </button>
  );
}
