"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, ExternalLink, FileText, Loader2 } from "lucide-react";
import { format } from "date-fns";
import type { PlatformDocumentSummary } from "@/lib/platform-documents-types";
import { PLATFORM_DOCUMENT_LABELS, PLATFORM_DOCUMENT_SLUGS } from "@/lib/platform-documents-types";

export function PlatformLegalDocumentsCard() {
  const [documents, setDocuments] = useState<PlatformDocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/platform-documents");
        const data = await res.json();
        if (!cancelled && res.ok) {
          setDocuments(data.documents || []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const ordered: PlatformDocumentSummary[] = PLATFORM_DOCUMENT_SLUGS.map((slug) => {
    const found = documents.find((d) => d.slug === slug);
    if (found) return found;
    return {
      slug,
      title: PLATFORM_DOCUMENT_LABELS[slug].title,
      version: 1,
    };
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-indigo-500" />
          Account agreements
        </CardTitle>
        <CardDescription>
          Current platform legal documents. PDFs are generated from the latest version when you view or download.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading documents...
          </div>
        ) : (
          ordered.map((doc) => (
            <div
              key={doc.slug}
              className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="font-medium">{doc.title || PLATFORM_DOCUMENT_LABELS[doc.slug].title}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Version {doc.version ?? 1}
                  {doc.updatedAt
                    ? ` · Updated ${format(new Date(doc.updatedAt), "MMM d, yyyy")}`
                    : ""}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={`/api/platform-documents/${doc.slug}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    View
                  </a>
                </Button>
                <Button variant="secondary" size="sm" asChild>
                  <a href={`/api/platform-documents/${doc.slug}/pdf`} download>
                    <Download className="mr-2 h-4 w-4" />
                    Download
                  </a>
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
