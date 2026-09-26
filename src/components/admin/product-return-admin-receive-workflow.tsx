"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { Loader2, PackagePlus, ScanLine, Box, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import type { ProductReturn, ReturnArrival, ReturnArrivalUnitType } from "@/types";
import {
  formatReturnArrivalUnitType,
  deleteReturnArrival,
  logReturnArrival,
  normalizeReturnArrivals,
  openReceiveReturnArrival,
  returnArrivalStatusLabel,
  summarizeReturnArrivals,
} from "@/lib/product-return-arrivals";
import { ProductReturnArrivalsTimeline } from "@/components/product-returns/product-return-arrivals-timeline";
import { PagedRows } from "@/components/product-returns/paged-rows";
import { uploadProductReturnReceivePhotos } from "@/lib/product-return-receive-photos";
import { importWarehouseCameraVideoFile } from "@/lib/warehouse-camera-client";
import { ProductReturnReceiveVideoField } from "@/components/admin/product-return-receive-video-field";
import { ScanCameraButton } from "@/components/warehouse-ops/scan-camera-button";
import { normalizeTrackingScan } from "@/lib/carrier-detect";
import { Badge } from "@/components/ui/badge";

const UNIT_TYPE_STORAGE_KEY = "psf.returnArrival.preferredUnitType";

function readStoredUnitType(): ReturnArrivalUnitType {
  if (typeof window === "undefined") return "carton";
  try {
    const raw = window.sessionStorage.getItem(UNIT_TYPE_STORAGE_KEY);
    if (raw === "pallet" || raw === "package" || raw === "carton") return raw;
  } catch {
    /* ignore */
  }
  return "carton";
}

function persistUnitType(value: ReturnArrivalUnitType) {
  try {
    window.sessionStorage.setItem(UNIT_TYPE_STORAGE_KEY, value);
  } catch {
    /* ignore */
  }
}

type Props = {
  ownerUserId: string;
  clientDisplayName?: string;
  returnItem: ProductReturn & { id: string };
  operatorId: string;
  disabled?: boolean;
  onUpdated?: () => void;
};

