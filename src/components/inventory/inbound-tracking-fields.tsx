"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { detectCarrier } from "@/lib/carrier-detect";
import { shippoCarrierSelectValue } from "@/lib/inbound-tracking";
import { useState } from "react";

export type InboundTrackingInput = {
  trackingNumber: string;
  carrier: string;
};

export const EMPTY_INBOUND_TRACKING: InboundTrackingInput = {
  trackingNumber: "",
  carrier: "usps",
};

type Props = {
  value: InboundTrackingInput;
  onChange: (value: InboundTrackingInput) => void;
  compact?: boolean;
  idPrefix?: string;
};

export function InboundTrackingFields({
  value,
  onChange,
  compact = false,
  idPrefix = "inbound-trk",
}: Props) {
  const [carrierAuto, setCarrierAuto] = useState(false);

  function handleTrackingChange(tn: string) {
    const detected = detectCarrier(tn);
    if (detected) {
      onChange({ trackingNumber: tn, carrier: shippoCarrierSelectValue(detected) });
      setCarrierAuto(true);
    } else {
      onChange({
        trackingNumber: tn,
        carrier: carrierAuto ? "usps" : value.carrier,
      });
      if (carrierAuto) setCarrierAuto(false);
    }
  }

  return (
    <div className={compact ? "grid gap-2 sm:grid-cols-2" : "space-y-3"}>
      <div className="space-y-1">
        <Label
          htmlFor={`${idPrefix}-num`}
          className={compact ? "text-xs text-muted-foreground" : undefined}
        >
          Tracking number (optional)
        </Label>
        <Input
          id={`${idPrefix}-num`}
          value={value.trackingNumber}
          onChange={(e) => handleTrackingChange(e.target.value)}
          placeholder="1Z999… / 9400…"
          className={`font-mono ${compact ? "h-10 rounded-lg" : "rounded-lg"}`}
        />
      </div>
      <div className="space-y-1">
        <Label
          htmlFor={`${idPrefix}-carrier`}
          className={compact ? "text-xs text-muted-foreground" : undefined}
        >
          Carrier (optional)
        </Label>
        <Select
          value={value.carrier}
          onValueChange={(v) => {
            onChange({ ...value, carrier: v });
            setCarrierAuto(false);
          }}
        >
          <SelectTrigger id={`${idPrefix}-carrier`} className={compact ? "h-10 rounded-lg" : "rounded-lg"}>
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
  );
}
