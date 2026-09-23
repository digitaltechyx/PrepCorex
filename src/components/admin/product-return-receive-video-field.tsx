"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Circle, Square, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { validateProductReturnReceiveVideo } from "@/lib/product-return-receive-videos";

type Props = {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
};

function recorderMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

export function ProductReturnReceiveVideoField({ files, onChange, disabled }: Props) {
  const { toast } = useToast();
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [clipUrls, setClipUrls] = useState<string[]>([]);
  const clipUrlsRef = useRef<string[]>([]);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (previewRef.current) previewRef.current.srcObject = null;
  };

  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      clipUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const startRecording = async () => {
    if (disabled || recording) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast({
        variant: "destructive",
        title: "Camera unavailable",
        description: "This browser cannot record video. Upload a file instead.",
      });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: true,
      });
      streamRef.current = stream;
      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        await previewRef.current.play().catch(() => undefined);
      }
      const mimeType = recorderMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || "video/webm";
        const blob = new Blob(chunksRef.current, { type });
        const extension = type.includes("mp4") ? "mp4" : "webm";
        const file = new File([blob], `return-receive-${Date.now()}.${extension}`, { type });
        const err = validateProductReturnReceiveVideo(file);
        stopStream();
        setRecording(false);
        if (err) {
          toast({ variant: "destructive", title: "Recording not saved", description: err });
          return;
        }
        const url = URL.createObjectURL(file);
        clipUrlsRef.current = [...clipUrlsRef.current, url];
        setClipUrls(clipUrlsRef.current);
        onChange([...files, file]);
      };
      recorderRef.current = recorder;
      recorder.start(1000);
      setRecording(true);
    } catch {
      stopStream();
      toast({
        variant: "destructive",
        title: "Camera blocked",
        description: "Allow camera and microphone access, or upload a video file.",
      });
    }
  };

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    } else {
      stopStream();
      setRecording(false);
    }
  };

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files ? [...event.target.files] : [];
    event.target.value = "";
    const accepted: File[] = [];
    for (const file of selected) {
      const err = validateProductReturnReceiveVideo(file);
      if (err) {
        toast({ variant: "destructive", title: "Video not added", description: err });
        continue;
      }
      accepted.push(file);
      const url = URL.createObjectURL(file);
      clipUrlsRef.current = [...clipUrlsRef.current, url];
    }
    setClipUrls(clipUrlsRef.current);
    if (accepted.length > 0) onChange([...files, ...accepted]);
  };

  const removeAt = (index: number) => {
    const url = clipUrlsRef.current[index];
    if (url) URL.revokeObjectURL(url);
    clipUrlsRef.current = clipUrlsRef.current.filter((_, i) => i !== index);
    setClipUrls(clipUrlsRef.current);
    onChange(files.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      <Label>Receive video (optional)</Label>
      <p className="text-xs text-muted-foreground">
        Record this tracking while you open it, or upload a video. The clip is saved to Google Drive when you save the counts, and the client can watch it on their return.
      </p>
      <video
        ref={previewRef}
        className={recording ? "w-full max-h-40 rounded-md bg-black" : "hidden"}
        muted
        playsInline
      />
      <div className="flex flex-wrap gap-2">
        {recording ? (
          <Button type="button" variant="destructive" size="sm" onClick={stopRecording}>
            <Square className="mr-1.5 h-3.5 w-3.5" />
            Stop recording
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => void startRecording()}>
            <Circle className="mr-1.5 h-3.5 w-3.5 fill-red-500 text-red-500" />
            Record
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || recording}
          onClick={() => document.getElementById("return-receive-video-file")?.click()}
        >
          <Upload className="mr-1.5 h-3.5 w-3.5" />
          Upload video
        </Button>
        <input
          id="return-receive-video-file"
          type="file"
          accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
          className="hidden"
          onChange={handleFile}
        />
      </div>
      {clipUrls.length > 0 ? (
        <div className="space-y-2">
          {clipUrls.map((url, index) => (
            <div key={url} className="relative">
              <video src={url} controls className="w-full max-h-40 rounded-md bg-black" />
              <Button
                type="button"
                size="icon"
                variant="destructive"
                className="absolute right-1 top-1 h-7 w-7"
                disabled={recording}
                onClick={() => removeAt(index)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
