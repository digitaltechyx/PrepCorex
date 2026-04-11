"use client";

import { useMemo, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Truck, ExternalLink } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";

const MAX_TRACKING_IDS = 20;

function parseTrackingNumbers(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\n,;]+/)) {
    const t = part.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.slice(0, MAX_TRACKING_IDS);
}

function formatDateTime(value: unknown) {
  if (!value) return "";
  let date: Date | null = null;
  if (typeof value === "string" || typeof value === "number") {
    date = new Date(value);
  } else if (typeof value === "object" && value !== null) {
    const o = value as Record<string, unknown>;
    if ("seconds" in o && typeof o.seconds === "number") {
      date = new Date(o.seconds * 1000);
    } else if ("_seconds" in o && typeof (o as { _seconds: number })._seconds === "number") {
      date = new Date((o as { _seconds: number })._seconds * 1000);
    }
  }
  if (!date || isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatStatus(status: string | undefined): string {
  if (!status) return "Update";
  const statusLower = status.toLowerCase();

  if (statusLower.includes("delivered")) return "Delivered";
  if (statusLower.includes("out_for_delivery") || statusLower.includes("out for delivery"))
    return "Out for Delivery";
  if (statusLower.includes("arrived_at_post_office") || statusLower.includes("arrived at post office"))
    return "Arrived at Post Office";
  if (statusLower.includes("arrived_at_usps") || statusLower.includes("arrived at usps"))
    return "Arrived at USPS Regional Facility";
  if (statusLower.includes("in_transit") || statusLower.includes("in transit"))
    return "In Transit to Next Facility";
  if (statusLower.includes("departed") || statusLower.includes("departed usps"))
    return "Departed USPS Facility";
  if (statusLower.includes("arrived_at_facility") || statusLower.includes("arrived at facility"))
    return "Arrived at USPS Facility";
  if (statusLower.includes("pre_transit") || statusLower.includes("pre transit")) return "Label Created";
  if (statusLower.includes("transit")) return "In Transit";

  return status
    .split(/[_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function getTimelineDate(event: Record<string, unknown>) {
  return (
    event?.status_date ||
    event?.timestamp ||
    event?.date ||
    event?.object_created ||
    event?.created_at
  );
}

function getProgressValue(statusRaw: string | undefined) {
  if (!statusRaw) return 12;
  const status = statusRaw.toLowerCase();
  if (status.includes("delivered")) return 100;
  if (status.includes("out_for_delivery")) return 85;
  if (status.includes("transit")) return 65;
  if (status.includes("pre_transit")) return 40;
  if (status.includes("unknown")) return 20;
  return 50;
}

type TrackResult = {
  id: string;
  success: boolean;
  tracking?: Record<string, unknown>;
  error?: string;
};

function TrackingTimelineCard({
  declaredId,
  trackingData,
}: {
  declaredId: string;
  trackingData: Record<string, unknown>;
}) {
  const rawStatus = (trackingData?.tracking_status as { status?: string } | undefined)?.status;
  const rawStatusDetails = (trackingData?.tracking_status as { status_details?: string } | undefined)
    ?.status_details;

  const looksUnknown = useMemo(() => {
    const statusUpper = rawStatus?.toUpperCase();
    return (
      !(trackingData?.tracking_status as object) ||
      statusUpper === "UNKNOWN" ||
      (rawStatusDetails && rawStatusDetails.toLowerCase().includes("not found"))
    );
  }, [trackingData, rawStatus, rawStatusDetails]);

  const timelineEvents = (trackingData?.tracking_history as unknown[]) ?? [];
  const progressValue = getProgressValue(rawStatus);

  const statusMessage = looksUnknown
    ? "We couldn't find any tracking information for this tracking number. Please double-check the number and carrier."
    : "Latest status for this tracking number.";

  const latestLocation =
    (trackingData?.tracking_status as { location?: Record<string, string> } | undefined)?.location ||
    (timelineEvents[0] as { location?: Record<string, string> } | undefined)?.location;
  const latestLocationText = latestLocation
    ? [latestLocation.city, latestLocation.state || latestLocation.zip].filter(Boolean).join(", ")
    : "";

  const displayId = (trackingData.tracking_number as string) || declaredId;

  return (
    <Card className="border border-white/20 bg-slate-950 text-slate-50 shadow-2xl shadow-slate-950/40 rounded-2xl">
      <CardContent className="space-y-6 p-6">
        <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4 space-y-3">
          <div className="text-xs uppercase text-slate-400">Tracking number</div>
          <div className="font-mono text-base font-semibold text-white">{displayId}</div>
          {trackingData.eta && (
            <div className="text-sm font-semibold text-emerald-400">
              Expected delivery {formatDateTime(trackingData.eta)}
            </div>
          )}
          {rawStatus && (
            <div className="inline-flex items-center rounded-full border border-emerald-500/50 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-300">
              {rawStatus}
            </div>
          )}
          <p className="text-xs text-slate-400">{statusMessage}</p>
          {latestLocationText && (
            <p className="text-xs text-slate-400">
              Latest scan: <span className="text-slate-100">{latestLocationText}</span>
            </p>
          )}
          <div className="pt-3">
            <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-slate-500">
              <span>Label created</span>
              <span>Delivered</span>
            </div>
            <Progress value={progressValue} className="mt-2 h-2 bg-slate-800" />
          </div>
        </div>

        {timelineEvents.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-4">
              Tracking History
            </p>
            <div className="relative">
              <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-blue-600" />
              <div className="space-y-6 pl-8">
                {timelineEvents.slice(0, 10).map((event: unknown, idx: number) => {
                  const ev = event as Record<string, unknown>;
                  const location = (ev?.location || {}) as Record<string, string>;
                  const locationText = [location.city, location.state, location.zip, location.facility_name]
                    .filter(Boolean)
                    .join(", ");
                  const dateText = formatDateTime(getTimelineDate(ev));
                  const statusText = formatStatus(ev.status as string | undefined);
                  const isDelivered = statusText.toLowerCase().includes("delivered") && idx === 0;

                  return (
                    <div key={idx} className="relative">
                      <div
                        className={`absolute -left-9 top-1 h-4 w-4 rounded-full border-2 ${
                          isDelivered ? "bg-green-500 border-green-500" : "bg-blue-600 border-blue-600"
                        }`}
                      />
                      <div className="space-y-1">
                        <p className="text-sm font-bold text-white">{statusText}</p>
                        {ev.status_details && (
                          <p className="text-xs text-slate-300">{String(ev.status_details)}</p>
                        )}
                        {locationText && <p className="text-xs text-slate-400">{locationText}</p>}
                        {dateText && <p className="text-xs text-slate-400">{dateText}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function TrackShipmentPage() {
  const [carrier, setCarrier] = useState<string>("usps");
  const [trackingInput, setTrackingInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<TrackResult[] | null>(null);

  const parsedIds = useMemo(() => parseTrackingNumbers(trackingInput), [trackingInput]);
  const rawCount = useMemo(() => {
    return trackingInput
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean).length;
  }, [trackingInput]);
  const truncated = rawCount > MAX_TRACKING_IDS;

  const handleTrack = async () => {
    const ids = parseTrackingNumbers(trackingInput);
    if (ids.length === 0) return;

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const settled = await Promise.all(
        ids.map(async (id): Promise<TrackResult> => {
          try {
            const res = await fetch("/api/shippo/track", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ trackingNumber: id, carrier }),
            });
            const data = (await res.json()) as {
              success?: boolean;
              tracking?: Record<string, unknown>;
              error?: string;
              details?: string;
            };
            if (!res.ok || !data.success) {
              return {
                id,
                success: false,
                error: data.details || data.error || "Failed to get tracking information.",
              };
            }
            return { id, success: true, tracking: data.tracking };
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Something went wrong.";
            return { id, success: false, error: msg };
          }
        })
      );
      setResults(settled);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong while fetching tracking data.");
    } finally {
      setLoading(false);
    }
  };

  const isDisabled = parsedIds.length === 0 || loading;

  const successCount = results?.filter((r) => r.success).length ?? 0;

  return (
    <div className="container mx-auto max-w-3xl py-8 space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-3xl font-bold tracking-tight">
          <span className="bg-gradient-to-r from-indigo-600 via-violet-600 to-sky-500 bg-clip-text text-transparent">
            Track Shipment
          </span>
        </h1>
        <p className="text-sm text-muted-foreground">
          Enter one or more tracking numbers (same carrier). Use a new line or commas between IDs — up to{" "}
          {MAX_TRACKING_IDS} at once.
        </p>
      </div>

      <Card className="shadow-md border border-border/70 rounded-2xl bg-white">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
              <Truck className="h-4 w-4" />
            </span>
            <span className="text-lg">Track your labels</span>
          </CardTitle>
          <CardDescription>
            Works with USPS, UPS, FedEx, DHL and other major carriers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="space-y-4">
            <div className="space-y-2 max-w-xs">
              <Label
                htmlFor="carrier"
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Carrier
              </Label>
              <Select value={carrier} onValueChange={setCarrier}>
                <SelectTrigger id="carrier">
                  <SelectValue placeholder="Select carrier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="usps">USPS</SelectItem>
                  <SelectItem value="ups">UPS</SelectItem>
                  <SelectItem value="fedex">FedEx</SelectItem>
                  <SelectItem value="dhl">DHL</SelectItem>
                  <SelectItem value="other">Other / Unknown</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label
                  htmlFor="tracking-numbers"
                  className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Tracking number(s)
                </Label>
                {parsedIds.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {parsedIds.length} ID{parsedIds.length !== 1 ? "s" : ""}
                    {truncated ? ` (max ${MAX_TRACKING_IDS} applied)` : ""}
                  </span>
                )}
              </div>
              <Textarea
                id="tracking-numbers"
                value={trackingInput}
                onChange={(e) => setTrackingInput(e.target.value)}
                placeholder={"9200 1903 96…\n1Z999AA10123456784\n7946 0898 7564"}
                rows={5}
                className="font-mono text-sm tracking-wide resize-y min-h-[100px]"
              />
            </div>
          </div>

          <Button
            type="button"
            onClick={handleTrack}
            disabled={isDisabled}
            className="w-full sm:w-auto px-6"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Tracking {parsedIds.length} shipment{parsedIds.length !== 1 ? "s" : ""}…
              </>
            ) : (
              <>
                <ExternalLink className="mr-2 h-4 w-4" />
                Track {parsedIds.length === 0 ? "Shipment" : `${parsedIds.length} shipment${parsedIds.length !== 1 ? "s" : ""}`}
              </>
            )}
          </Button>

          {error && (
            <Alert variant="destructive" className="mt-2">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {results && results.length > 0 ? (
        <div className="space-y-4">
          <p className="text-center text-sm text-muted-foreground">
            {successCount} of {results.length} tracked successfully
            {successCount < results.length ? " — see errors below." : "."}
          </p>
          <div className="space-y-6">
            {results.map((r) =>
              r.success && r.tracking ? (
                <TrackingTimelineCard key={r.id} declaredId={r.id} trackingData={r.tracking} />
              ) : (
                <Card
                  key={r.id}
                  className="shadow-md border border-destructive/30 rounded-2xl bg-white"
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-mono">{r.id}</CardTitle>
                    <CardDescription>Could not load tracking</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Alert variant="destructive">
                      <AlertDescription>{r.error || "Unknown error"}</AlertDescription>
                    </Alert>
                  </CardContent>
                </Card>
              )
            )}
          </div>
        </div>
      ) : (
        <Card className="shadow-md border border-border/70 rounded-2xl bg-white">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Tracking details</CardTitle>
            <CardDescription>
              Results will appear here after you track. You can paste several tracking numbers at once.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Enter one ID per line or separate them with commas, choose the carrier, then click Track.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
