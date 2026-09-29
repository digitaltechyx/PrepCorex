"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Loader2, PackagePlus, ScanLine, Box, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  attachReturnArrivalReceiveMedia,
  createReturnArrivalId,
  deleteReturnArrival,
  logReturnArrival,
  normalizeReturnArrivals,
  openReceiveReturnArrival,
  returnArrivalStatusLabel,
  summarizeReturnArrivals,
  trackingKey,
  updateReturnArrivalUnitType,
} from "@/lib/product-return-arrivals";
import { ProductReturnArrivalsTimeline } from "@/components/product-returns/product-return-arrivals-timeline";
import { ReturnArrivalUnitTypeSelect } from "@/components/product-returns/return-arrival-unit-type-select";
import { PagedRows } from "@/components/product-returns/paged-rows";
import { uploadProductReturnReceivePhotos } from "@/lib/product-return-receive-photos";
import { importWarehouseCameraVideoFile } from "@/lib/warehouse-camera-client";
import { ProductReturnReceiveVideoField } from "@/components/admin/product-return-receive-video-field";
import { TrackingScanInput } from "@/components/admin/tracking-scan-input";
import { OnScreenKeyboardField } from "@/components/admin/on-screen-keyboard-field";
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

function trackingMatches(a: string, b: string): boolean {
  const left = trackingKey(a);
  const right = trackingKey(b);
  if (!left || !right) return false;
  return left === right;
}

type Props = {
  ownerUserId: string;
  clientDisplayName?: string;
  returnItem: ProductReturn & { id: string };
  operatorId: string;
  disabled?: boolean;
  onUpdated?: () => void;
  /** `log` = dock arrivals; `open` = scan + open & count */
  mode?: "log" | "open";
};

