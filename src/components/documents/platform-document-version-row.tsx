"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Download, Eye, FileText, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatPlatformVersionLabel } from "@/lib/platform-document-control";
import type { PlatformDocumentSlug, PlatformDocumentSummary, PlatformDocumentVersionEntry } from "@/lib/platform-documents-types";
import { PLATFORM_DOCUMENT_LABELS } from "@/lib/platform-documents-types";

type PlatformDocumentVersionRowProps = {
  doc: PlatformDocumentSummary;
};

function formatVersionDate(iso?: string): string {
  if (!iso) return "";
  try {
    return format(new Date(iso), "MMM d, yyyy");
  } catch {
    return "";
  }
}

function pdfUrl(slug: PlatformDocumentSlug, version: number, isCurrent: boolean): string {
  const base = `/api/platform-documents/${slug}/pdf`;
  return isCurrent ? base : `${base}?version=${version}`;
}

export function PlatformDocumentVersionRow({ doc }: PlatformDocumentVersionRowProps) {
  const [versions, setVersions] = useState<PlatformDocumentVersionEntry[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(true);
  const [selectedVersion, setSelectedVersion] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingVersions(true);
      try {
        const res = await fetch(`/api/platform-documents/${doc.slug}/versions`);
        const data = await res.json();
        if (!cancelled && res.ok && Array.isArray(data.versions)) {
          setVersions(data.versions);
          const current = data.versions.find((v: PlatformDocumentVersionEntry) => v.isCurrent);
          setSelectedVersion(String(current?.version ?? doc.version ?? 1));
        } else if (!cancelled) {
          setSelectedVersion(String(doc.version ?? 1));
        }
      } catch {
        if (!cancelled) setSelectedVersion(String(doc.version ?? 1));
      } finally {
        if (!cancelled) setLoadingVersions(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc.slug, doc.version]);

  const activeEntry = useMemo(() => {
    const v = Number(selectedVersion);
    return versions.find((entry) => entry.version === v) ?? versions.find((entry) => entry.isCurrent);
  }, [versions, selectedVersion]);

  const versionNumber = activeEntry?.version ?? doc.version ?? 1;
  const isCurrent = activeEntry?.isCurrent ?? true;
  const viewHref = pdfUrl(doc.slug, versionNumber, isCurrent);

  return (
    <div className="flex flex-col gap-3 p-4 border rounded-lg hover:bg-accent/50 transition-colors sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4 min-w-0">
        <div className="h-10 w-10 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
          <FileText className="h-5 w-5 text-indigo-600" />
        </div>
        <div className="min-w-0 space-y-1">
          <p className="font-semibold">{doc.title || PLATFORM_DOCUMENT_LABELS[doc.slug].title}</p>
          <p className="text-sm text-muted-foreground">
            {formatPlatformVersionLabel(versionNumber)}
            {activeEntry?.effectiveAt
              ? ` · Effective ${formatVersionDate(activeEntry.effectiveAt)}`
              : doc.updatedAt
                ? ` · Updated ${formatVersionDate(doc.updatedAt)}`
                : ""}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <div className="flex items-center gap-2 min-w-[160px]">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Version</span>
          {loadingVersions ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <Select value={selectedVersion} onValueChange={setSelectedVersion}>
              <SelectTrigger className="h-9 w-[130px]">
                <SelectValue placeholder="Version" />
              </SelectTrigger>
              <SelectContent>
                {(versions.length > 0
                  ? versions
                  : [{ version: doc.version ?? 1, isCurrent: true }]
                ).map((entry) => (
                  <SelectItem key={entry.version} value={String(entry.version)}>
                    {formatPlatformVersionLabel(entry.version)}
                    {entry.isCurrent ? " (current)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200">
          {isCurrent ? "Current" : "Archived"}
        </Badge>
        <Button variant="outline" size="sm" asChild>
          <a href={viewHref} target="_blank" rel="noopener noreferrer">
            <Eye className="mr-2 h-4 w-4" />
            View
          </a>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href={viewHref} download>
            <Download className="mr-2 h-4 w-4" />
            Download
          </a>
        </Button>
      </div>
    </div>
  );
}
