"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/admin/rich-text-editor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import type { PlatformDocument, PlatformDocumentControlRow, PlatformDocumentSection, PlatformDocumentSlug, PlatformDocumentVersionEntry } from "@/lib/platform-documents-types";
import { PLATFORM_DOCUMENT_LABELS, PLATFORM_DOCUMENT_SLUGS } from "@/lib/platform-documents-types";
import {
  parseDocumentVersionInput,
  suggestNextDocumentVersion,
} from "@/lib/document-version-utils";
import { formatPlatformVersionLabel } from "@/lib/platform-document-control";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  const [documentControl, setDocumentControl] = useState<PlatformDocumentControlRow[]>([]);
  const [showDocumentControlHeading, setShowDocumentControlHeading] = useState(false);
  const [meta, setMeta] = useState<Pick<PlatformDocument, "version" | "updatedAt" | "updatedByName">>({
    version: 1,
  });
  const [newVersionInput, setNewVersionInput] = useState("");
  const [archivedVersions, setArchivedVersions] = useState<PlatformDocumentVersionEntry[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [deletingVersion, setDeletingVersion] = useState<number | null>(null);
  const [versionToDelete, setVersionToDelete] = useState<number | null>(null);

  const loadArchivedVersions = useCallback(async (nextSlug: PlatformDocumentSlug) => {
    setLoadingVersions(true);
    try {
      const res = await fetch(`/api/platform-documents/${nextSlug}/versions`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load versions");
      const versions = (data.versions || []) as PlatformDocumentVersionEntry[];
      setArchivedVersions(versions.filter((entry) => !entry.isCurrent));
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not load version history",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setLoadingVersions(false);
    }
  }, [toast]);

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
      setDocumentControl(doc.documentControl || []);
      setShowDocumentControlHeading(doc.showDocumentControlHeading ?? slug === "msa");
      setMeta({ version: doc.version, updatedAt: doc.updatedAt, updatedByName: doc.updatedByName });
      setNewVersionInput(suggestNextDocumentVersion(doc.version));
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
    void loadArchivedVersions(slug);
  }, [slug, loadDocument, loadArchivedVersions]);

  async function handleSave() {
    if (!user) return;
    let version: number;
    try {
      version = parseDocumentVersionInput(newVersionInput);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Invalid version",
        description: e instanceof Error ? e.message : "Enter a valid version number.",
      });
      return;
    }

    setSaving(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/platform-documents/${slug}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title, subtitle, sections, version }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      const doc = data.document as PlatformDocument;
      setMeta({ version: doc.version, updatedAt: doc.updatedAt, updatedByName: doc.updatedByName });
      setNewVersionInput(suggestNextDocumentVersion(doc.version));
      setDocumentControl(doc.documentControl || []);
      setShowDocumentControlHeading(doc.showDocumentControlHeading ?? slug === "msa");
      void loadArchivedVersions(slug);
      toast({
        title: "Document saved",
        description: `${formatPlatformVersionLabel(doc.version)} is now live for PDF generation.`,
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

  async function handleDeleteArchivedVersion(version: number) {
    if (!user) return;
    setDeletingVersion(version);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/platform-documents/${slug}/versions/${version}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete version");
      setArchivedVersions((prev) => prev.filter((entry) => entry.version !== version));
      toast({
        title: "Archived version deleted",
        description: `${formatPlatformVersionLabel(version)} was removed from the archive.`,
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setDeletingVersion(null);
      setVersionToDelete(null);
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
          Edit agreement content in-app with rich text formatting. The PDF and client views use only
          the sections you enter below (plus the auto-generated Document Control table). When you
          save, enter the version number you want published. The previous live version is archived
          automatically.
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
              <a
                href={`/api/platform-documents/${slug}/pdf?version=${meta.version ?? 1}&t=${encodeURIComponent(meta.updatedAt || "")}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Preview live PDF
              </a>
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving || loading}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save new version
            </Button>
          </div>
        </div>

        <div className="rounded-lg border bg-muted/20 px-4 py-3 text-sm text-muted-foreground space-y-3">
          <div>
            Current live version: <strong>{formatPlatformVersionLabel(meta.version)}</strong>
            {meta.updatedAt ? (
              <> · Last updated {format(new Date(meta.updatedAt), "MMM d, yyyy 'at' h:mm a")}</>
            ) : null}
            {meta.updatedByName ? <> · by {meta.updatedByName}</> : null}
            {userProfile?.name ? (
              <span className="block mt-1 text-xs">Editing as {userProfile.name}</span>
            ) : null}
          </div>
          <div className="space-y-1 max-w-xs">
            <Label htmlFor="new-version">Version for next save</Label>
            <Input
              id="new-version"
              value={newVersionInput}
              onChange={(e) => setNewVersionInput(e.target.value)}
              placeholder={suggestNextDocumentVersion(meta.version)}
              disabled={loading || saving}
            />
            <p className="text-xs">
              Enter the version label you want (e.g. 2.0 or 3). Must differ from the current live
              version and any archived version.
            </p>
          </div>
        </div>

        <div className="space-y-2 rounded-lg border p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">Archived versions</p>
              <p className="text-xs text-muted-foreground">
                Older versions kept for download. You can delete archives that are no longer needed.
              </p>
            </div>
            {loadingVersions ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
          </div>
          {archivedVersions.length === 0 && !loadingVersions ? (
            <p className="text-sm text-muted-foreground">No archived versions yet.</p>
          ) : (
            <div className="space-y-2">
              {archivedVersions.map((entry) => (
                <div
                  key={entry.version}
                  className="flex flex-col gap-2 rounded-md border px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="text-sm">
                    <span className="font-medium">{formatPlatformVersionLabel(entry.version)}</span>
                    {entry.updatedAt ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · {format(new Date(entry.updatedAt), "MMM d, yyyy 'at' h:mm a")}
                      </span>
                    ) : null}
                    {entry.updatedByName ? (
                      <span className="text-muted-foreground"> · by {entry.updatedByName}</span>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" asChild>
                      <a
                        href={`/api/platform-documents/${slug}/pdf?version=${entry.version}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="mr-1 h-4 w-4" />
                        Preview
                      </a>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      disabled={deletingVersion === entry.version}
                      onClick={() => setVersionToDelete(entry.version)}
                    >
                      {deletingVersion === entry.version ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="mr-1 h-4 w-4" />
                      )}
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <AlertDialog
          open={versionToDelete != null}
          onOpenChange={(open) => {
            if (!open) setVersionToDelete(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete archived version?</AlertDialogTitle>
              <AlertDialogDescription>
                {versionToDelete != null
                  ? `This permanently removes ${formatPlatformVersionLabel(versionToDelete)} from the archive. Users who already signed that version keep their signed copy; only the archived download is removed.`
                  : null}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  if (versionToDelete != null) {
                    void handleDeleteArchivedVersion(versionToDelete);
                  }
                }}
              >
                Delete archive
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

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

            {documentControl.length > 0 ? (
              <div className="space-y-2 rounded-lg border p-4">
                {showDocumentControlHeading ? (
                  <p className="text-sm font-semibold text-primary">Document Control</p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Auto-generated for this document. Version and dates update when you save with a new
                  version number.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-primary text-primary-foreground">
                        <th className="px-3 py-2 text-left font-semibold">Field</th>
                        <th className="px-3 py-2 text-left font-semibold">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {documentControl.map((row) => (
                        <tr key={row.field} className="border-b last:border-0">
                          <td className="px-3 py-2 font-medium">{row.field}</td>
                          <td className="px-3 py-2">{row.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            <div className="space-y-4">
              <Label>Sections</Label>
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
                  <RichTextEditor
                    label="Section body"
                    value={section.body}
                    onChange={(html) => updateSection(index, { body: html })}
                    placeholder="Section body"
                  />
                </div>
              ))}
              <div className="flex justify-end pt-1">
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
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