export function ProductReturnAdminReceiveWorkflow({
  ownerUserId,
  clientDisplayName,
  returnItem,
  operatorId,
  disabled,
  onUpdated,
}: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [trackingNumber, setTrackingNumber] = useState("");
  const [unitType, setUnitType] = useState<ReturnArrivalUnitType>(readStoredUnitType);
  const [arrivalNotes, setArrivalNotes] = useState("");
  const [isLogging, setIsLogging] = useState(false);
  const [deletingArrivalId, setDeletingArrivalId] = useState<string | null>(null);

  const [openArrival, setOpenArrival] = useState<ReturnArrival | null>(null);
  const [goodQty, setGoodQty] = useState("");
  const [damagedQty, setDamagedQty] = useState("");
  const [openNotes, setOpenNotes] = useState("");
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [isOpening, setIsOpening] = useState(false);

  const arrivals = useMemo(
    () => normalizeReturnArrivals(returnItem.returnArrivals),
    [returnItem.returnArrivals]
  );
  const summary = useMemo(() => summarizeReturnArrivals(arrivals), [arrivals]);
  const pendingOpen = arrivals.filter((a) => a.status !== "received");

  const handleLogArrival = async () => {
    const tracking = normalizeTrackingScan(trackingNumber);
    if (!tracking) {
      toast({
        variant: "destructive",
        title: "Tracking required",
        description: "Scan or enter the carrier tracking number.",
      });
      return;
    }
    setIsLogging(true);
    try {
      await logReturnArrival({
        ownerUserId,
        returnId: returnItem.id,
        trackingNumber: tracking,
        unitType,
        operatorId,
        notes: arrivalNotes.trim() || undefined,
      });
      toast({
        title: "Arrival logged",
        description: `${formatReturnArrivalUnitType(unitType)} recorded for tracking ${tracking}.`,
      });
      setTrackingNumber("");
      setArrivalNotes("");
      onUpdated?.();
    } catch (err: unknown) {
      toast({
        variant: "destructive",
        title: "Could not log arrival",
        description: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setIsLogging(false);
    }
  };

  const handleDeleteArrival = async (arrival: ReturnArrival) => {
    const tracking = arrival.trackingNumber || "this scan";
    const counted =
      arrival.status === "received"
        ? ` This arrival was already counted (good ${arrival.goodQty ?? 0}, damaged ${arrival.damagedQty ?? 0}) — counts will be reversed.`
        : "";
    if (
      !window.confirm(
        `Remove tracking ${tracking}?${counted}\n\nUse this if the wrong label or another client's tracking was scanned.`
      )
    ) {
      return;
    }
    setDeletingArrivalId(arrival.id);
    try {
      await deleteReturnArrival({
        ownerUserId,
        returnId: returnItem.id,
        arrivalId: arrival.id,
      });
      toast({
        title: "Scan removed",
        description: `Tracking ${tracking} deleted from this return.`,
      });
      if (openArrival?.id === arrival.id) setOpenArrival(null);
      onUpdated?.();
    } catch (err: unknown) {
      toast({
        variant: "destructive",
        title: "Could not delete scan",
        description: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setDeletingArrivalId(null);
    }
  };

  const startOpenReceive = (arrival: ReturnArrival) => {
    setOpenArrival(arrival);
    setGoodQty("");
    setDamagedQty("");
    setOpenNotes("");
    setPhotoFiles([]);
    setVideoFiles([]);
  };

  const handlePhotoSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? [...event.target.files] : [];
    event.target.value = "";
    if (files.length > 0) setPhotoFiles((prev) => [...prev, ...files]);
  };

  const handleOpenReceive = async () => {
    if (!openArrival) return;
    const good = Math.max(0, parseInt(goodQty, 10) || 0);
    const damaged = Math.max(0, parseInt(damagedQty, 10) || 0);
    if (good + damaged < 1) {
      toast({
        variant: "destructive",
        title: "Quantity required",
        description: "Enter good and/or damaged quantity.",
      });
      return;
    }

    setIsOpening(true);
    try {
      let receivePhotoUrls: string[] | undefined;
      if (photoFiles.length > 0) {
        receivePhotoUrls = await uploadProductReturnReceivePhotos({
          ownerUid: ownerUserId,
          returnId: returnItem.id,
          files: photoFiles,
        });
      }

      let videoSessionIds: string[] | undefined;
      if (videoFiles.length > 0) {
        if (!user) {
          throw new Error("Sign in again to upload the receive video to Google Drive.");
        }
        const ids: string[] = [];
        for (let index = 0; index < videoFiles.length; index += 1) {
          const session = await importWarehouseCameraVideoFile(user, {
            jobType: "return",
            clientUserId: ownerUserId,
            clientDisplayName: clientDisplayName?.trim() || ownerUserId,
            productReturnId: returnItem.id,
            returnArrivalId: openArrival.id,
            warehouseId: "admin",
            warehouseLabel: "Admin",
            clipNumber: index + 1,
            file: videoFiles[index],
          });
          ids.push(session.id);
        }
        videoSessionIds = ids;
      }

      await openReceiveReturnArrival({
        ownerUserId,
        returnId: returnItem.id,
        arrivalId: openArrival.id,
        goodQty: good,
        damagedQty: damaged,
        operatorId,
        notes: openNotes.trim() || undefined,
        receivePhotoUrls,
        videoSessionIds,
      });

      toast({
        title: "Receive recorded",
        description: videoSessionIds?.length
          ? `Good ${good}, damaged ${damaged} for ${formatReturnArrivalUnitType(openArrival.unitType)}. Video saved to Google Drive.`
          : `Good ${good}, damaged ${damaged} for ${formatReturnArrivalUnitType(openArrival.unitType)}.`,
      });
      setOpenArrival(null);
      onUpdated?.();
    } catch (err: unknown) {
      toast({
        variant: "destructive",
        title: "Open receive failed",
        description: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setIsOpening(false);
    }
  };

  const canUse =
    !disabled &&
    (returnItem.status === "approved" || returnItem.status === "in_progress");

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border bg-card px-4 py-3 shadow-sm">
        <h4 className="text-sm font-semibold">Receive workflow</h4>
        <p className="mt-1 text-xs text-muted-foreground">
          Log each physical parcel once (one tracking = one parcel). Wrong scans can be deleted
          from the timeline. Duplicate tracking on this return or another client is blocked.
        </p>
      </div>

      <ProductReturnArrivalsTimeline
        returnItem={{ ...returnItem, returnArrivals: arrivals }}
        onDeleteArrival={canUse ? (arrival) => void handleDeleteArrival(arrival) : undefined}
        deletingArrivalId={deletingArrivalId}
      />

      {canUse ? (
        <>
          <div className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                <ScanLine className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold">Log arrival</p>
                <p className="text-xs text-muted-foreground">
                  One tracking number per parcel — duplicates are blocked. Unit type stays
                  selected until you change it.
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>Tracking number</Label>
                <div className="flex gap-2">
                  <Input
                    value={trackingNumber}
                    onChange={(e) => setTrackingNumber(e.target.value)}
                    placeholder="Scan, type, or use camera…"
                    className="font-mono"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleLogArrival();
                    }}
                  />
                  <ScanCameraButton
                    showLabel
                    label="Camera"
                    disabled={isLogging}
                    scannerTitle="Scan return tracking"
                    scannerDescription="Point the camera at the shipping barcode. A Bluetooth scanner can still type into the box."
                    onScan={(value) => setTrackingNumber(normalizeTrackingScan(value))}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Unit type</Label>
                <Select
                  value={unitType}
                  onValueChange={(v) => {
                    const next = v as ReturnArrivalUnitType;
                    setUnitType(next);
                    persistUnitType(next);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="carton">Carton</SelectItem>
                    <SelectItem value="pallet">Pallet</SelectItem>
                    <SelectItem value="package">Package</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Notes (optional)</Label>
                <Input
                  value={arrivalNotes}
                  onChange={(e) => setArrivalNotes(e.target.value)}
                  placeholder="Dock notes…"
                />
              </div>
            </div>
            <Button
              type="button"
              onClick={() => void handleLogArrival()}
              disabled={isLogging}
              className="w-full sm:w-auto"
            >
              {isLogging ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <PackagePlus className="mr-2 h-4 w-4" />
              )}
              Log arrival
            </Button>
          </div>

          {pendingOpen.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold">Open receive</p>
              <PagedRows items={pendingOpen}>
                {(pageRows) => (
              <div className="space-y-2">
                {pageRows.map((arrival) => (
                  <div
                    key={arrival.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border bg-card px-3 py-2.5 shadow-sm"
                  >
                    <div className="text-sm min-w-0">
                      <span className="font-mono">{arrival.trackingNumber || "—"}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {formatReturnArrivalUnitType(arrival.unitType)} ·{" "}
                        {returnArrivalStatusLabel(arrival.status)}
                      </span>
                      {arrival.notes?.trim() ? (
                        <p className="mt-0.5 text-xs text-muted-foreground whitespace-pre-wrap">
                          Notes: {arrival.notes.trim()}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => startOpenReceive(arrival)}
                      >
                        <Box className="mr-1.5 h-3.5 w-3.5" />
                        Open & count
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        disabled={deletingArrivalId === arrival.id}
                        title="Remove wrong scan"
                        onClick={() => void handleDeleteArrival(arrival)}
                      >
                        {deletingArrivalId === arrival.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
                )}
              </PagedRows>
            </div>
          ) : summary.totalArrivals > 0 ? (
            <p className="text-sm text-muted-foreground">All logged arrivals have been counted.</p>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Approve this return to log arrivals and open receive.
        </p>
      )}

      <Dialog open={!!openArrival} onOpenChange={(open) => !open && setOpenArrival(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Open receive</DialogTitle>
            <DialogDescription>
              Count good and damaged units for this{" "}
              {openArrival ? formatReturnArrivalUnitType(openArrival.unitType).toLowerCase() : "unit"}.
              Damaged qty follows the same inbound rules (not sellable).
            </DialogDescription>
          </DialogHeader>
          {openArrival ? (
            <div className="space-y-4">
              <div className="rounded-md bg-muted/50 px-3 py-2 text-sm font-mono break-all">
                {openArrival.trackingNumber}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Good qty</Label>
                  <Input
                    type="number"
                    min={0}
                    value={goodQty}
                    onChange={(e) => setGoodQty(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Damaged qty</Label>
                  <Input
                    type="number"
                    min={0}
                    value={damagedQty}
                    onChange={(e) => setDamagedQty(e.target.value)}
                    className="border-red-200"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Notes (optional)</Label>
                <Textarea
                  value={openNotes}
                  onChange={(e) => setOpenNotes(e.target.value)}
                  rows={2}
                  placeholder="Inspection notes…"
                />
              </div>
              <div className="space-y-2">
                <Label>Photos (optional)</Label>
                <Input type="file" accept="image/*" multiple onChange={handlePhotoSelect} />
                {photoFiles.length > 0 ? (
                  <Badge variant="secondary">{photoFiles.length} photo(s) selected</Badge>
                ) : null}
              </div>
              <ProductReturnReceiveVideoField
                key={openArrival.id}
                files={videoFiles}
                onChange={setVideoFiles}
                disabled={isOpening}
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  className="flex-1"
                  disabled={isOpening}
                  onClick={() => void handleOpenReceive()}
                >
                  {isOpening ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save counts
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isOpening}
                  onClick={() => setOpenArrival(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
