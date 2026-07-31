"use client";

import { Package } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  formatUnitDimensions,
  suggestBox,
  type BoxSuggestionLine,
  type BoxSuggestionResult,
} from "@/lib/box-suggestion";
import { cn } from "@/lib/utils";

type Props = {
  lines: BoxSuggestionLine[];
  className?: string;
  /** When true, hide the card if there is nothing useful to show (empty / incomplete). */
  hideWhenUnavailable?: boolean;
};

function recommendCopy(result: Extract<BoxSuggestionResult, { status: "recommended" }>): string {
  const box = result.box;
  const dims = formatUnitDimensions({
    unitLengthIn: box.externalLengthIn,
    unitWidthIn: box.externalWidthIn,
    unitHeightIn: box.externalHeightIn,
  });
  const cartonLabel =
    result.boxCount > 1 ? `${result.boxCount} × ${box.code}` : box.code;
  const dimensionLabel = result.boxCount > 1 ? `${dims} each` : dims;
  const weightLabel = result.boxCount > 1 ? "total gross" : "gross";
  return `${cartonLabel} · ${dimensionLabel} · est. ${result.grossWeightLb.toFixed(2)} lb ${weightLabel}`;
}

export function BoxSuggestionCard({ lines, className, hideWhenUnavailable }: Props) {
  const result = suggestBox(lines);

  if (result.status === "empty") {
    if (hideWhenUnavailable) return null;
    return null;
  }

  if (result.status === "incomplete_measurements") {
    if (hideWhenUnavailable) return null;
    return (
      <Alert className={cn("border-dashed", className)}>
        <Package className="h-4 w-4" />
        <AlertTitle className="text-sm">Box suggestion unavailable</AlertTitle>
        <AlertDescription className="text-xs">
          Add unit dimensions and weight for every selected product to see a recommended box.
          {result.missingProductNames.length > 0 ? (
            <span className="block mt-1 text-muted-foreground">
              Missing: {result.missingProductNames.slice(0, 4).join(", ")}
              {result.missingProductNames.length > 4
                ? ` +${result.missingProductNames.length - 4} more`
                : ""}
            </span>
          ) : null}
        </AlertDescription>
      </Alert>
    );
  }

  if (result.status === "no_fit") {
    return (
      <Alert className={cn("border-amber-300/70 bg-amber-50/50 dark:bg-amber-950/20", className)}>
        <Package className="h-4 w-4" />
        <AlertTitle className="text-sm">No standard box fits</AlertTitle>
        <AlertDescription className="text-xs">
          At least one unit is too large for every approved box orientation. Use a custom carton if
          needed. This is only a recommendation — packing can continue as usual.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert className={cn("border-emerald-300/70 bg-emerald-50/40 dark:bg-emerald-950/20", className)}>
      <Package className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
      <AlertTitle className="text-sm">
        Suggested {result.boxCount === 1 ? "box" : "boxes"}:{" "}
        {result.boxCount > 1 ? `${result.boxCount} × ` : ""}
        {result.box.code}
      </AlertTitle>
      <AlertDescription className="text-xs space-y-1">
        <p>{recommendCopy(result)}</p>
        <p className="text-muted-foreground">
          Product vol ~{result.requiredVolumeIn3.toFixed(1)} in³ (combined usable{" "}
          {result.usableVolumeIn3.toFixed(1)} in³ at 65%) · product wt{" "}
          {result.productWeightLb.toFixed(2)} lb. Divide products safely between cartons and verify
          packed weights. Recommendation only — does not block packing.
        </p>
      </AlertDescription>
    </Alert>
  );
}
