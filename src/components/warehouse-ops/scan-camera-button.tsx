"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera } from "lucide-react";
import { cn } from "@/lib/utils";
import { CameraBarcodeScannerDialog } from "@/components/warehouse-ops/camera-barcode-scanner-dialog";

type Props = {
  onScan: (decodedText: string) => void;
  /** Button label when `showLabel` is true. */
  label?: string;
  showLabel?: boolean;
  size?: "default" | "sm" | "icon";
  variant?: "default" | "outline" | "secondary" | "ghost";
  className?: string;
  disabled?: boolean;
  scannerTitle?: string;
  scannerDescription?: string;
};

/** Opens the device camera to scan barcodes / QR (mobile-friendly). */
export function ScanCameraButton({
  onScan,
  label = "Camera",
  showLabel = false,
  size = "icon",
  variant = "outline",
  className,
  disabled,
  scannerTitle,
  scannerDescription,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        className={cn(size === "icon" ? "h-9 w-9 shrink-0" : "", className)}
        disabled={disabled}
        onClick={() => setOpen(true)}
        title="Scan with phone camera"
      >
        <Camera className={cn("h-4 w-4", showLabel && "mr-1")} />
        {showLabel ? label : <span className="sr-only">{label}</span>}
      </Button>
      <CameraBarcodeScannerDialog
        open={open}
        onOpenChange={setOpen}
        onScan={onScan}
        title={scannerTitle}
        description={scannerDescription}
      />
    </>
  );
}
