"use client";

import { useMemo, useState } from "react";
import { Eraser, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import type { UserProfile } from "@/types";
import {
  ALL_WIPE_MODULE_IDS,
  WIPE_USER_MODULES,
  type WipeUserModuleId,
} from "@/lib/admin-wipe-user-modules";

type Props = {
  user: UserProfile;
  onCompleted?: () => void;
};

export function WipeUserDataDialog({ user, onCompleted }: Props) {
  const { user: adminUser } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<WipeUserModuleId[]>([]);
  const [resetAll, setResetAll] = useState(false);
  const [resetOnboarding, setResetOnboarding] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const expectedEmail = (user.email || "").trim().toLowerCase();
  const confirmOk =
    expectedEmail.length > 0 && confirmEmail.trim().toLowerCase() === expectedEmail;

  const effectiveModules = useMemo(
    () => (resetAll ? [...ALL_WIPE_MODULE_IDS] : selected),
    [resetAll, selected]
  );

  const canSubmit =
    confirmOk &&
    !submitting &&
    (effectiveModules.length > 0 || resetOnboarding);

  const toggleModule = (id: WipeUserModuleId, checked: boolean) => {
    setSelected((prev) => {
      if (checked) return prev.includes(id) ? prev : [...prev, id];
      return prev.filter((x) => x !== id);
    });
  };

  const resetForm = () => {
    setSelected([]);
    setResetAll(false);
    setResetOnboarding(false);
    setConfirmEmail("");
  };

  const handleSubmit = async () => {
    if (!canSubmit || !adminUser) return;
    setSubmitting(true);
    try {
      const token = await adminUser.getIdToken();
      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.uid)}/wipe-data`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          modules: effectiveModules,
          resetAll,
          resetOnboarding,
          confirmEmail: confirmEmail.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        deletedDocs?: number;
        resetOnboarding?: boolean;
      };
      if (!res.ok) {
        throw new Error(data.error || "Wipe failed.");
      }
      toast({
        title: "User data cleaned",
        description: [
          `${data.deletedDocs ?? 0} document(s) removed.`,
          data.resetOnboarding ? "Setup wizard & MSA reset — client must activate again." : null,
        ]
          .filter(Boolean)
          .join(" "),
      });
      setOpen(false);
      resetForm();
      onCompleted?.();
    } catch (err: unknown) {
      toast({
        variant: "destructive",
        title: "Could not clean user data",
        description: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5 text-destructive border-destructive/30">
          <Eraser className="h-3.5 w-3.5" />
          Clean data
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Clean user data</DialogTitle>
          <DialogDescription>
            Wipe selected modules for{" "}
            <span className="font-medium text-foreground">{user.name || user.email}</span>. The
            login account, email, password, and client ID stay. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
            Kept always: Auth login, email, password, client ID, company/profile fields, Buy Labels
            wallet settings on the user doc.
          </div>

          <label className="flex items-start gap-2 rounded-lg border bg-card p-3 cursor-pointer">
            <Checkbox
              checked={resetAll}
              onCheckedChange={(v) => {
                const on = v === true;
                setResetAll(on);
                if (on) setSelected([...ALL_WIPE_MODULE_IDS]);
              }}
              className="mt-0.5"
            />
            <div>
              <p className="text-sm font-semibold">Reset all modules</p>
              <p className="text-xs text-muted-foreground">
                Wipe every operational module below in one action.
              </p>
            </div>
          </label>

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Modules
            </p>
            <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border p-2">
              {WIPE_USER_MODULES.map((mod) => {
                const checked = resetAll || selected.includes(mod.id);
                return (
                  <label
                    key={mod.id}
                    className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={checked}
                      disabled={resetAll}
                      onCheckedChange={(v) => toggleModule(mod.id, v === true)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{mod.label}</p>
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        {mod.description}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          <label className="flex items-start gap-2 rounded-lg border border-violet-200 bg-violet-50/60 p-3 cursor-pointer">
            <Checkbox
              checked={resetOnboarding}
              onCheckedChange={(v) => setResetOnboarding(v === true)}
              className="mt-0.5"
            />
            <div>
              <p className="text-sm font-semibold text-violet-950">
                Also reset setup wizard &amp; MSA
              </p>
              <p className="text-xs text-violet-900/80">
                Clears onboarding and MSA acceptance. Client must complete the setup wizard and
                sign the MSA again. Leave unchecked to keep them activated with empty data.
              </p>
            </div>
          </label>

          <div className="space-y-2">
            <Label htmlFor={`wipe-confirm-${user.uid}`}>
              Type the user email to confirm
            </Label>
            <Input
              id={`wipe-confirm-${user.uid}`}
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              placeholder={user.email || "user@email.com"}
              autoComplete="off"
              className="font-mono text-sm"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!canSubmit}
            onClick={() => void handleSubmit()}
          >
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Wipe selected data
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
