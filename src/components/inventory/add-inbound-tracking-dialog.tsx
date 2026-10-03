"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { detectCarrier } from "@/lib/carrier-detect";
import { shippoCarrierSelectValue } from "@/lib/inbound-tracking";
import { addInboundTrackingToRequests } from "@/lib/inbound-tracking-client";
import { Loader2 } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  /** Single inventory request (legacy / common). */
  requestId?: string;
  /** Multiple inventory request IDs (e.g. multi-line inbound batch). */
  requestIds?: string[];
  productName: string;
  onAdded?: () => void;
};

export function AddInboundTrackingDialog({
  open,
  onOpenChange,
  userId,
  requestId,
  requestIds,
  productName,
  onAdded,
}: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [trackingNumber, setTrackingNumber] = useState("");
  const [carrier, setCarrier] = useState("usps");
  const [carrierAuto, setCarrierAuto] = useState(false);
  const [saving, setSaving] = useState(false);

  const targetRequestIds = Array.from(
    new Set(
      [...(requestIds || []), ...(requestId ? [requestId] : [])]
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    )
  );

  function handleTrackingChange(value: string) {
    setTrackingNumber(value);
    const detected = detectCarrier(value);
    if (detected) {
      setCarrier(shippoCarrierSelectValue(detected));
      setCarrierAuto(true);
    } else if (carrierAuto) {
      setCarrier("usps");
      setCarrierAuto(false);
    }
  }

  async function handleSubmit() {
    if (!user) return;
    const tn = trackingNumber.trim();
    if (!tn) {
      toast({ title: "Tracking number required", variant: "destructive" });
      return;
    }
    if (targetRequestIds.length === 0) {
      toast({
        title: "No request selected",
        description: "Could not find an inbound request to attach tracking to.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      await addInboundTrackingToRequests(
        user,
        userId,
        targetRequestIds.map((id) => ({
          requestId: id,
          trackingNumber: tn,
          carrier,
        }))
      );
      toast({
        title: "Tracking added",
        description:
          targetRequestIds.length > 1
            ? `Attached to ${targetRequestIds.length} inbound lines. Status refreshes every 3 hours.`
            : "Status will refresh automatically every 3 hours.",
      });
      setTrackingNumber("");
      setCarrier("usps");
      setCarrierAuto(false);
      onOpenChange(false);
      onAdded?.();
    } catch (e) {
      toast({
        title: "Could not add tracking",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add inbound tracking</DialogTitle>
          <DialogDescription>
            {productName} — carrier status updates from Shippo every <strong>3 hours</strong>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label>Tracking number</Label>
            <Input
              value={trackingNumber}
              onChange={(e) => handleTrackingChange(e.target.value)}
              placeholder="1Z999… / 9400…"
              className="font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label>Carrier</Label>
            <Select value={carrier} onValueChange={(v) => { setCarrier(v); setCarrierAuto(false); }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="usps">USPS</SelectItem>
                <SelectItem value="ups">UPS</SelectItem>
                <SelectItem value="fedex">FedEx</SelectItem>
                <SelectItem value="dhl">DHL</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Save tracking
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
