"use client";

import { ScanCameraButton } from "@/components/warehouse-ops/scan-camera-button";
import { OnScreenKeyboardField } from "@/components/admin/on-screen-keyboard-field";

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

/** Tracking field + camera + on-screen keyboard (for Bluetooth scanner on mobile). */
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
  return (
    <OnScreenKeyboardField
      mode="tracking"
      value={value}
      onChange={onChange}
      onSubmit={onSubmit}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      className={className}
      trailing={
        camera ? (
          <ScanCameraButton
            showLabel
            label="Camera"
            disabled={disabled || camera.disabled}
            scannerTitle={camera.scannerTitle}
            scannerDescription={camera.scannerDescription}
            onScan={camera.onScan}
          />
        ) : null
      }
    />
  );
}
