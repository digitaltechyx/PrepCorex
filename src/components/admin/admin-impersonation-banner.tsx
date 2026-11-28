"use client";

import { Eye, ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useViewAsClient } from "@/contexts/view-as-client-context";

export function AdminImpersonationBanner() {
  const { isViewingAsClient, targetProfile, targetUid, clearViewAs } = useViewAsClient();

  if (!isViewingAsClient || !targetProfile) return null;

  const label =
    targetProfile.name ||
    targetProfile.email ||
    targetProfile.clientId ||
    targetUid;

  return (
    <div
      role="status"
      className="sticky top-0 z-[100] flex flex-wrap items-center justify-between gap-2 border-b border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-950 sm:px-4"
    >
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <Eye className="h-4 w-4 shrink-0" />
        <span className="min-w-0">
          Viewing as <strong className="font-semibold">{label}</strong>
          {targetProfile.clientId ? (
            <span className="text-emerald-800"> · Client ID {targetProfile.clientId}</span>
          ) : null}
          <span className="hidden text-emerald-800 sm:inline">
            {" "}
            · Your admin login stays active in other tabs
          </span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => clearViewAs()}
          className="border-emerald-400 bg-white text-emerald-950 hover:bg-emerald-100"
        >
          <ExternalLink className="mr-2 h-3.5 w-3.5" />
          Back to admin
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            clearViewAs();
            try {
              window.close();
            } catch {
              // ignore — browser may block close if tab wasn't opened by script
            }
          }}
          className="border-emerald-400 bg-white text-emerald-950 hover:bg-emerald-100"
        >
          <X className="mr-2 h-3.5 w-3.5" />
          Exit viewing
        </Button>
      </div>
    </div>
  );
}
