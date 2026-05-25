"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, Loader2, SwitchCamera } from "lucide-react";

type Html5QrcodeInstance = import("html5-qrcode").Html5Qrcode;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (decodedText: string) => void;
  title?: string;
  description?: string;
};

export function CameraBarcodeScannerDialog({
  open,
  onOpenChange,
  onScan,
  title = "Scan with camera",
  description = "Point your phone at the barcode or QR code. Works best in good light with the back camera.",
}: Props) {
  const reactId = useId();
  const regionId = `cam-scan-${reactId.replace(/:/g, "")}`;
  const scannerRef = useRef<Html5QrcodeInstance | null>(null);
  const lastScanRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const [status, setStatus] = useState<"idle" | "starting" | "scanning" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");

  const stopScanner = useCallback(async () => {
    const s = scannerRef.current;
    scannerRef.current = null;
    if (!s) return;
    try {
      if (s.isScanning) await s.stop();
      await s.clear();
    } catch {
      // ignore teardown races
    }
  }, []);

  const startScanner = useCallback(async () => {
    setErrorMsg(null);
    setStatus("starting");
    await stopScanner();

    const el = document.getElementById(regionId);
    if (!el) {
      setStatus("error");
      setErrorMsg("Scanner view not ready. Close and try again.");
      return;
    }

    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
      const formatsToSupport = [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.CODE_93,
        Html5QrcodeSupportedFormats.ITF,
      ];

      const scanner = new Html5Qrcode(regionId, { verbose: false });
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode },
        {
          fps: 12,
          qrbox: (viewfinderWidth, viewfinderHeight) => ({
            width: Math.floor(viewfinderWidth * 0.92),
            height: Math.floor(Math.min(viewfinderHeight * 0.38, 180)),
          }),
          aspectRatio: 1.777,
          formatsToSupport,
          disableFlip: false,
        },
        (decodedText) => {
          const text = decodedText.trim();
          if (!text) return;
          const now = Date.now();
          if (
            lastScanRef.current.text === text &&
            now - lastScanRef.current.at < 2000
          ) {
            return;
          }
          lastScanRef.current = { text, at: now };
          if (typeof navigator !== "undefined" && navigator.vibrate) {
            navigator.vibrate(80);
          }
          void stopScanner().then(() => {
            onScan(text);
            onOpenChange(false);
          });
        },
        () => {
          // per-frame miss — expected while aiming
        }
      );
      setStatus("scanning");
    } catch (e) {
      setStatus("error");
      const msg = e instanceof Error ? e.message : "Could not start camera.";
      if (/notallowed|permission/i.test(msg)) {
        setErrorMsg(
          "Camera permission denied. Allow camera access in your browser settings, then try again."
        );
      } else if (/notfound|no camera/i.test(msg)) {
        setErrorMsg("No camera found on this device.");
      } else {
        setErrorMsg(msg);
      }
    }
  }, [facingMode, onOpenChange, onScan, regionId, stopScanner]);

  useEffect(() => {
    if (!open) {
      void stopScanner();
      setStatus("idle");
      setErrorMsg(null);
      lastScanRef.current = { text: "", at: 0 };
      return;
    }
    const t = setTimeout(() => void startScanner(), 150);
    return () => {
      clearTimeout(t);
      void stopScanner();
    };
  }, [open, facingMode, startScanner, stopScanner]);

  async function toggleCamera() {
    setFacingMode((m) => (m === "environment" ? "user" : "environment"));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Camera className="h-4 w-4" />
            {title}
          </DialogTitle>
          <DialogDescription className="text-xs">{description}</DialogDescription>
        </DialogHeader>

        <div className="relative bg-black min-h-[280px]">
          <div id={regionId} className="w-full [&_video]:!object-cover" />

          {status === "starting" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 text-white gap-2">
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="text-sm">Starting camera…</p>
            </div>
          ) : null}

          {status === "error" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-white gap-3 p-6 text-center">
              <p className="text-sm">{errorMsg}</p>
              <Button type="button" variant="secondary" size="sm" onClick={() => void startScanner()}>
                Try again
              </Button>
            </div>
          ) : null}

          {status === "scanning" ? (
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-4 py-3">
              <p className="text-xs text-white/90 text-center">
                Align barcode inside the box — scan is automatic
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t">
          <Button type="button" variant="outline" size="sm" onClick={() => void toggleCamera()}>
            <SwitchCamera className="h-4 w-4 mr-1" />
            Flip camera
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
