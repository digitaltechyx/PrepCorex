"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { ScanLookupPopover } from "@/components/warehouse-ops/scan-lookup-popover";
import { receiveReturnAtDock, type ReturnRequestRow } from "@/lib/warehouse-returns";
import {
  buildWarehouseCartonLabelsPdf,
  downloadUint8ArrayAsFile,
} from "@/lib/warehouse-carton-label-pdf";
import { getWarehouseCarton } from "@/lib/warehouse-receive-corrections";
import type { WarehouseDoc } from "@/types";
import { ArrowLeft, CheckCircle2, Loader2, RotateCcw } from "lucide-react";

type Props = {
  warehouse: WarehouseDoc;
  returnRow: ReturnRequestRow;
  tracking: string;
  onBack: () => void;
  onDone: () => void;
};

export function WarehouseOpsReturnReceive({
  warehouse,
  returnRow,
  tracking,
  onBack,
  onDone,
}: Props) {
  const { toast } = useToast();
  const { user, userProfile } = useAuth();
  const operatorId = user?.uid ?? userProfile?.name ?? userProfile?.email ?? null;
  const operatorName = userProfile?.name || userProfile?.email || user?.uid || null;

  const [sku, setSku] = useState(returnRow.skuLabel || "");
  const [productTitle, setProductTitle] = useState(returnRow.productLabel);
  const [qty, setQty] = useState(String(Math.max(1, returnRow.remainingQty || 1)));
  const [notes, setNotes] = useState("");
  const [stagingArea, setStagingArea] = useState("RETURNS-STAGE");
  const [saving, setSaving] = useState(false);

  const qtyNum = parseInt(qty, 10) || 0;
  const canSubmit = sku.trim().length > 0 && qtyNum >= 1;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const result = await receiveReturnAtDock({
        warehouseId: warehouse.id,
        clientUserId: returnRow.clientUserId,
        productReturnId: returnRow.id,
        sku: sku.trim(),
        productTitle: productTitle.trim() || returnRow.productLabel,
        quantity: qtyNum,
        trackingNumber: tracking.trim() || null,
        notes: notes.trim() || null,
        stagingArea: stagingArea.trim() || "RETURNS-STAGE",
        receivedBy: operatorName,
        operatorId,
      });

      toast({
        title: "Return received",
        description: `${result.cartonCode} → quarantine`,
      });

      try {
        const carton = await getWarehouseCarton(warehouse.id, result.cartonId);
        if (carton) {
          const pdf = await buildWarehouseCartonLabelsPdf([carton], warehouse);
          downloadUint8ArrayAsFile(pdf, `${result.cartonCode}-label.pdf`);
        }
      } catch {
        // label optional
      }

      onDone();
    } catch (e) {
      toast({
        title: "Receive failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to dock intake
      </Button>

      <Card className="border-orange-200/60">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <RotateCcw className="h-4 w-4" />
            Receive return (RMA)
          </CardTitle>
          <CardDescription>
            Carton goes to <Badge variant="secondary">quarantine</Badge> until QC restocks or
            disposes. Not pickable.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>
            <span className="text-muted-foreground">Client:</span> {returnRow.clientDisplayName}
          </p>
          <p>
            <span className="text-muted-foreground">Product:</span> {returnRow.productLabel}
          </p>
          <p>
            <span className="text-muted-foreground">Expected remaining:</span>{" "}
            {returnRow.remainingQty}
          </p>
          {tracking ? (
            <p className="font-mono text-xs text-muted-foreground">Tracking: {tracking}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="space-y-2">
            <Label>SKU</Label>
            <div className="flex gap-2">
              <Input
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="Scan or type SKU"
                className="font-mono"
              />
              <ScanLookupPopover
                onPick={(m) => {
                  setSku(m.sku);
                  if (m.productTitle) setProductTitle(m.productTitle);
                }}
                onAcceptRaw={(raw) => setSku(raw)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Product title</Label>
            <Input value={productTitle} onChange={(e) => setProductTitle(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Quantity received</Label>
            <Input
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Returns staging area</Label>
            <Input
              value={stagingArea}
              onChange={(e) => setStagingArea(e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <Button className="w-full" size="lg" disabled={!canSubmit || saving} onClick={() => void handleSubmit()}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <CheckCircle2 className="h-4 w-4 mr-2" />
            )}
            Receive to quarantine & print label
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
