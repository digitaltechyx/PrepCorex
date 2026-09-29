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
import { resolveShippingBarcodeScan } from "@/lib/carrier-detect";

type Html5QrcodeInstance = import("html5-qrcode").Html5Qrcode;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (decodedText: string) => void;
  title?: string;
  description?: string;
  /** Prefer long shipping barcodes (same path as Trackers). Reject ZIP-only / short product codes. */
  shippingBarcode?: boolean;
};

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

function getNativeBarcodeDetector(): BarcodeDetectorLike | null {
  if (typeof window === "undefined") return null;
  const Ctor = (
    window as unknown as {
      BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike;
    }
  ).BarcodeDetector;
  if (!Ctor) return null;
  try {
    return new Ctor({
      formats: ["code_128", "code_39", "codabar", "itf", "pdf417", "data_matrix"],
    });
  } catch {
    return null;
  }
}

export function CameraBarcodeScannerDialog({
  open,
  onOpenChange,
  onScan,
  title = "Scan with camera",
  description,
  shippingBarcode = false,
}: Props) {
  const reactId = useId();
  const regionId = `cam-scan-${reactId.replace(/:/g, "")}`;
  const scannerRef = useRef<Html5QrcodeInstance | null>(null);
  const nativeDetectorRef = useRef<BarcodeDetectorLike | null>(null);
  const nativePollRef = useRef<number | null>(null);
  const handledRef = useRef(false);
  const lastScanRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const [status, setStatus] = useState<"idle" | "starting" | "scanning" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");

  const resolvedDescription =
    description ??
    (shippingBarcode
      ? "Aim at the long USPS / carrier tracking barcode. Keep the full bar width in view."
      : "Point your phone at the barcode or QR code. Works best in good light with the back camera.");

  const stopNativePoll = useCallback(() => {
    if (nativePollRef.current != null) {
      window.clearInterval(nativePollRef.current);
      nativePollRef.current = null;
    }
    nativeDetectorRef.current = null;
  }, []);

  const stopScanner = useCallback(async () => {
    stopNativePoll();
    const s = scannerRef.current;
    scannerRef.current = null;
    if (!s) return;
    try {
      if (s.isScanning) await s.stop();
      await s.clear();
    } catch {
      // ignore teardown races
    }
  }, [stopNativePoll]);

  const acceptDecoded = useCallback(
    (decodedText: string) => {
      if (handledRef.current) return;
      const text = shippingBarcode
        ? resolveShippingBarcodeScan(decodedText)
        : decodedText.trim();
      if (!text) {
        if (shippingBarcode) {
          setErrorMsg(
            "That code is not a shipping tracking barcode. Aim at the USPS TRACKING # barcode (long bars)."
          );
        }
        return;
      }
      const now = Date.now();
      if (lastScanRef.current.text === text && now - lastScanRef.current.at < 2000) {
        return;
      }
      handledRef.current = true;
      lastScanRef.current = { text, at: now };
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(80);
      }
      void stopScanner().then(() => {
        onScan(text);
        onOpenChange(false);
      });
    },
    [onOpenChange, onScan, shippingBarcode, stopScanner]
  );

  const startNativePoll = useCallback(
    (root: HTMLElement) => {
      if (!shippingBarcode) return;
      const detector = getNativeBarcodeDetector();
      if (!detector) return;
      nativeDetectorRef.current = detector;
      nativePollRef.current = window.setInterval(() => {
        if (handledRef.current) return;
        const video = root.querySelector("video");
        if (!video || video.readyState < 2) return;
        void detector
          .detect(video)
          .then((codes) => {
            for (const code of codes) {
              const raw = String(code.rawValue || "").trim();
              if (raw) acceptDecoded(raw);
            }
          })
          .catch(() => {
            /* frame miss */
          });
      }, 250);
    },
    [acceptDecoded, shippingBarcode]
  );

  const startScanner = useCallback(async () => {
    setErrorMsg(null);
    setStatus("starting");
    handledRef.current = false;
    await stopScanner();

    const el = document.getElementById(regionId);
    if (!el) {
      setStatus("error");
      setErrorMsg("Scanner view not ready. Close and try again.");
      return;
    }

    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
      // USPS eVS / carrier labels: prioritize CODE_128. Keep PDF417/DataMatrix for FedEx.
      // Omit QR so address QR does not steal the scan.
      const formatsToSupport = shippingBarcode
        ? [
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.CODE_93,
            Html5QrcodeSupportedFormats.CODABAR,
            Html5QrcodeSupportedFormats.ITF,
            Html5QrcodeSupportedFormats.PDF_417,
            Html5QrcodeSupportedFormats.DATA_MATRIX,
          ]
        : [
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.DATA_MATRIX,
            Html5QrcodeSupportedFormats.PDF_417,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.CODE_93,
            Html5QrcodeSupportedFormats.CODABAR,
            Html5QrcodeSupportedFormats.ITF,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.RSS_14,
          ];

      const scanner = new Html5Qrcode(regionId, {
        verbose: false,
        formatsToSupport,
        // ZXing path for html5-qrcode; native BarcodeDetector runs in parallel below (Google-like).
        useBarCodeDetectorIfSupported: false,
      });

      await scanner.start(
        { facingMode },
        {
          fps: shippingBarcode ? 20 : 15,
          // Short, very wide strip — matches short USPS TRACKING # bars better than a tall box.
          qrbox: (viewfinderWidth, viewfinderHeight) => {
            if (!shippingBarcode) {
              return {
                width: Math.floor(viewfinderWidth * 0.98),
                height: Math.floor(Math.min(viewfinderHeight * 0.42, 240)),
              };
            }
            return {
              width: Math.floor(viewfinderWidth * 0.99),
              height: Math.floor(Math.min(Math.max(viewfinderHeight * 0.22, 96), 160)),
            };
          },
          aspectRatio: 1.777,
          disableFlip: false,
          videoConstraints: {
            facingMode: { ideal: facingMode },
            width: { min: 640, ideal: 1920 },
            height: { min: 480, ideal: 1080 },
            // @ts-expect-error focusMode is supported on mobile Chrome/Safari
            focusMode: { ideal: "continuous" },
          },
          experimentalFeatures: {
            useBarCodeDetectorIfSupported: false,
          },
        },
        (decodedText) => acceptDecoded(decodedText),
        () => {
          // per-frame miss — expected while aiming
        }
      );
      scannerRef.current = scanner;
      startNativePoll(el);
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
  }, [acceptDecoded, facingMode, regionId, shippingBarcode, startNativePoll, stopScanner]);

  useEffect(() => {
    if (!open) {
      void stopScanner();
      setStatus("idle");
      setErrorMsg(null);
      handledRef.current = false;
      lastScanRef.current = { text: "", at: 0 };
      return;
    }
    const t = setTimeout(() => void startScanner(), 200);
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
          <DialogDescription className="text-xs">{resolvedDescription}</DialogDescription>
        </DialogHeader>

        <div className="relative bg-black min-h-[300px]">
          {/* object-contain keeps the full barcode width visible — object-cover was cropping USPS bars */}
          <div
            id={regionId}
            className={
              shippingBarcode
                ? "w-full [&_video]:!h-auto [&_video]:!max-h-[360px] [&_video]:!w-full [&_video]:!object-contain"
                : "w-full [&_video]:!object-cover"
            }
          />

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
                {shippingBarcode
                  ? "Fill the thin guide with the full USPS TRACKING # barcode — both ends must be visible"
                  : "Hold the label barcode flat inside the wide box — scan is automatic"}
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
