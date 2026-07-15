"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import {
  cycleCountTimestampToDate,
  isCycleCountLineUnresolved,
  resolveCycleCountVariance,
  varianceReasonLabel,
} from "@/lib/warehouse-cycle-count";
import type {
  WarehouseCycleCountCountedLine,
  WarehouseCycleCountResolveAction,
  WarehouseCycleCountTaskDoc,
} from "@/types";
import { cn } from "@/lib/utils";
import { CheckCircle2, Loader2, Wrench } from "lucide-react";

function formatDateTime(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function resolveStatusLabel(status: string | null | undefined): string {
  if (status === "applied") return "Stock applied";
  if (status === "acknowledged") return "Acknowledged";
  if (status === "found_missing_stock" || status === "miscount") return "Found missing stock";
  if (status === "found_additional_stock") return "Found additional stock";
  return "—";
}

export function CycleCountTaskDetail({
  task,
  operatorNameById,
  allowResolve = false,
  onTaskUpdated,
}: {
  task: WarehouseCycleCountTaskDoc;
  operatorNameById?: Map<string, string>;
  allowResolve?: boolean;
  onTaskUpdated?: (task: WarehouseCycleCountTaskDoc) => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const completedAt = cycleCountTimestampToDate(task.completedAt);
  const createdAt = cycleCountTimestampToDate(task.createdAt);
  const [busy, setBusy] = useState(false);
  const [resolveTarget, setResolveTarget] = useState<{
    binId: string;
    binPath: string;
    line: WarehouseCycleCountCountedLine;
  } | null>(null);
  const [action, setAction] = useState<WarehouseCycleCountResolveAction>("apply_stock");
  const [notes, setNotes] = useState("");

  function operatorLabel(uid: string | null | undefined): string {
    if (!uid) return "—";
    return operatorNameById?.get(uid) || uid.slice(0, 8);
  }

  async function confirmResolve() {
    if (!resolveTarget || !user?.uid) return;
    setBusy(true);
    try {
      const { task: next, detail } = await resolveCycleCountVariance({
        warehouseId: task.warehouseId,
        taskId: task.id,
        binId: resolveTarget.binId,
        lineKey: resolveTarget.line.key,
        action,
        adminId: user.uid,
        notes,
        syncClientInventory: true,
      });
      toast({ title: "Variance resolved", description: detail });
      onTaskUpdated?.(next);
      setResolveTarget(null);
    } catch (e) {
      toast({
        title: "Could not resolve",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-base">{task.title}</h3>
          <Badge variant="outline" className="capitalize">
            {task.status.replace(/_/g, " ")}
          </Badge>
          <Badge variant="secondary" className="capitalize">
            {task.type}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Created {formatDateTime(createdAt)}
          {completedAt ? ` · Completed ${formatDateTime(completedAt)}` : ""}
          {task.createdBy ? ` · Planned by ${operatorLabel(task.createdBy)}` : ""}
        </p>
        {task.notes ? (
          <p className="text-sm mt-1">
            <span className="text-muted-foreground">Task notes: </span>
            {task.notes}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Bins {task.completedBinIds.length}/{task.binIds.length}
          {task.binPaths.length > 0 ? ` · ${task.binPaths.slice(0, 3).join(", ")}` : ""}
          {task.binPaths.length > 3 ? "…" : ""}
        </p>
      </div>

      {task.binResults.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          No bin results recorded on this task yet.
        </p>
      ) : (
        task.binResults.map((bin) => (
          <Card
            key={`${bin.binId}-${bin.binPath}`}
            className={cn(bin.hasVariance && "border-amber-300/80")}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-mono">{bin.binPath}</CardTitle>
              <CardDescription className="text-xs">
                Submitted {formatDateTime(cycleCountTimestampToDate(bin.submittedAt))}
                {bin.submittedBy ? ` · ${operatorLabel(bin.submittedBy)}` : ""}
                {bin.hasVariance ? " · Has variance" : " · Match"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {bin.scannedCartonCodes?.length ? (
                <p className="text-xs text-muted-foreground">
                  Cartons scanned:{" "}
                  <span className="font-mono text-foreground">
                    {bin.scannedCartonCodes.join(", ")}
                  </span>
                </p>
              ) : null}
              {bin.notes ? (
                <p className="text-sm rounded-md border bg-muted/40 px-3 py-2">
                  <span className="text-muted-foreground text-xs">Bin remarks: </span>
                  {bin.notes}
                </p>
              ) : null}
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                      <th className="px-2 py-1.5 font-medium">SKU / product</th>
                      <th className="px-2 py-1.5 font-medium">Expected</th>
                      <th className="px-2 py-1.5 font-medium">Counted</th>
                      <th className="px-2 py-1.5 font-medium">Var</th>
                      <th className="px-2 py-1.5 font-medium">Reason / remarks</th>
                      {allowResolve ? (
                        <th className="px-2 py-1.5 font-medium">Resolve</th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {bin.countedLines.map((line) => {
                      const expected = bin.expectedLines.find((e) => e.key === line.key);
                      const title = expected?.productTitle?.trim();
                      const unresolved = isCycleCountLineUnresolved(line);
                      return (
                        <tr
                          key={line.key}
                          className={cn(
                            "border-b last:border-0",
                            line.variance !== 0 && "bg-amber-50/60 dark:bg-amber-950/20"
                          )}
                        >
                          <td className="px-2 py-1.5 align-top">
                            <div className="font-medium">{line.sku}</div>
                            {title && title !== line.sku ? (
                              <div className="text-xs text-muted-foreground">{title}</div>
                            ) : null}
                            {line.lot ? (
                              <div className="text-[10px] text-muted-foreground font-mono">
                                Lot {line.lot}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-2 py-1.5 align-top">{line.expectedQty}</td>
                          <td className="px-2 py-1.5 align-top">{line.countedQty}</td>
                          <td
                            className={cn(
                              "px-2 py-1.5 align-top font-medium",
                              line.variance > 0 && "text-emerald-700",
                              line.variance < 0 && "text-red-700"
                            )}
                          >
                            {line.variance > 0 ? "+" : ""}
                            {line.variance}
                          </td>
                          <td className="px-2 py-1.5 align-top text-xs">
                            {line.variance === 0 ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <div className="space-y-0.5">
                                <div>{varianceReasonLabel(line.varianceReason)}</div>
                                {line.varianceNotes?.trim() ? (
                                  <div className="text-muted-foreground whitespace-pre-wrap">
                                    {line.varianceNotes}
                                  </div>
                                ) : null}
                                {line.resolveStatus ? (
                                  <div className="pt-1 space-y-0.5">
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] bg-emerald-50 text-emerald-800 border-emerald-200"
                                    >
                                      <CheckCircle2 className="h-3 w-3 mr-1 inline" />
                                      {resolveStatusLabel(line.resolveStatus)}
                                    </Badge>
                                    {line.resolveDetail ? (
                                      <p className="text-[10px] text-muted-foreground">
                                        {line.resolveDetail}
                                      </p>
                                    ) : null}
                                    {line.resolvedBy ? (
                                      <p className="text-[10px] text-muted-foreground">
                                        by {operatorLabel(line.resolvedBy)}
                                      </p>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            )}
                          </td>
                          {allowResolve ? (
                            <td className="px-2 py-1.5 align-top">
                              {line.variance === 0 ? (
                                <span className="text-muted-foreground text-xs">—</span>
                              ) : unresolved ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8"
                                  onClick={() => {
                                    setAction(
                                      line.variance < 0
                                        ? "found_missing_stock"
                                        : line.variance > 0
                                          ? "found_additional_stock"
                                          : "acknowledge"
                                    );
                                    setNotes("");
                                    setResolveTarget({
                                      binId: bin.binId,
                                      binPath: bin.binPath,
                                      line,
                                    });
                                  }}
                                >
                                  <Wrench className="h-3.5 w-3.5 mr-1" />
                                  Resolve
                                </Button>
                              ) : (
                                <span className="text-xs text-muted-foreground">Resolved</span>
                              )}
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ))
      )}

      <Dialog
        open={!!resolveTarget}
        onOpenChange={(open) => {
          if (!open) setResolveTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Resolve variance</DialogTitle>
            <DialogDescription>
              {resolveTarget
                ? `${resolveTarget.line.sku} on ${resolveTarget.binPath} · variance ${
                    resolveTarget.line.variance > 0 ? "+" : ""
                  }${resolveTarget.line.variance}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {resolveTarget ? (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs space-y-1">
                <p>
                  Expected <strong>{resolveTarget.line.expectedQty}</strong> · Counted{" "}
                  <strong>{resolveTarget.line.countedQty}</strong>
                </p>
                <p className="text-muted-foreground">
                  Reason: {varianceReasonLabel(resolveTarget.line.varianceReason)}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Action</Label>
                <Select
                  value={action}
                  onValueChange={(v) => setAction(v as WarehouseCycleCountResolveAction)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="apply_stock">
                      Apply stock fix
                      {resolveTarget.line.variance < 0
                        ? " (remove missing qty)"
                        : " (add found qty)"}
                    </SelectItem>
                    <SelectItem value="acknowledge">
                      Acknowledge only (no stock change)
                    </SelectItem>
                    <SelectItem value="found_missing_stock">
                      Found missing stock (no stock change)
                    </SelectItem>
                    <SelectItem value="found_additional_stock">
                      Found additional stock (no stock change)
                    </SelectItem>
                  </SelectContent>
                </Select>
                {action === "apply_stock" ? (
                  <p className="text-[11px] text-muted-foreground">
                    Updates warehouse carton qty in this bin to match the count. Also adjusts
                    client inventory when the carton has a client.
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label>Admin notes (optional)</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="How this was verified / resolved…"
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setResolveTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={busy || !user?.uid}
              onClick={() => void confirmResolve()}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm resolve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
