"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { formatServiceLabel } from "@/types";
import type { ShippedOrderDetails } from "@/lib/shipment-utils";

function money(n: number): string {
  return `$${Number(n || 0).toFixed(2)}`;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  details: ShippedOrderDetails | null;
};

export function ShippedOrderDetailsDialog({ open, onOpenChange, details }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Shipment details</DialogTitle>
          <DialogDescription>
            {details?.title || "Products shipped and shipment total"}
          </DialogDescription>
        </DialogHeader>

        {!details ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No shipment selected.</p>
        ) : (
          <div className="space-y-4 overflow-y-auto pr-1">
            <div className="flex flex-wrap gap-2 text-xs">
              {details.status ? (
                <Badge variant="secondary" className="font-normal">
                  {details.status}
                </Badge>
              ) : null}
              {details.dateLabel ? (
                <span className="text-muted-foreground self-center">{details.dateLabel}</span>
              ) : null}
              {details.service ? (
                <span className="text-muted-foreground self-center">
                  {formatServiceLabel(details.service)}
                </span>
              ) : null}
              {details.productType ? (
                <span className="text-muted-foreground self-center">{details.productType}</span>
              ) : null}
            </div>

            {details.shipTo ? (
              <div className="rounded-md border bg-muted/30 p-3 text-xs">
                <div className="font-medium text-sm mb-1">Ship to</div>
                <p className="whitespace-pre-wrap text-muted-foreground">{details.shipTo}</p>
              </div>
            ) : null}

            <div className="space-y-2">
              <div className="text-sm font-medium">
                What was shipped ({details.totalSkus} SKU
                {details.totalSkus === 1 ? "" : "s"})
              </div>
              {details.lines.map((line, index) => (
                <div key={`${line.productName}-${index}`} className="rounded-md border p-3 text-xs space-y-1.5">
                  <div className="font-medium text-sm">{line.productName}</div>
                  {(line.sku ||
                    line.retailIdentifier ||
                    line.shopifyLineTitle ||
                    line.shopifyLineSku) && (
                    <div className="rounded-md border bg-muted/40 px-2.5 py-2 space-y-1 text-muted-foreground">
                      <div className="font-medium text-foreground text-[11px] uppercase tracking-wide">
                        Warehouse product
                      </div>
                      {line.sku ? (
                        <div>
                          SKU: <span className="text-foreground font-medium font-mono">{line.sku}</span>
                        </div>
                      ) : null}
                      {line.retailIdentifier ? (
                        <div>
                          Retail ID:{" "}
                          <span className="text-foreground font-medium font-mono">
                            {line.retailIdentifier}
                          </span>
                        </div>
                      ) : null}
                      {line.shopifyLineTitle || line.shopifyLineSku ? (
                        <div className="pt-1 border-t border-border/60">
                          <div className="font-medium text-foreground text-[11px] uppercase tracking-wide mb-0.5">
                            Shopify order line
                          </div>
                          {line.shopifyLineTitle ? <div>{line.shopifyLineTitle}</div> : null}
                          {line.shopifyLineSku ? (
                            <div>
                              SKU:{" "}
                              <span className="text-foreground font-medium font-mono">
                                {line.shopifyLineSku}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
                    <span>
                      Qty:{" "}
                      <span className="text-foreground font-medium">{line.boxesShipped}</span>
                    </span>
                    <span>
                      Pack of:{" "}
                      <span className="text-foreground font-medium">{line.packOf}</span>
                    </span>
                    <span>
                      Total units:{" "}
                      <span className="text-foreground font-medium">{line.shippedQty}</span>
                    </span>
                    <span>
                      Unit price:{" "}
                      <span className="text-foreground font-medium">{money(line.unitPrice)}</span>
                    </span>
                  </div>
                  <div className="text-right font-semibold tabular-nums">
                    Line total: {money(line.lineTotal)}
                  </div>
                </div>
              ))}
            </div>

            {details.additionalServiceLines.length > 0 ? (
              <div className="rounded-md border p-3 text-xs space-y-1">
                <div className="font-medium text-sm mb-1">Additional services</div>
                {details.additionalServiceLines.map((line) => (
                  <div key={line} className="text-muted-foreground">
                    {line}
                  </div>
                ))}
                <div className="text-right font-medium tabular-nums pt-1">
                  {money(details.additionalServicesTotal)}
                </div>
              </div>
            ) : null}

            {details.remarks?.trim() ? (
              <div className="rounded-md border bg-muted/20 p-3 text-xs">
                <div className="font-medium text-sm mb-1">Remarks</div>
                <p className="whitespace-pre-wrap text-muted-foreground">{details.remarks}</p>
              </div>
            ) : null}

            <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-3 space-y-1.5 text-sm">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Products subtotal</span>
                <span className="tabular-nums">{money(details.productsTotal)}</span>
              </div>
              {details.additionalServicesTotal > 0 ? (
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Additional services</span>
                  <span className="tabular-nums">{money(details.additionalServicesTotal)}</span>
                </div>
              ) : null}
              <div className="flex justify-between font-semibold pt-1 border-t">
                <span>Shipment total</span>
                <span className="tabular-nums text-base">{money(details.shipmentTotal)}</span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                Qty {details.totalBoxes} · Total units {details.totalUnits}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