export function ProductReturnAdminReceiveWorkflow({
  ownerUserId,
  clientDisplayName,
  returnItem,
  operatorId,
  disabled,
  onUpdated,
  mode = "log",
}: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [trackingNumber, setTrackingNumber] = useState("");
  const [unitType, setUnitType] = useState<ReturnArrivalUnitType>(readStoredUnitType);
  const [arrivalNotes, setArrivalNotes] = useState("");
  const [isLogging, setIsLogging] = useState(false);
  const [deletingArrivalId, setDeletingArrivalId] = useState<string | null>(null);
  const [editingUnitTypeArrivalId, setEditingUnitTypeArrivalId] = useState<string | null>(null);

  const [openScan, setOpenScan] = useState("");
  const [openArrival, setOpenArrival] = useState<ReturnArrival | null>(null);
  const [mediaRetryArrival, setMediaRetryArrival] = useState<ReturnArrival | null>(null);
  const [goodQty, setGoodQty] = useState("");
  const [damagedQty, setDamagedQty] = useState("");
  const [openNotes, setOpenNotes] = useState("");
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [isOpening, setIsOpening] = useState(false);
  const [isAttachingMedia, setIsAttachingMedia] = useState(false);
  /** Optimistic received patches so the dock can scan the next parcel before Firestore finishes. */
  const [optimisticReceived, setOptimisticReceived] = useState<
    Record<string, Pick<ReturnArrival, "status" | "goodQty" | "damagedQty" | "notes">>
  >({});
  /** Newly logged arrivals not yet visible from props. */
  const [optimisticLogged, setOptimisticLogged] = useState<ReturnArrival[]>([]);
  /** Serializes background arrival writes so rapid scans do not race on returnArrivals. */
  const arrivalWriteQueueRef = useRef(Promise.resolve());

  const arrivals = useMemo(() => {
    const server = normalizeReturnArrivals(returnItem.returnArrivals).map((arrival) => {
      const patch = optimisticReceived[arrival.id];
      return patch ? { ...arrival, ...patch } : arrival;
    });
    const serverIds = new Set(server.map((a) => a.id));
    const serverKeys = new Set(
      server.map((a) => trackingKey(a.trackingNumber)).filter(Boolean)
    );
    const pendingLogged = optimisticLogged.filter((a) => {
      const key = trackingKey(a.trackingNumber);
      return !serverIds.has(a.id) && (!key || !serverKeys.has(key));
    });
    return [...server, ...pendingLogged];
  }, [returnItem.returnArrivals, optimisticReceived, optimisticLogged]);
  const summary = useMemo(() => summarizeReturnArrivals(arrivals), [arrivals]);
  const pendingOpen = useMemo(
    () => arrivals.filter((a) => a.status !== "received"),
    [arrivals]
  );

  // Drop optimistic patches once Firestore (via props) shows the arrival as received / logged.
  useEffect(() => {
    const server = normalizeReturnArrivals(returnItem.returnArrivals);
    setOptimisticReceived((prev) => {
      const ids = Object.keys(prev);
      if (ids.length === 0) return prev;
      let changed = false;
      const next = { ...prev };
      for (const id of ids) {
        const row = server.find((a) => a.id === id);
        if (row?.status === "received") {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setOptimisticLogged((prev) => {
      if (prev.length === 0) return prev;
      const serverIds = new Set(server.map((a) => a.id));
      const serverKeys = new Set(
        server.map((a) => trackingKey(a.trackingNumber)).filter(Boolean)
      );
      const next = prev.filter((a) => {
        const key = trackingKey(a.trackingNumber);
        return !serverIds.has(a.id) && (!key || !serverKeys.has(key));
      });
      return next.length === prev.length ? prev : next;
    });
  }, [returnItem.returnArrivals]);

  const handleLogArrival = () => {
    const tracking = trackingKey(trackingNumber);
    if (!tracking) {
      toast({
        variant: "destructive",
        title: "Tracking required",
        description: "Scan or enter the carrier tracking number.",
      });
      return;
    }

    if (arrivals.some((a) => trackingKey(a.trackingNumber) === tracking)) {
      toast({
        variant: "destructive",
        title: "Already logged",
        description: `${tracking} is already on this return. One tracking = one parcel.`,
      });
      return;
    }

    const notesSnapshot = arrivalNotes.trim() || undefined;
    const unitTypeSnapshot = unitType;
    const arrivalId = createReturnArrivalId();
    const optimisticArrival: ReturnArrival = {
      id: arrivalId,
      trackingNumber: tracking,
      unitType: unitTypeSnapshot,
      status: "arrived",
      arrivedAt: new Date().toISOString(),
      arrivedBy: operatorId,
      ...(notesSnapshot ? { notes: notesSnapshot } : {}),
    };

    setOptimisticLogged((prev) => [...prev, optimisticArrival]);
    setTrackingNumber("");
    setArrivalNotes("");
    setIsLogging(false);

    toast({
      title: "Queued",
      description: `${formatReturnArrivalUnitType(unitTypeSnapshot)} · ${tracking} — saving in background. Scan the next parcel.`,
    });

    arrivalWriteQueueRef.current = arrivalWriteQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          await logReturnArrival({
            ownerUserId,
            returnId: returnItem.id,
            trackingNumber: tracking,
            unitType: unitTypeSnapshot,
            operatorId,
            notes: notesSnapshot,
            arrivalId,
          });
          onUpdated?.();
          toast({
            title: "Arrival logged",
            description: `${formatReturnArrivalUnitType(unitTypeSnapshot)} · ${tracking}`,
          });
        } catch (err: unknown) {
          setOptimisticLogged((prev) => prev.filter((a) => a.id !== arrivalId));
          toast({
            variant: "destructive",
            title: "Could not log arrival",
            description: `${tracking}: ${err instanceof Error ? err.message : "Try again."}`,
          });
        }
      });
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

  const handleUpdateUnitType = async (
    arrival: ReturnArrival,
    unitType: ReturnArrivalUnitType
  ) => {
    if (arrival.unitType === unitType) return;
    setEditingUnitTypeArrivalId(arrival.id);
    try {
      await updateReturnArrivalUnitType({
        ownerUserId,
        returnId: returnItem.id,
        arrivalId: arrival.id,
        unitType,
      });
      if (openArrival?.id === arrival.id) {
        setOpenArrival({ ...openArrival, unitType });
      }
      toast({
        title: "Unit type updated",
        description: `${arrival.trackingNumber || "Parcel"} is now ${formatReturnArrivalUnitType(unitType).toLowerCase()}.`,
      });
      onUpdated?.();
    } catch (err: unknown) {
      toast({
        variant: "destructive",
        title: "Could not update unit type",
        description: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setEditingUnitTypeArrivalId(null);
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

  const resolveOpenScan = (raw: string) => {
    const tracking = trackingKey(raw);
    if (!tracking) {
      toast({
        variant: "destructive",
        title: "Tracking required",
        description: "Scan or enter the parcel tracking number.",
      });
      return;
    }

    const awaiting = pendingOpen.find((a) => trackingMatches(a.trackingNumber, tracking));
    if (awaiting) {
      setOpenScan("");
      startOpenReceive(awaiting);
      toast({
        title: "Parcel found",
        description: `${tracking} — ready to open & count.`,
      });
      return;
    }

    const alreadyCounted = arrivals.find(
      (a) => a.status === "received" && trackingMatches(a.trackingNumber, tracking)
    );
    if (alreadyCounted) {
      toast({
        variant: "destructive",
        title: "Already counted",
        description: `${tracking} was already opened and counted on this return.`,
      });
      return;
    }

    toast({
      variant: "destructive",
      title: "Not awaiting open",
      description: `${tracking} is not in the open queue for this return. Log it on Receive first if it just arrived.`,
    });
  };

  const startMediaRetry = (arrival: ReturnArrival) => {
    setMediaRetryArrival(arrival);
    setPhotoFiles([]);
    setVideoFiles([]);
  };

  const handleAttachMediaRetry = async () => {
    if (!mediaRetryArrival) return;
    if (photoFiles.length === 0 && videoFiles.length === 0) {
      toast({
        variant: "destructive",
        title: "Media required",
        description: "Select at least one photo or video to attach.",
      });
      return;
    }

    const arrivalSnapshot = mediaRetryArrival;
    const photosSnapshot = [...photoFiles];
    const videosSnapshot = [...videoFiles];

    setIsAttachingMedia(true);
    try {
      let receivePhotoUrls: string[] | undefined;
      if (photosSnapshot.length > 0) {
        receivePhotoUrls = await uploadProductReturnReceivePhotos({
          ownerUid: ownerUserId,
          returnId: returnItem.id,
          files: photosSnapshot,
        });
      }

      let videoSessionIds: string[] | undefined;
      if (videosSnapshot.length > 0) {
        if (!user) {
          throw new Error("Sign in again to upload the receive video to Google Drive.");
        }
        const ids: string[] = [];
        for (let index = 0; index < videosSnapshot.length; index += 1) {
          const session = await importWarehouseCameraVideoFile(user, {
            jobType: "return",
            clientUserId: ownerUserId,
            clientDisplayName: clientDisplayName?.trim() || ownerUserId,
            productReturnId: returnItem.id,
            returnArrivalId: arrivalSnapshot.id,
            warehouseId: "admin",
            warehouseLabel: "Admin",
            clipNumber: index + 1,
            file: videosSnapshot[index],
          });
          ids.push(session.id);
        }
        videoSessionIds = ids;
      }

      const photoCount = receivePhotoUrls?.length ?? 0;
      const videoCount = videoSessionIds?.length ?? 0;
      if (photoCount === 0 && videoCount === 0) {
        throw new Error("Upload did not return any media. Try again.");
      }

      await attachReturnArrivalReceiveMedia({
        ownerUserId,
        returnId: returnItem.id,
        arrivalId: arrivalSnapshot.id,
        receivePhotoUrls,
        videoSessionIds,
      });

      toast({
        title: "Media attached",
        description: [
          arrivalSnapshot.trackingNumber || "Parcel",
          photoCount > 0 ? `${photoCount} photo(s)` : null,
          videoCount > 0 ? `${videoCount} video(s)` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      });
      setMediaRetryArrival(null);
      setPhotoFiles([]);
      setVideoFiles([]);
      onUpdated?.();
    } catch (err: unknown) {
      toast({
        variant: "destructive",
        title: "Could not attach media",
        description: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setIsAttachingMedia(false);
    }
  };

  const handlePhotoSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? [...event.target.files] : [];
    event.target.value = "";
    if (files.length > 0) setPhotoFiles((prev) => [...prev, ...files]);
  };

  const handleOpenReceive = () => {
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

    const arrivalSnapshot = openArrival;
    const notesSnapshot = openNotes.trim() || undefined;
    const photosSnapshot = [...photoFiles];
    const videosSnapshot = [...videoFiles];
    const hasMedia = photosSnapshot.length > 0 || videosSnapshot.length > 0;

    // Optimistic UI: close immediately so the next parcel can be scanned.
    setOptimisticReceived((prev) => ({
      ...prev,
      [arrivalSnapshot.id]: {
        status: "received",
        goodQty: good,
        damagedQty: damaged,
        notes: notesSnapshot || arrivalSnapshot.notes,
      },
    }));
    setOpenArrival(null);
    setPhotoFiles([]);
    setVideoFiles([]);
    setGoodQty("");
    setDamagedQty("");
    setOpenNotes("");
    setIsOpening(false);

    toast({
      title: "Queued",
      description: hasMedia
        ? `Good ${good}, damaged ${damaged} for ${arrivalSnapshot.trackingNumber || "parcel"} — saving + media in background. Scan the next parcel.`
        : `Good ${good}, damaged ${damaged} for ${arrivalSnapshot.trackingNumber || "parcel"} — saving in background. Scan the next parcel.`,
    });

    arrivalWriteQueueRef.current = arrivalWriteQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        let countsSaved = false;
        try {
          await openReceiveReturnArrival({
            ownerUserId,
            returnId: returnItem.id,
            arrivalId: arrivalSnapshot.id,
            goodQty: good,
            damagedQty: damaged,
            operatorId,
            notes: notesSnapshot,
          });
          countsSaved = true;
          onUpdated?.();

          if (!hasMedia) {
            toast({
              title: "Counts saved",
              description: `${arrivalSnapshot.trackingNumber || "Parcel"} · good ${good}, damaged ${damaged}.`,
            });
            return;
          }

          let receivePhotoUrls: string[] | undefined;
          if (photosSnapshot.length > 0) {
            receivePhotoUrls = await uploadProductReturnReceivePhotos({
              ownerUid: ownerUserId,
              returnId: returnItem.id,
              files: photosSnapshot,
            });
          }

          let videoSessionIds: string[] | undefined;
          if (videosSnapshot.length > 0) {
            if (!user) {
              throw new Error("Sign in again to upload the receive video to Google Drive.");
            }
            const ids: string[] = [];
            for (let index = 0; index < videosSnapshot.length; index += 1) {
              const session = await importWarehouseCameraVideoFile(user, {
                jobType: "return",
                clientUserId: ownerUserId,
                clientDisplayName: clientDisplayName?.trim() || ownerUserId,
                productReturnId: returnItem.id,
                returnArrivalId: arrivalSnapshot.id,
                warehouseId: "admin",
                warehouseLabel: "Admin",
                clipNumber: index + 1,
                file: videosSnapshot[index],
              });
              ids.push(session.id);
            }
            videoSessionIds = ids;
          }

          const photoCount = receivePhotoUrls?.length ?? 0;
          const videoCount = videoSessionIds?.length ?? 0;
          if (photoCount === 0 && videoCount === 0) {
            toast({
              variant: "destructive",
              title: "Media upload failed",
              description: `Counts are saved for ${arrivalSnapshot.trackingNumber || "parcel"}. Use Retry media on that arrival.`,
            });
            return;
          }

          await attachReturnArrivalReceiveMedia({
            ownerUserId,
            returnId: returnItem.id,
            arrivalId: arrivalSnapshot.id,
            receivePhotoUrls,
            videoSessionIds,
          });

          toast({
            title: "Saved with media",
            description: [
              arrivalSnapshot.trackingNumber || "Parcel",
              `good ${good}`,
              `damaged ${damaged}`,
              photoCount > 0 ? `${photoCount} photo(s)` : null,
              videoCount > 0 ? `${videoCount} video(s)` : null,
            ]
              .filter(Boolean)
              .join(" · "),
          });
          onUpdated?.();
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Try again.";
          if (!countsSaved) {
            setOptimisticReceived((prev) => {
              const next = { ...prev };
              delete next[arrivalSnapshot.id];
              return next;
            });
            toast({
              variant: "destructive",
              title: "Count save failed",
              description: `${arrivalSnapshot.trackingNumber || "Parcel"}: ${message} Scan it again to retry.`,
            });
            return;
          }
          toast({
            variant: "destructive",
            title: "Media upload failed",
            description: `${message} Counts are saved — use Retry media on that arrival.`,
          });
        }
      });
  };

  const canUse =
    !disabled &&
    (returnItem.status === "approved" || returnItem.status === "in_progress");

  const openReceiveDialog = (
    <Dialog open={!!openArrival} onOpenChange={(open) => !open && setOpenArrival(null)}>
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Open receive</DialogTitle>
          <DialogDescription>
            Count good and damaged units for this{" "}
            {openArrival ? formatReturnArrivalUnitType(openArrival.unitType).toLowerCase() : "unit"}.
            Damaged qty follows the same inbound rules (not sellable). Photos/video upload in the
            background after Save so you can scan the next parcel right away.
          </DialogDescription>
        </DialogHeader>
        {openArrival ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="rounded-md bg-muted/50 px-3 py-2 text-sm font-mono break-all">
                {openArrival.trackingNumber}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Label className="text-xs text-muted-foreground">Unit type</Label>
                <ReturnArrivalUnitTypeSelect
                  value={openArrival.unitType}
                  saving={editingUnitTypeArrivalId === openArrival.id}
                  disabled={isOpening}
                  onChange={(unitType) => void handleUpdateUnitType(openArrival, unitType)}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2 min-w-0">
                <Label>Good qty</Label>
                <OnScreenKeyboardField
                  mode="numeric"
                  value={goodQty}
                  onChange={setGoodQty}
                  disabled={isOpening}
                  placeholder="0"
                  autoFocus
                />
              </div>
              <div className="space-y-2 min-w-0">
                <Label>Damaged qty</Label>
                <OnScreenKeyboardField
                  mode="numeric"
                  value={damagedQty}
                  onChange={setDamagedQty}
                  disabled={isOpening}
                  placeholder="0"
                  inputClassName="border-red-200"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <OnScreenKeyboardField
                mode="text"
                multiline
                rows={2}
                value={openNotes}
                onChange={setOpenNotes}
                disabled={isOpening}
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
  );

  const mediaRetryDialog = (
    <Dialog
      open={!!mediaRetryArrival}
      onOpenChange={(open) => {
        if (!open && !isAttachingMedia) {
          setMediaRetryArrival(null);
          setPhotoFiles([]);
          setVideoFiles([]);
        }
      }}
    >
      <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Retry / add media</DialogTitle>
          <DialogDescription>
            Counts stay as saved. Attach photos or video for{" "}
            <span className="font-mono">
              {mediaRetryArrival?.trackingNumber || "this parcel"}
            </span>
            .
          </DialogDescription>
        </DialogHeader>
        {mediaRetryArrival ? (
          <div className="space-y-4">
            <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
              <p className="font-mono break-all">{mediaRetryArrival.trackingNumber}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Good {mediaRetryArrival.goodQty ?? 0} · Damaged {mediaRetryArrival.damagedQty ?? 0}
                {(mediaRetryArrival.receivePhotoUrls?.length ?? 0) > 0
                  ? ` · ${mediaRetryArrival.receivePhotoUrls!.length} photo(s) already`
                  : ""}
              </p>
            </div>
            <div className="space-y-2">
              <Label>Photos</Label>
              <Input
                type="file"
                accept="image/*"
                multiple
                disabled={isAttachingMedia}
                onChange={handlePhotoSelect}
              />
              {photoFiles.length > 0 ? (
                <Badge variant="secondary">{photoFiles.length} photo(s) selected</Badge>
              ) : null}
            </div>
            <ProductReturnReceiveVideoField
              key={`media-retry-${mediaRetryArrival.id}`}
              files={videoFiles}
              onChange={setVideoFiles}
              disabled={isAttachingMedia}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                className="flex-1"
                disabled={
                  isAttachingMedia || (photoFiles.length === 0 && videoFiles.length === 0)
                }
                onClick={() => void handleAttachMediaRetry()}
              >
                {isAttachingMedia ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Upload media
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={isAttachingMedia}
                onClick={() => {
                  setMediaRetryArrival(null);
                  setPhotoFiles([]);
                  setVideoFiles([]);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );

  if (mode === "open") {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border bg-card px-4 py-3 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold">Open receive</h4>
              <p className="mt-1 text-xs text-muted-foreground">
                Scan a parcel to open & count it immediately, or pick from the awaiting-open list.
                Tap unit type in the timeline to fix package/carton/pallet without re-scanning.
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold tabular-nums text-amber-950">
                {summary.arrivedOnly} awaiting
              </p>
              {summary.receivedUnits > 0 ? (
                <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                  {summary.receivedUnits} counted
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {arrivals.length > 0 ? (
          <ProductReturnArrivalsTimeline
            returnItem={{ ...returnItem, returnArrivals: arrivals }}
            compact
            onDeleteArrival={canUse ? (arrival) => void handleDeleteArrival(arrival) : undefined}
            deletingArrivalId={deletingArrivalId}
            onEditUnitType={
              canUse
                ? (arrival, unitType) => void handleUpdateUnitType(arrival, unitType)
                : undefined
            }
            editingUnitTypeArrivalId={editingUnitTypeArrivalId}
            onAttachMedia={canUse ? startMediaRetry : undefined}
            attachingMediaArrivalId={isAttachingMedia ? mediaRetryArrival?.id ?? null : null}
          />
        ) : null}

        {canUse ? (
          <>
            <div className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
                  <ScanLine className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold">Scan parcel</p>
                  <p className="text-xs text-muted-foreground">
                    Matching tracking opens the count form automatically.
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Tracking number</Label>
                <TrackingScanInput
                  value={openScan}
                  onChange={setOpenScan}
                  onSubmit={(raw) => resolveOpenScan(raw)}
                  autoFocus
                  disabled={isOpening}
                  camera={{
                    disabled: isOpening,
                    scannerTitle: "Scan parcel for open receive",
                    scannerDescription:
                      "Aim at the long shipping barcode (same as Trackers). Address QR is ignored. A Bluetooth scanner can still type into the box.",
                    onScan: (value) => {
                      const next = trackingKey(value);
                      setOpenScan(next);
                      resolveOpenScan(next);
                    },
                  }}
                />
              </div>
              <Button
                type="button"
                onClick={() => resolveOpenScan(openScan)}
                disabled={isOpening || !openScan.trim()}
                className="w-full sm:w-auto"
              >
                <Box className="mr-2 h-4 w-4" />
                Find & open
              </Button>
            </div>

            {pendingOpen.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-semibold">
                  Awaiting open ({pendingOpen.length})
                </p>
                <PagedRows items={pendingOpen}>
                  {(pageRows) => (
                    <div className="space-y-2">
                      {pageRows.map((arrival) => (
                        <div
                          key={arrival.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border bg-card px-3 py-2.5 shadow-sm"
                        >
                          <div className="text-sm min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-mono">{arrival.trackingNumber || "—"}</span>
                            <ReturnArrivalUnitTypeSelect
                              value={arrival.unitType}
                              saving={editingUnitTypeArrivalId === arrival.id}
                              disabled={Boolean(deletingArrivalId) || isOpening}
                              onChange={(unitType) => void handleUpdateUnitType(arrival, unitType)}
                            />
                            <span className="text-muted-foreground">
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
              <p className="text-sm text-muted-foreground">
                All logged arrivals have been counted.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                No parcels awaiting open. Log arrivals on the Receive tab first.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Approve this return to open & count arrivals.
          </p>
        )}

        {openReceiveDialog}
        {mediaRetryDialog}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border bg-card px-4 py-3 shadow-sm">
        <h4 className="text-sm font-semibold">Receive workflow</h4>
        <p className="mt-1 text-xs text-muted-foreground">
          Log each physical parcel once (one tracking = one parcel). Wrong scans can be deleted
          from the timeline; tap unit type on any arrival to fix package/carton/pallet. Use Open
          receive to scan and count units.
        </p>
      </div>

      <ProductReturnArrivalsTimeline
        returnItem={{ ...returnItem, returnArrivals: arrivals }}
        onDeleteArrival={canUse ? (arrival) => void handleDeleteArrival(arrival) : undefined}
        deletingArrivalId={deletingArrivalId}
        onEditUnitType={
          canUse
            ? (arrival, unitType) => void handleUpdateUnitType(arrival, unitType)
            : undefined
        }
        editingUnitTypeArrivalId={editingUnitTypeArrivalId}
        onAttachMedia={canUse ? startMediaRetry : undefined}
        attachingMediaArrivalId={isAttachingMedia ? mediaRetryArrival?.id ?? null : null}
      />

      {canUse ? (
        <div className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
                <ScanLine className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">Log arrival</p>
                <p className="text-xs text-muted-foreground">
                  One tracking number per parcel — duplicates are blocked. Unit type stays
                  selected until you change it.
                </p>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className="rounded-full bg-violet-100 px-3 py-1 text-sm font-semibold tabular-nums text-violet-900">
                {summary.totalArrivals} arrived
              </p>
              {summary.arrivedOnly > 0 ? (
                <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                  {summary.arrivedOnly} awaiting open
                </p>
              ) : summary.receivedUnits > 0 ? (
                <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                  {summary.receivedUnits} counted
                </p>
              ) : null}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Tracking number</Label>
              <TrackingScanInput
                value={trackingNumber}
                onChange={setTrackingNumber}
                onSubmit={() => void handleLogArrival()}
                disabled={isLogging}
                camera={{
                  disabled: isLogging,
                  scannerTitle: "Scan return tracking",
                  scannerDescription:
                    "Aim at the long shipping barcode (same as Trackers). Address QR is ignored. A Bluetooth scanner can still type into the box.",
                  onScan: (value) => setTrackingNumber(trackingKey(value)),
                }}
              />
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
              <OnScreenKeyboardField
                mode="text"
                value={arrivalNotes}
                onChange={setArrivalNotes}
                disabled={isLogging}
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
      ) : (
        <p className="text-sm text-muted-foreground">
          Approve this return to log arrivals and open receive.
        </p>
      )}

      {mediaRetryDialog}
    </div>
  );
}
