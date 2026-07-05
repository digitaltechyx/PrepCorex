"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { UserProfile, WarehouseDoc, PalletStoragePosition } from "@/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, Layers } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import {
  consolidatePalletStoragePositions,
  listActivePalletStoragePositions,
  listPositionContents,
  updatePalletPositionHasSpace,
} from "@/lib/pallet-storage-positions";
import { CrossdockClientCombobox } from "@/components/warehouse-ops/crossdock-client-combobox";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
};

export function WarehouseOpsStorage({ warehouse, clients }: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [clientId, setClientId] = useState("");
  const [positions, setPositions] = useState<PalletStoragePosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [sourceIds, setSourceIds] = useState<Set<string>>(new Set());
  const [consolidateNotes, setConsolidateNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [contentsByPosition, setContentsByPosition] = useState<
    Record<string, Array<{ sku?: string | null; productName?: string | null; quantity?: number }>>
  >({});

  const clientLabel = useMemo(() => {
    const c = clients.find((x) => x.uid === clientId || (x as { id?: string }).id === clientId);
    return c?.name || c?.email || clientId;
  }, [clients, clientId]);

  const reload = useCallback(async () => {
    if (!clientId) {
      setPositions([]);
      return;
    }
    setLoading(true);
    try {
      const rows = await listActivePalletStoragePositions(clientId);
      setPositions(rows);
      setTargetId(rows[0]?.id || "");
      const contentsMap: typeof contentsByPosition = {};
      await Promise.all(
        rows.map(async (p) => {
          const lines = await listPositionContents(clientId, p.id);
          contentsMap[p.id] = lines;
        })
      );
      setContentsByPosition(contentsMap);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Failed to load storage",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  }, [clientId, toast]);

  useEffect(() => {
    reload();
  }, [reload]);

  function toggleSource(id: string) {
    setSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleConsolidate() {
    if (!clientId || !targetId || sourceIds.size === 0) {
      toast({
        variant: "destructive",
        title: "Select pallets",
        description: "Pick a target pallet and at least one source to consolidate.",
      });
      return;
    }
    setSaving(true);
    try {
      await consolidatePalletStoragePositions({
        userId: clientId,
        targetPositionId: targetId,
        sourcePositionIds: [...sourceIds],
        operatorId: user?.uid ?? null,
        notes: consolidateNotes.trim() || null,
      });
      toast({
        title: "Consolidated",
        description: `Closed ${sourceIds.size} pallet position(s). Billing stops on empty pallets.`,
      });
      setSourceIds(new Set());
      setConsolidateNotes("");
      await reload();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Consolidation failed",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function toggleHasSpace(position: PalletStoragePosition) {
    if (!clientId) return;
    const next = position.hasSpace === false;
    try {
      await updatePalletPositionHasSpace(clientId, position.id, next);
      await reload();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Update failed",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            Pallet storage — {warehouse.code}
          </CardTitle>
          <CardDescription>
            Billable pallet positions per client. Consolidate to reduce pallet count and stop billing on closed positions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-md space-y-2">
            <Label>Client</Label>
            <CrossdockClientCombobox
              clients={clients}
              clientId={clientId}
              clientLabel={clientLabel}
              onChange={({ clientId: id }) => setClientId(id)}
            />
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : clientId && positions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">No active pallet positions for {clientLabel}.</p>
          ) : clientId ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {positions.map((p) => (
                  <Card key={p.id} className="border shadow-sm">
                    <CardHeader className="pb-2 pt-4 px-4">
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="text-base">{p.label}</CardTitle>
                        <Badge variant={p.hasSpace === false ? "secondary" : "default"}>
                          {p.hasSpace === false ? "Full" : "Has space"}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="px-4 pb-4 space-y-2 text-sm">
                      {p.notes && (
                        <p className="text-muted-foreground text-xs whitespace-pre-wrap">{p.notes}</p>
                      )}
                      {(contentsByPosition[p.id] || []).length > 0 ? (
                        <ul className="text-xs space-y-0.5">
                          {(contentsByPosition[p.id] || []).slice(0, 5).map((line, i) => (
                            <li key={i}>
                              {line.productName || line.sku || "Item"}
                              {line.quantity ? ` × ${line.quantity}` : ""}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-muted-foreground">No contents logged</p>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full mt-2"
                        onClick={() => toggleHasSpace(p)}
                      >
                        Mark as {p.hasSpace === false ? "has space" : "full"}
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {positions.length >= 2 && (
                <Card className="border-dashed">
                  <CardHeader>
                    <CardTitle className="text-sm">Consolidate pallets</CardTitle>
                    <CardDescription>
                      Move inventory physically, then close source positions here so billing stops on empty pallets.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2 max-w-xs">
                      <Label>Keep (target) pallet</Label>
                      <Select value={targetId} onValueChange={setTargetId}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {positions.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Close these pallets (sources)</Label>
                      <div className="flex flex-wrap gap-3">
                        {positions
                          .filter((p) => p.id !== targetId)
                          .map((p) => (
                            <label key={p.id} className="flex items-center gap-2 text-sm">
                              <Checkbox
                                checked={sourceIds.has(p.id)}
                                onCheckedChange={() => toggleSource(p.id)}
                              />
                              {p.label}
                            </label>
                          ))}
                      </div>
                    </div>
                    <Textarea
                      placeholder="Consolidation notes (optional)"
                      value={consolidateNotes}
                      onChange={(e) => setConsolidateNotes(e.target.value)}
                      rows={2}
                    />
                    <Button onClick={handleConsolidate} disabled={saving || sourceIds.size === 0}>
                      {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Consolidate & close sources
                    </Button>
                  </CardContent>
                </Card>
              )}
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
