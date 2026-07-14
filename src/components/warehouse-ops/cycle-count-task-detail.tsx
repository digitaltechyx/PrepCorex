"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  cycleCountTimestampToDate,
  varianceReasonLabel,
} from "@/lib/warehouse-cycle-count";
import type { WarehouseCycleCountTaskDoc } from "@/types";
import { cn } from "@/lib/utils";

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

export function CycleCountTaskDetail({
  task,
  operatorNameById,
}: {
  task: WarehouseCycleCountTaskDoc;
  operatorNameById?: Map<string, string>;
}) {
  const completedAt = cycleCountTimestampToDate(task.completedAt);
  const createdAt = cycleCountTimestampToDate(task.createdAt);

  function operatorLabel(uid: string | null | undefined): string {
    if (!uid) return "—";
    return operatorNameById?.get(uid) || uid.slice(0, 8);
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
                    </tr>
                  </thead>
                  <tbody>
                    {bin.countedLines.map((line) => {
                      const expected = bin.expectedLines.find((e) => e.key === line.key);
                      const title = expected?.productTitle?.trim();
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
                              </div>
                            )}
                          </td>
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
    </div>
  );
}
