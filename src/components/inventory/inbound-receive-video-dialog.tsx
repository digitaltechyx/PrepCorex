"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";
import { Loader2, Radio, Video } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  getWarehouseCameraToken,
  listWarehouseCameraSessions,
  warehouseCameraPlaybackUrl,
} from "@/lib/warehouse-camera-client";
import {
  isWarehouseCameraSessionActive,
  warehouseCameraSessionHasPlayback,
  warehouseCameraSessionProductLabel,
  type WarehouseCameraSession,
} from "@/lib/warehouse-camera-types";

type Props = {
  requestId: string;
  clientUserId?: string;
  compact?: boolean;
  triggerLabel?: string;
};

function sessionStatus(session: WarehouseCameraSession): string {
  if (
    (session.status === "live" || session.status === "paused") &&
    !isWarehouseCameraSessionActive(session)
  ) {
    return "Live session ended";
  }
  if (session.status === "live") return "Live now";
  if (session.status === "paused") return "Recording paused";
  if (session.status === "uploaded") return "Ready to watch";
  if (session.status === "uploading") return "Uploading";
  if (session.status === "upload_failed") return "Upload needs retry";
  if (session.status === "stopped") return "Waiting for Drive upload";
  return "Discarded";
}

export function InboundReceiveVideoDialog({
  requestId,
  clientUserId,
  compact = false,
  triggerLabel,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const roomRef = useRef<Room | null>(null);
  const connectedSessionRef = useRef("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState<WarehouseCameraSession[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [watchingId, setWatchingId] = useState<string | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState("");

  const disconnect = useCallback(() => {
    roomRef.current?.disconnect();
    roomRef.current = null;
    connectedSessionRef.current = "";
    if (liveVideoRef.current) liveVideoRef.current.srcObject = null;
  }, []);

  const connectLive = useCallback(
    async (liveSession: WarehouseCameraSession) => {
      if (!user || connectedSessionRef.current === liveSession.id) return;
      disconnect();
      setConnecting(true);
      try {
        const access = await getWarehouseCameraToken(user, liveSession.id, "viewer");
        const room = new Room({ adaptiveStream: true, dynacast: true });
        room.on(
          RoomEvent.TrackSubscribed,
          (track: RemoteTrack) => {
            if (track.kind === Track.Kind.Video && liveVideoRef.current) {
              track.attach(liveVideoRef.current);
            }
          }
        );
        room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => track.detach());
        await room.connect(access.url, access.token);
        roomRef.current = room;
        connectedSessionRef.current = liveSession.id;
      } catch (error) {
        disconnect();
        toast({
          variant: "destructive",
          title: "Live video unavailable",
          description: error instanceof Error ? error.message : "Try again.",
        });
      } finally {
        setConnecting(false);
      }
    },
    [disconnect, toast, user]
  );

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const rows = await listWarehouseCameraSessions(user, {
        requestId,
        clientUserId,
      });
      setSessions(rows);
      const active = rows.find((row) => isWarehouseCameraSessionActive(row));
      if (active) {
        setWatchingId(null);
        await connectLive(active);
      } else {
        disconnect();
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not load receive videos",
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setLoading(false);
    }
  }, [clientUserId, connectLive, disconnect, requestId, toast, user]);

  useEffect(() => {
    if (!open) {
      disconnect();
      setWatchingId(null);
      setPlaybackUrl("");
      return;
    }
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !watchingId) void refresh();
    }, 5000);
    return () => {
      window.clearInterval(timer);
      disconnect();
    };
  }, [disconnect, open, refresh, watchingId]);

  useEffect(() => {
    if (!user || !watchingId) {
      setPlaybackUrl("");
      return;
    }
    let cancelled = false;
    void user.getIdToken().then((token) => {
      if (!cancelled) setPlaybackUrl(warehouseCameraPlaybackUrl(watchingId, token));
    });
    return () => {
      cancelled = true;
    };
  }, [user, watchingId]);

  const active = sessions.find((row) => isWarehouseCameraSessionActive(row));
  const uploaded = sessions.filter(warehouseCameraSessionHasPlayback);
  const watching = sessions.find((row) => row.id === watchingId) ?? null;
  const productLabel = (active || watching || sessions[0])
    ? warehouseCameraSessionProductLabel(active || watching || sessions[0])
    : "this inbound request";
  const buttonLabel =
    triggerLabel ||
    (uploaded.length > 0 && !active ? "Watch receiving video" : "Receive video");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size={compact ? "icon" : "sm"}
          title={buttonLabel}
        >
          <Video className={compact ? "h-4 w-4" : "mr-1.5 h-4 w-4"} />
          {!compact ? buttonLabel : null}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Receiving video</DialogTitle>
          <DialogDescription>
            Live warehouse camera and uploaded clips for {productLabel}.
          </DialogDescription>
        </DialogHeader>

        {loading && sessions.length === 0 ? (
          <div className="flex min-h-48 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading…
          </div>
        ) : active ? (
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded-xl bg-black">
              <video
                ref={liveVideoRef}
                autoPlay
                playsInline
                controls={false}
                className="aspect-video w-full object-contain"
              />
              <Badge className="absolute left-3 top-3 gap-1 bg-red-600 text-white hover:bg-red-600">
                <Radio className="h-3 w-3" />
                {active.status === "paused" ? "PAUSED" : "LIVE"}
              </Badge>
              {connecting ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Connecting…
                </div>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              Session {active.clipNumber} · {active.operatorName} · {active.warehouseLabel}
            </p>
            <p className="text-sm text-muted-foreground">Request: {productLabel}</p>
          </div>
        ) : watching && playbackUrl ? (
          <div className="space-y-3">
            <video
              key={playbackUrl}
              controls
              playsInline
              className="aspect-video w-full rounded-xl bg-black object-contain"
              src={playbackUrl}
            />
            <p className="text-sm text-muted-foreground">
              Session {watching.clipNumber} · {watching.operatorName} · {productLabel}
            </p>
          </div>
        ) : sessions.length > 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <Video className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
            <p className="font-medium">Live session ended for {productLabel}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {uploaded.length > 0
                ? "Choose a session below to watch the uploaded receiving video."
                : "The warehouse still needs to upload this clip to Drive before it can be watched."}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <Video className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No live receiving video</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This updates automatically when warehouse recording starts.
            </p>
          </div>
        )}

        {sessions.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">Sessions</p>
            {sessions.map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium">Session {row.clipNumber}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(row.startedAt).toLocaleString()} · {row.operatorName}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {warehouseCameraSessionHasPlayback(row) ? (
                    <Button
                      size="sm"
                      variant={watchingId === row.id ? "default" : "outline"}
                      onClick={() => setWatchingId(row.id)}
                    >
                      Watch
                    </Button>
                  ) : null}
                  <Badge
                    variant={isWarehouseCameraSessionActive(row) ? "destructive" : "secondary"}
                  >
                    {sessionStatus(row)}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
