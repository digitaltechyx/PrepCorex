"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Loader2, LockKeyhole, ShieldOff } from "lucide-react";

type SettingsView = {
  pinEnabled: boolean;
  pinConfigured: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
};

export function PublicTrackersSettingsPanel() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    if (!user) throw new Error("Not signed in.");
    const token = await user.getIdToken();
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }, [user]);

  const loadSettings = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/admin/public-trackers-settings", { headers });
      const data = (await res.json()) as { settings?: SettingsView; error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to load settings.");
      setSettings(data.settings ?? null);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Load failed",
        description: e instanceof Error ? e.message : "Could not load tracker PIN settings.",
      });
    } finally {
      setLoading(false);
    }
  }, [authHeaders, toast, user]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const savePin = async () => {
    if (pin !== confirmPin) {
      toast({ variant: "destructive", title: "PINs do not match." });
      return;
    }
    setSaving(true);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/admin/public-trackers-settings", {
        method: "PUT",
        headers,
        body: JSON.stringify({ pin }),
      });
      const data = (await res.json()) as { settings?: SettingsView; message?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to save PIN.");
      setSettings(data.settings ?? null);
      setPin("");
      setConfirmPin("");
      toast({ title: "PIN saved", description: data.message });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Save failed",
        description: e instanceof Error ? e.message : "Could not save PIN.",
      });
    } finally {
      setSaving(false);
    }
  };

  const removePin = async () => {
    setSaving(true);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/admin/public-trackers-settings", {
        method: "PUT",
        headers,
        body: JSON.stringify({ disable: true }),
      });
      const data = (await res.json()) as { settings?: SettingsView; message?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to remove PIN.");
      setSettings(data.settings ?? null);
      toast({ title: "PIN removed", description: data.message });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Remove failed",
        description: e instanceof Error ? e.message : "Could not remove PIN.",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Public trackers PIN</h1>
        <p className="text-sm text-muted-foreground">
          Control who can open{" "}
          <a
            href="/trackers"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
          >
            prepcorex.com/trackers
            <ExternalLink className="h-3 w-3" />
          </a>
          . Admin dashboard trackers always use your login.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <LockKeyhole className="h-5 w-5" />
            Current status
          </CardTitle>
          <CardDescription>
            {settings?.pinConfigured
              ? "Visitors must enter the PIN before they can view or edit public trackers."
              : "No PIN is set — /trackers is open to anyone with the link."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Protection:</span>
            {settings?.pinConfigured ? (
              <Badge className="bg-emerald-100 text-emerald-900 hover:bg-emerald-100">PIN active</Badge>
            ) : (
              <Badge variant="secondary">Open (no PIN)</Badge>
            )}
          </div>
          {settings?.updatedAt ? (
            <p className="text-muted-foreground">
              Last updated{" "}
              {new Date(settings.updatedAt).toLocaleString()}
              {settings.updatedByName ? ` by ${settings.updatedByName}` : ""}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            After a correct PIN, the same browser stays unlocked for 7 days.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Set or change PIN</CardTitle>
          <CardDescription>Use 4–12 letters or numbers. Changing the PIN signs everyone out.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 max-w-md">
          <div className="space-y-2">
            <Label htmlFor="trackers-pin">New PIN</Label>
            <Input
              id="trackers-pin"
              type="password"
              autoComplete="new-password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="e.g. 7391"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="trackers-pin-confirm">Confirm PIN</Label>
            <Input
              id="trackers-pin-confirm"
              type="password"
              autoComplete="new-password"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value)}
            />
          </div>
          <Button
            type="button"
            onClick={() => void savePin()}
            disabled={saving || !pin.trim() || !confirmPin.trim()}
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save PIN
          </Button>
        </CardContent>
      </Card>

      {settings?.pinConfigured ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg text-destructive">
              <ShieldOff className="h-5 w-5" />
              Remove PIN protection
            </CardTitle>
            <CardDescription>
              Makes /trackers fully open again without a PIN gate.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" variant="destructive" disabled={saving} onClick={() => void removePin()}>
              Remove PIN
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
