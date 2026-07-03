"use client";

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { InboundBatchLineInput } from "@/lib/inbound-batch";
import { summarizeBatchLines } from "@/lib/inbound-batch";

export type InboundDraftLine = InboundBatchLineInput & { draftId: string };

type InboundBatchDraftReviewProps = {
  lines: InboundDraftLine[];
  onRemove: (draftId: string) => void;
  onClear?: () => void;
};

export function InboundBatchDraftReview({ lines, onRemove, onClear }: InboundBatchDraftReviewProps) {
  if (lines.length === 0) return null;

  return (
    <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Request list ({lines.length} items)</p>
          <p className="text-xs text-muted-foreground mt-0.5">{summarizeBatchLines(lines)}</p>
        </div>
        {onClear && lines.length > 1 && (
          <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={onClear}>
            Clear all
          </Button>
        )}
      </div>
      <ScrollArea className="h-[min(280px,40vh)] rounded-lg border bg-background">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
            <tr>
              <th className="px-2 py-2 text-left font-medium">#</th>
              <th className="px-2 py-2 text-left font-medium">Type</th>
              <th className="px-2 py-2 text-left font-medium">Name / SKU</th>
              <th className="px-2 py-2 text-right font-medium">Qty</th>
              <th className="w-8 px-1 py-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={line.draftId} className="border-t">
                <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{index + 1}</td>
                <td className="px-2 py-1.5 capitalize">{line.inventoryType}</td>
                <td className="px-2 py-1.5 max-w-[160px] truncate">
                  {line.sku || line.productName || "—"}
                  {line.variantLabel ? (
                    <span className="block text-[10px] text-muted-foreground">{line.variantLabel}</span>
                  ) : null}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{line.quantity}</td>
                <td className="px-1 py-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => onRemove(line.draftId)}
                    aria-label="Remove line"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
      <p className="text-[11px] text-muted-foreground">
        Review everything above, then submit once. Admin will receive a single inbound batch.
      </p>
    </div>
  );
}
