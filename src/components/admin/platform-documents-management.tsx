"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import type { PlatformDocument, PlatformDocumentSection, PlatformDocumentSlug } from "@/lib/platform-documents-types";
import { PLATFORM_DOCUMENT_LABELS, PLATFORM_DOCUMENT_SLUGS } from "@/lib/platform-documents-types";
import { ExternalLink, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { format } from "date-fns";

export function PlatformDocumentsManagement() {
  const { user, userProfile } = useAuth();
  const { toast } = useToast();
  const [slug, setSlug] = useState<PlatformDocumentSlug>("msa");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [sections, setSections] = useState<PlatformDocumentSection[]>([]);
  const [meta, setMeta] = useState<Pick<PlatformDocument, "version" | "updatedAt" | "updatedByName">>({
    version: 1,
  });

  const loadDocument = useCallback(async (nextSlug: PlatformDocumentSlug) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/platform-documents/${nextSlug}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load document");
      const doc = data.document as PlatformDocument;
      setTitle(doc.title);
      setSubtitle(doc.subtitle || "");
      setSections(doc.sections.length > 0 ? doc.sections : [{ title: "Section 1", body: "" }]);
      setMeta({ version: doc.version, updatedAt: doc.updatedAt, updatedByName: doc.updatedByName });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not load document",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadDocument(slug);
  }, [slug, loadDocument]);

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/platform-documents/${slug}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title, subtitle, sections }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      const doc = data.document as PlatformDocument;
      setMeta({ version: doc.version, updatedAt: doc.updatedAt, updatedByName: doc.updatedByName });
      toast({
        title: "Document saved",
        description: `Version ${doc.version} is now live for PDF generation.`,
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Save failed",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  }

  function updateSection(index: number, patch: Partial<PlatformDocumentSection>) {
    setSections((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Platform legal documents</CardTitle>
        <CardDescription>
          Edit agreement content in-app. Each save creates a new version and archives the previous one.
          Users see PDFs generated from the current version.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1 max-w-md w-full">
            <Label>Document</Label>
            <Select value={slug} onValueChange={(v) => setSlug(v as PlatformDocumentSlug)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PLATFORM_DOCUMENT_SLUGS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {PLATFORM_DOCUMENT_LABELS[s].shortLabel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <a href={`/api/platform-documents/${slug}/pdf`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                Preview PDF
              </a>
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving || loading}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save new version
            </Button>
          </div>
        </div>

        <div className="rounded-lg border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          Version <strong>{meta.version ?? 1}</strong>
          {meta.updatedAt ? (
            <> · Last updated {format(new Date(meta.updatedAt), "MMM d, yyyy 'at' h:mm a")}</>
          ) : null}
          {meta.updatedByName ? <> · by {meta.updatedByName}</> : null}
          {userProfile?.name ? (
            <span className="block mt-1 text-xs">Editing as {userProfile.name}</span>
          ) : null}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-10 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading document...
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <Label htmlFor="doc-title">Title</Label>
              <Input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="doc-subtitle">Subtitle (optional)</Label>
              <Input id="doc-subtitle" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label>Sections</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setSections((prev) => [...prev, { title: `Section ${prev.length + 1}`, body: "" }])
                  }
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Add section
                </Button>
              </div>
              {sections.map((section, index) => (
                <div key={index} className="space-y-2 rounded-lg border p-4">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs text-muted-foreground">Section {index + 1}</Label>
                    {sections.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 text-destructive"
                        onClick={() => setSections((prev) => prev.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="mr-1 h-4 w-4" />
                        Remove
                      </Button>
                    )}
                  </div>
                  <Input
                    value={section.title}
                    onChange={(e) => updateSection(index, { title: e.target.value })}
                    placeholder="Section title"
                  />
                  <Textarea
                    value={section.body}
                    onChange={(e) => updateSection(index, { body: e.target.value })}
                    placeholder="Section body"
                    className="min-h-[120px]"
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
