"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { InboundRequestRow } from "@/lib/warehouse-inbound-requests";
import { inboundRequestPrefill } from "@/lib/warehouse-inbound-receive";

export type InboundLineLink = {
  inventoryRequestId: string;
  clientId: string;
  clientLabel: string;
  sku: string;
  productTitle: string;
  goodQty: string;
  expiry: string;
};

type Props = {
  requests: InboundRequestRow[];
  value: string;
  onChange: (link: InboundLineLink | null) => void;
  compact?: boolean;
};

export function inboundRequestOptionValue(row: InboundRequestRow): string {
  return `${row.clientUserId}:${row.id}`;
}

export function parseInboundRequestOptionValue(
  value: string,
  requests: InboundRequestRow[]
): InboundRequestRow | null {
  if (!value || value === "__none__") return null;
  const [clientUserId, ...rest] = value.split(":");
  const requestId = rest.join(":");
  return (
    requests.find((r) => r.clientUserId === clientUserId && r.id === requestId) ?? null
  );
}

export function inboundLineLinkFromRow(row: InboundRequestRow): InboundLineLink {
  const pre = inboundRequestPrefill(row);
  return {
    inventoryRequestId: pre.inventoryRequestId,
    clientId: pre.clientUserId,
    clientLabel: pre.clientDisplayName,
    sku: pre.sku,
    productTitle: pre.productName,
    goodQty: String(Math.max(1, pre.remainingQty || 1)),
    expiry: pre.expiry,
  };
}

export function InboundRequestLinePicker({ requests, value, onChange, compact }: Props) {
  const open = requests.filter((r) => r.remainingQty > 0);

  return (
    <div className={compact ? "space-y-1" : "space-y-1.5"}>
      <Label className="text-xs">Inbound request (optional)</Label>
      <Select
        value={value || "__none__"}
        onValueChange={(v) => {
          const row = parseInboundRequestOptionValue(v, requests);
          onChange(row ? inboundLineLinkFromRow(row) : null);
        }}
      >
        <SelectTrigger className="h-9 text-xs">
          <SelectValue placeholder="Link line to client request…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">No request — walk-in line</SelectItem>
          {open.map((row) => (
            <SelectItem key={inboundRequestOptionValue(row)} value={inboundRequestOptionValue(row)}>
              {row.clientDisplayName} · {row.productName} · {row.remainingQty} left
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
