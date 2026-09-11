"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  TRACKER_LABEL_PHOTOS_MAX,
  uploadTrackerLabelPhoto,
  validateTrackerLabelPhotoFile,
} from "@/lib/tracker-label-photos";
import type { TrackerLabelPhoto } from "@/types";
import { ImagePlus, Images, Loader2 } from "lucide-react";

type TrackerKind = "inbound" | "outbound";

function formatPhotoDate(photo: TrackerLabelPhoto): string {
  const raw = photo.uploadedAt;
  if (!raw) return "";
  try {
    const d =
      typeof raw === "object" && raw !== null && "seconds" in raw
        ? new Date(raw.seconds * 1000)
        : new Date(raw as string | Date);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    if (data.error) return data.error;
  } catch {
    // ignore
  }
  return fallback;
}

type Props = {
  kind: TrackerKind;
  entryId: string;
  trackingNumber: string;
  photos: TrackerLabelPhoto[];
  disabled?: boolean;
  getAuthHeaders: () => Promise<HeadersInit>;
  onPhotosUpdated: (photos: TrackerLabelPhoto[]) => void;
};

export function TrackerLabelPhotosCell({
  kind,
  entryId,
  trackingNumber,
  photos,
  disabled,
  getAuthHeaders,
  onPhotosUpdated,
}: Props) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const photoCount = photos.length;
  const atLimit = photoCount >= TRACKER_LABEL_PHOTOS_MAX;

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;

      const remaining = TRACKER_LABEL_PHOTOS_MAX - photoCount;
      if (remaining <= 0) {
        toast({
          variant: "destructive",
          title: "Photo limit reached",
          description: `Maximum ${TRACKER_LABEL_PHOTOS_MAX} photos per tracking.`,
        });
        return;
      }

      setUploading(true);
      let latestPhotos = [...photos];

      try {
        const headers = await getAuthHeaders();
        const apiPath =
          kind === "inbound" ? "/api/inbound-tracker/photos" : "/api/outbound-tracking/photos";

        for (const file of list.slice(0, remaining)) {
          const validationError = validateTrackerLabelPhotoFile(file);
          if (validationError) {
            toast({ variant: "destructive", title: "Invalid file", description: validationError });
            continue;
          }

          const url = await uploadTrackerLabelPhoto({ kind, entryId, file });
          const res = await fetch(apiPath, {
            method: "POST",
            headers,
            body: JSON.stringify({ id: entryId, url }),
          });
          if (!res.ok) {
            throw new Error(await readApiError(res, "Failed to save photo."));
          }
          const data = (await res.json()) as { entry?: { labelPhotos?: TrackerLabelPhoto[] } };
          latestPhotos = data.entry?.labelPhotos || latestPhotos;
        }

        onPhotosUpdated(latestPhotos);
        toast({
          title: "Photo uploaded",
          description: `Saved for ${trackingNumber}.`,
        });
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Upload failed",
          description: e instanceof Error ? e.message : "Could not upload photo.",
        });
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [photoCount, photos, kind, entryId, trackingNumber, getAuthHeaders, onPhotosUpdated, toast]
  );

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="relative h-8 w-8"
        disabled={disabled}
        onClick={() => setOpen(true)}
        title={photoCount > 0 ? `View ${photoCount} label photo(s)` : "Add label photo (optional)"}
      >
        {photoCount > 0 ? (
          <Images className="h-4 w-4 text-primary" />
        ) : (
          <ImagePlus className="h-4 w-4 text-muted-foreground" />
        )}
        {photoCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
            {photoCount}
          </span>
        ) : null}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Label photos</DialogTitle>
            <DialogDescription>
              Optional photos for{" "}
              <span className="font-mono font-medium text-foreground">{trackingNumber}</span>.
              Upload anytime after adding tracking.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {photoCount === 0 ? (
              <p className="text-sm text-muted-foreground">No photos yet.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {photos.map((photo, index) => (
                  <button
                    key={`${photo.url}-${index}`}
                    type="button"
                    className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
                    onClick={() => setPreviewUrl(photo.url)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.url}
                      alt={`Label photo ${index + 1}`}
                      className="h-full w-full object-cover transition group-hover:scale-105"
                    />
                    {(photo.uploadedByName || formatPhotoDate(photo)) && (
                      <span className="absolute inset-x-0 bottom-0 bg-black/55 px-1.5 py-1 text-left text-[10px] leading-tight text-white">
                        {photo.uploadedByName ? <span>{photo.uploadedByName}</span> : null}
                        {formatPhotoDate(photo) ? (
                          <span className={cn(photo.uploadedByName && "block opacity-80")}>
                            {formatPhotoDate(photo)}
                          </span>
                        ) : null}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                multiple
                disabled={uploading || atLimit}
                onChange={(e) => {
                  if (e.target.files?.length) void uploadFiles(e.target.files);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading || atLimit}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ImagePlus className="mr-2 h-4 w-4" />
                )}
                {uploading ? "Uploading…" : atLimit ? "Photo limit reached" : "Upload photo"}
              </Button>
              <span className="text-xs text-muted-foreground">
                {photoCount}/{TRACKER_LABEL_PHOTOS_MAX} photos
              </span>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!previewUrl} onOpenChange={(next) => !next && setPreviewUrl(null)}>
        <DialogContent className="max-w-3xl p-2 sm:p-4">
          {previewUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={previewUrl}
              alt="Label photo preview"
              className="max-h-[75vh] w-full rounded-md object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
